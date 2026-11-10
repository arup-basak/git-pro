import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { textHash } from '../../shared/hash'
import type { LineAction, LineSelection } from '../../shared/types'
import { git } from './runner'
import { worktreeDiff } from './worktree'

/*
 * Line-level staging. The renderer shows a file's diff and the user picks changed lines by
 * ordinal (0 = first `+`/`-` line). Here the same diff is recomputed, checked against the hash
 * the renderer saw, cut down to the selected lines and fed to `git apply`.
 */

export interface RawLine {
  /** ' ' context, '+' added, '-' removed, '\\' "No newline at end of file". */
  kind: ' ' | '+' | '-' | '\\'
  /** The line without its one-character prefix. */
  text: string
}

export interface RawHunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  /** Whatever follows the closing `@@` (usually a function name). */
  tail: string
  lines: RawLine[]
}

export interface RawFilePatch {
  header: string[]
  hunks: RawHunk[]
  binary: boolean
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/

/** Parses the diff of a single file (as produced by `git diff -- <path>`). */
export function parseFilePatch(raw: string): RawFilePatch {
  const lines = raw.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  const out: RawFilePatch = { header: [], hunks: [], binary: false }
  let hunk: RawHunk | null = null
  for (const line of lines) {
    if (line.startsWith('diff --git ') && (hunk || out.header.length)) {
      throw new Error('Expected the diff of a single file')
    }
    const m = HUNK_RE.exec(line)
    if (m) {
      hunk = {
        oldStart: Number(m[1]),
        oldCount: m[2] === undefined ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        newCount: m[4] === undefined ? 1 : Number(m[4]),
        tail: m[5],
        lines: []
      }
      out.hunks.push(hunk)
      continue
    }
    if (!hunk) {
      if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) out.binary = true
      out.header.push(line)
      continue
    }
    const c = line[0]
    if (c === '+' || c === '-' || c === ' ' || c === '\\') {
      hunk.lines.push({ kind: c, text: line.slice(1) })
    } else if (line === '') {
      hunk.lines.push({ kind: ' ', text: '' })
    }
  }
  return out
}

/** Number of `+`/`-` lines in a parsed file diff. */
export function changeCount(file: RawFilePatch): number {
  let n = 0
  for (const h of file.hunks) for (const l of h.lines) if (l.kind === '+' || l.kind === '-') n++
  return n
}

/**
 * Builds a patch that contains only the selected changed lines.
 *
 * Forward (to apply as is, e.g. staging): an unselected `-` line stays as context and an
 * unselected `+` line is left out, so the patch's preimage is exactly the diff's preimage.
 * Reverse (to apply with `-R`, e.g. unstaging or discarding): an unselected `+` line stays as
 * context and an unselected `-` line is left out, so the patch's postimage is exactly the
 * diff's postimage. Returns null when no selected line remains.
 */
export function buildPartialPatch(
  file: RawFilePatch,
  selected: ReadonlySet<number>,
  reverse: boolean
): string | null {
  const total = changeCount(file)
  const all = total > 0 && [...Array(total).keys()].every((i) => selected.has(i))
  const body: string[] = []
  let ordinal = 0
  let delta = 0 // newCount - oldCount of the hunks emitted so far
  for (const h of file.hunks) {
    const out: string[] = []
    let changed = false
    let keptPrev = false
    for (const l of h.lines) {
      if (l.kind === '\\') {
        if (keptPrev) out.push(`\\${l.text}`)
        continue
      }
      if (l.kind === ' ') {
        out.push(` ${l.text}`)
        keptPrev = true
        continue
      }
      const sel = selected.has(ordinal++)
      if (sel) {
        out.push(`${l.kind}${l.text}`)
        changed = true
        keptPrev = true
      } else if ((l.kind === '-' && !reverse) || (l.kind === '+' && reverse)) {
        out.push(` ${l.text}`)
        keptPrev = true
      } else {
        keptPrev = false
      }
    }
    if (!changed) continue
    let oldCount = 0
    let newCount = 0
    for (const l of out) {
      if (l[0] === ' ' || l[0] === '-') oldCount++
      if (l[0] === ' ' || l[0] === '+') newCount++
    }
    // First line number on each side; a side with zero lines is written as "the line before".
    let oldFirst: number
    let newFirst: number
    if (reverse) {
      newFirst = h.newCount === 0 ? h.newStart + 1 : h.newStart
      oldFirst = newFirst - delta
    } else {
      oldFirst = h.oldCount === 0 ? h.oldStart + 1 : h.oldStart
      newFirst = oldFirst + delta
    }
    const start = (first: number, count: number): number => (count === 0 ? first - 1 : first)
    body.push(
      `@@ -${start(oldFirst, oldCount)},${oldCount} +${start(newFirst, newCount)},${newCount} @@${h.tail}`,
      ...out
    )
    delta += newCount - oldCount
  }
  if (!body.length) return null

  let header = file.header.filter((l) => !l.startsWith('index '))
  if (!all) {
    // A partial selection of a whole-file add or delete is a modification of the file.
    const minus = header.find((l) => l.startsWith('--- '))
    const plus = header.find((l) => l.startsWith('+++ '))
    if (!reverse && header.some((l) => l.startsWith('deleted file mode')) && minus) {
      header = header
        .filter((l) => !l.startsWith('deleted file mode'))
        .map((l) => (l === '+++ /dev/null' ? `+++ b/${minus.slice(6)}` : l))
    }
    if (reverse && header.some((l) => l.startsWith('new file mode')) && plus) {
      header = header
        .filter((l) => !l.startsWith('new file mode'))
        .map((l) => (l === '--- /dev/null' ? `--- a/${plus.slice(6)}` : l))
    }
  }
  return [...header, ...body].join('\n') + '\n'
}

/** Resolves a repo-relative path and refuses anything outside the working tree. */
export function insideWorktree(cwd: string, path: string): string {
  if (!path || path.includes('\0')) throw new Error(`Invalid path "${path}"`)
  const abs = resolve(cwd, path)
  if (!abs.startsWith(cwd + sep)) throw new Error(`"${path}" is outside the repository`)
  return abs
}

/** Recomputes the diff a selection was made on and checks it has not changed. */
export async function currentDiff(cwd: string, sel: LineSelection): Promise<RawFilePatch> {
  insideWorktree(cwd, sel.path)
  const raw = await worktreeDiff(cwd, sel.path, sel.staged, sel.untracked)
  if (textHash(raw) !== sel.diffHash) {
    throw new Error(
      `“${sel.path}” changed since its diff was shown. Check the refreshed diff and select again.`
    )
  }
  const file = parseFilePatch(raw)
  if (file.binary) throw new Error('Binary files can only be staged or discarded as a whole')
  return file
}

/**
 * Removes the selected lines from an untracked file (its diff is all additions, so ordinal k
 * is line k). Deletes the file when every line goes. Returns the previous content.
 */
export function removeUntrackedLines(
  cwd: string,
  path: string,
  selected: ReadonlySet<number>
): string {
  const abs = insideWorktree(cwd, path)
  const before = readFileSync(abs, 'utf8')
  const lines = before.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const kept = lines.filter((_, i) => !selected.has(i))
  if (kept.length === 0) unlinkSync(abs)
  else writeFileSync(abs, kept.join(''))
  return before
}

const APPLY = ['apply', '--recount', '--whitespace=nowarn']

/** Stages, unstages or discards the selected lines of one file. */
export async function applyLines(
  cwd: string,
  action: LineAction,
  sel: LineSelection
): Promise<void> {
  if (action === 'unstage' ? !sel.staged : sel.staged) {
    throw new Error(
      action === 'unstage'
        ? 'Only staged lines can be unstaged'
        : 'Select lines in the unstaged diff'
    )
  }
  const file = await currentDiff(cwd, sel)
  const selected = new Set(sel.changes)
  if (action === 'discard' && sel.untracked) {
    if (!sel.changes.length) throw new Error('Select at least one changed line')
    removeUntrackedLines(cwd, sel.path, selected)
    return
  }
  const reverse = action !== 'stage'
  const patch = buildPartialPatch(file, selected, reverse)
  if (!patch) throw new Error('Select at least one changed line')
  const args = [...APPLY, ...(action === 'discard' ? [] : ['--cached']), ...(reverse ? ['-R'] : [])]
  await git(cwd, [...args, '-'], { write: true, input: patch })
}

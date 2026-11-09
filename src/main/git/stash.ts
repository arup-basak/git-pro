import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AppStash,
  PreviewFile,
  StackStash,
  StashApplyPreview,
  StashApplyResult,
  StashFile,
  StashOverview,
  StashSaveRequest,
  StashTarget
} from '../../shared/types'
import { FS, RS } from './parse'
import { git, gitOut } from './runner'
import {
  assertStashId,
  newStashId,
  readStore,
  updateMeta,
  writeStore,
  type StashMeta
} from './stashStore'
import { assertBranchName, currentBranch, emptyTree, tryResolve } from './util'
import { getStatus } from './worktree'

export const APP_PREFIX = 'refs/git-pro/stashes/'
export const TRASH_PREFIX = 'refs/git-pro/stash-trash/'

const SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/

function assertSha(sha: string): void {
  if (!SHA_RE.test(sha)) throw new Error('Invalid object id')
}

/* ---------------- listing ---------------- */

function branchFromMessage(msg: string): string | null {
  const m = /^(?:WIP on|On) ([^:]+):/.exec(msg)
  return m && m[1] !== '(no branch)' ? m[1] : null
}

function nameFromMessage(msg: string): string {
  return msg.replace(/^(?:WIP on|On) [^:]+: /, '').trim() || 'Untitled stash'
}

export async function listStack(cwd: string): Promise<StackStash[]> {
  const r = await git(cwd, ['stash', 'list', '--format=%gd%x1f%H%x1f%gs%x1f%ct%x1f%P%x1e'], {
    allowFail: true
  })
  if (r.code !== 0) return []
  const out: StackStash[] = []
  for (const rec of r.stdout.split(RS)) {
    const s = rec.replace(/^\n/, '')
    if (!s) continue
    const [ref, sha, message, ct, parents] = s.split(FS)
    const m = /\{(\d+)\}/.exec(ref)
    out.push({
      index: m ? +m[1] : out.length,
      ref,
      sha,
      message,
      branch: branchFromMessage(message),
      baseSha: parents.split(' ')[0] ?? '',
      date: Number(ct)
    })
  }
  return out
}

async function listRefs(cwd: string, prefix: string): Promise<AppStash[]> {
  const out = await gitOut(cwd, [
    'for-each-ref',
    '--format=%(refname)%1f%(objectname)%1f%(contents:subject)%1f%(creatordate:unix)%1f%(parent)%1e',
    prefix
  ])
  const store = await readStore(cwd)
  const list: AppStash[] = []
  const bases: string[] = []
  for (const rec of out.split(RS)) {
    const s = rec.replace(/^\n/, '')
    if (!s) continue
    const [ref, sha, subject, date, parents] = s.split(FS)
    const id = ref.slice(prefix.length)
    const baseSha = parents.split(' ')[0] ?? ''
    bases.push(baseSha)
    const meta: StashMeta = store.stashes[id] ?? {
      id,
      name: nameFromMessage(subject),
      notes: '',
      group: '',
      pinned: false,
      branch: branchFromMessage(subject),
      baseSha,
      createdAt: Number(date) * 1000,
      scope: 'all',
      includeUntracked: true
    }
    list.push({ ...meta, id, ref, sha, baseSha, baseSubject: '' })
  }
  // Subjects of the base commits, in one call.
  if (bases.length) {
    const subjects = await gitOut(
      cwd,
      ['log', '--no-walk=unsorted', '--format=%H%x1f%s', ...new Set(bases.filter(Boolean))],
      {
        allowFail: true
      }
    )
    const map = new Map(subjects.split('\n').map((l) => l.split(FS) as [string, string]))
    for (const s of list) s.baseSubject = map.get(s.baseSha) ?? ''
  }
  return list
}

export async function overview(cwd: string): Promise<StashOverview> {
  const [app, trash, stack] = await Promise.all([
    listRefs(cwd, APP_PREFIX),
    listRefs(cwd, TRASH_PREFIX),
    listStack(cwd)
  ])
  app.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt)
  trash.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
  const groups = [...new Set(app.map((s) => s.group).filter(Boolean))].sort()
  return { app, trash, stack, groups }
}

/* ---------------- creating ---------------- */

export async function saveStash(cwd: string, req: StashSaveRequest): Promise<AppStash> {
  const name = req.name.trim() || 'Untitled stash'
  if (/[\n\0]/.test(name)) throw new Error('Stash name must be a single line')
  if (req.scope === 'paths' && !req.paths?.length)
    throw new Error('Select at least one file to stash')
  for (const p of req.paths ?? [])
    if (!p || p.includes('\0')) throw new Error(`Invalid path "${p}"`)

  const before = await tryResolve(cwd, 'refs/stash')
  const args = ['stash', 'push', '-m', name]
  if (req.scope === 'staged') args.push('--staged')
  else if (req.includeUntracked) args.push('--include-untracked')
  if (req.scope === 'paths') args.push('--', ...req.paths!)
  const r = await git(cwd, args, { write: true })
  const sha = await tryResolve(cwd, 'refs/stash')
  if (!sha || sha === before) {
    throw new Error(r.stdout.trim() || r.stderr.trim() || 'No local changes to stash')
  }

  // Move the entry off git's stack into its own stable ref.
  const id = newStashId()
  const ref = APP_PREFIX + id
  await git(cwd, ['update-ref', '-m', `git-pro stash: ${name}`, ref, sha], { write: true })
  const top = await tryResolve(cwd, 'stash@{0}')
  if (top === sha) await git(cwd, ['stash', 'drop', '--quiet', 'stash@{0}'], { write: true })

  if (req.keepWorkingTree) {
    await git(cwd, ['stash', 'apply', '--index', '--quiet', sha], { write: true })
  }

  const baseSha = await gitOut(cwd, ['rev-parse', `${sha}^1`])
  const meta: StashMeta = {
    id,
    name,
    notes: req.notes,
    group: req.group.trim(),
    pinned: false,
    branch: await currentBranch(cwd),
    baseSha,
    createdAt: Date.now(),
    scope: req.scope,
    includeUntracked: req.scope !== 'staged' && req.includeUntracked
  }
  await updateMeta(cwd, id, () => meta)
  const baseSubject = await gitOut(cwd, ['log', '-1', '--format=%s', baseSha])
  return { ...meta, ref, sha, baseSubject }
}

/** Moves an entry from git's stash stack into the app's structured stashes. */
export async function adoptStash(
  cwd: string,
  index: number,
  sha: string,
  name: string,
  group: string
): Promise<AppStash> {
  const entry = await resolveTarget(cwd, { kind: 'stack', index, sha })
  const id = newStashId()
  const ref = APP_PREFIX + id
  const stack = (await listStack(cwd)).find((s) => s.index === index)!
  await git(cwd, ['update-ref', '-m', 'git-pro stash: adopt', ref, entry.sha], { write: true })
  await git(cwd, ['stash', 'drop', '--quiet', `stash@{${index}}`], { write: true })
  const meta: StashMeta = {
    id,
    name: name.trim() || nameFromMessage(stack.message),
    notes: '',
    group: group.trim(),
    pinned: false,
    branch: stack.branch,
    baseSha: stack.baseSha,
    createdAt: stack.date * 1000,
    scope: 'all',
    includeUntracked: !!(await tryResolve(cwd, `${entry.sha}^3`))
  }
  await updateMeta(cwd, id, () => meta)
  return { ...meta, ref, sha: entry.sha, baseSubject: '' }
}

/* ---------------- resolving targets ---------------- */

async function resolveTarget(
  cwd: string,
  t: StashTarget
): Promise<{ sha: string; ref: string; label: string }> {
  if (t.kind === 'app') {
    assertStashId(t.id)
    const ref = APP_PREFIX + t.id
    const sha = await tryResolve(cwd, ref)
    if (!sha) throw new Error('This stash no longer exists')
    return { sha, ref, label: ref }
  }
  if (!Number.isInteger(t.index) || t.index < 0) throw new Error('Invalid stash index')
  const label = `stash@{${t.index}}`
  const sha = await tryResolve(cwd, label)
  // Indices shift when stashes are added or dropped; refuse to act on the wrong entry.
  if (!sha || sha !== t.sha) throw new Error('The stash stack changed. Refresh and try again.')
  return { sha, ref: label, label }
}

/* ---------------- inspecting ---------------- */

export async function stashFiles(cwd: string, sha: string): Promise<StashFile[]> {
  assertSha(sha)
  const files: StashFile[] = []
  const ns = (await gitOut(cwd, ['diff', '--name-status', '-z', `${sha}^1`, sha, '--'])).split('\0')
  for (let i = 0; i < ns.length; i++) {
    if (!ns[i]) continue
    files.push({ status: ns[i][0], path: ns[i + 1], untracked: false })
    i++
  }
  if (await tryResolve(cwd, `${sha}^3`)) {
    const untracked = (await gitOut(cwd, ['ls-tree', '-r', '-z', '--name-only', `${sha}^3`])).split(
      '\0'
    )
    for (const p of untracked) if (p) files.push({ status: 'A', path: p, untracked: true })
  }
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

export async function stashDiff(cwd: string, sha: string, path?: string): Promise<string> {
  assertSha(sha)
  const hasUntracked = !!(await tryResolve(cwd, `${sha}^3`))
  const parts: string[] = []
  const tracked = await git(cwd, ['diff', '-M', `${sha}^1`, sha, '--', ...(path ? [path] : [])], {
    quietStdout: true
  })
  parts.push(tracked.stdout)
  if (hasUntracked) {
    const empty = await emptyTree(cwd)
    const u = await git(cwd, ['diff', empty, `${sha}^3`, '--', ...(path ? [path] : [])], {
      quietStdout: true
    })
    parts.push(u.stdout)
  }
  return parts.join('')
}

/* ---------------- preview ---------------- */

interface MergeTreeResult {
  tree: string
  conflicted: Set<string>
  messages: string[]
  clean: boolean
}

export async function mergeTrees(
  cwd: string,
  base: string,
  ours: string,
  theirs: string
): Promise<MergeTreeResult> {
  const r = await git(
    cwd,
    [
      '-c',
      'merge.conflictStyle=diff3',
      'merge-tree',
      '--write-tree',
      '-z',
      '--messages',
      `--merge-base=${base}`,
      ours,
      theirs
    ],
    { allowFail: true, quietStdout: true }
  )
  if (r.code !== 0 && r.code !== 1) throw new Error(r.stderr.trim() || 'git merge-tree failed')
  const tokens = r.stdout.split('\0')
  const tree = tokens[0]
  const conflicted = new Set<string>()
  let i = 1
  for (; i < tokens.length; i++) {
    const m = /^\d{6} [0-9a-f]+ \d\t(.*)$/s.exec(tokens[i])
    if (!m) break
    conflicted.add(m[1])
  }
  while (i < tokens.length && tokens[i] === '') i++
  const messages: string[] = []
  while (i < tokens.length && tokens[i] !== '') {
    const n = Number(tokens[i])
    if (!Number.isFinite(n)) break
    const msg = tokens[i + n + 2]
    if (msg) messages.push(msg.trim())
    i += n + 3
  }
  return { tree, conflicted, messages, clean: r.code === 0 }
}

/**
 * Dry-runs `git stash apply <sha>` without touching the working tree: a 3-way merge of
 * base = the stash's parent, ours = the current index, theirs = the stash's working tree.
 * Also reports files the real apply would refuse to touch (local modifications) and untracked
 * files that already exist.
 */
export async function previewApply(cwd: string, sha: string): Promise<StashApplyPreview> {
  assertSha(sha)
  const status = await getStatus(cwd)
  if (status.entries.some((e) => e.conflicted)) {
    throw new Error('Resolve the current conflicts before previewing a stash')
  }
  const ours = await gitOut(cwd, ['write-tree'], { write: true })
  const base = await gitOut(cwd, ['rev-parse', `${sha}^1^{tree}`])
  const theirs = await gitOut(cwd, ['rev-parse', `${sha}^{tree}`])
  const merged = await mergeTrees(cwd, base, ours, theirs)

  const dirty = new Set(
    status.entries.filter((e) => e.worktree !== '.' && !e.untracked).map((e) => e.path)
  )
  const files: PreviewFile[] = []
  const ns = (
    await gitOut(cwd, ['diff-tree', '-r', '-z', '--name-status', '--no-renames', ours, merged.tree])
  ).split('\0')
  const seen = new Set<string>()
  for (let i = 0; i < ns.length; i++) {
    if (!ns[i]) continue
    const letter = ns[i][0]
    const path = ns[i + 1]
    i++
    seen.add(path)
    const outcome: PreviewFile['outcome'] = merged.conflicted.has(path)
      ? 'conflict'
      : dirty.has(path)
        ? 'blocked'
        : letter === 'A'
          ? 'added'
          : letter === 'D'
            ? 'deleted'
            : 'modified'
    files.push({ path, outcome, untracked: false })
  }
  for (const p of merged.conflicted) {
    if (!seen.has(p)) files.push({ path: p, outcome: 'conflict', untracked: false })
  }
  if (await tryResolve(cwd, `${sha}^3`)) {
    const untracked = (await gitOut(cwd, ['ls-tree', '-r', '-z', '--name-only', `${sha}^3`])).split(
      '\0'
    )
    for (const p of untracked) {
      if (!p) continue
      files.push({
        path: p,
        outcome: existsSync(join(cwd, p)) ? 'untracked-blocked' : 'untracked',
        untracked: true
      })
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  const clean = files.every(
    (f) => f.outcome !== 'conflict' && f.outcome !== 'blocked' && f.outcome !== 'untracked-blocked'
  )
  return {
    stashSha: sha,
    clean,
    files,
    trees: { base, ours, theirs, result: merged.tree },
    messages: merged.messages
  }
}

/* ---------------- applying ---------------- */

export async function applyStash(
  cwd: string,
  target: StashTarget,
  opts: { pop: boolean; restoreIndex: boolean }
): Promise<StashApplyResult> {
  const t = await resolveTarget(cwd, target)
  const args = ['-c', 'merge.conflictStyle=diff3', 'stash', 'apply']
  if (opts.restoreIndex) args.push('--index')
  args.push(t.sha)
  const r = await git(cwd, args, { write: true, allowFail: true })
  const status = await getStatus(cwd)
  const conflicted = status.entries.filter((e) => e.conflicted).map((e) => e.path)
  const output = [r.stdout.trim(), r.stderr.trim()].filter(Boolean).join('\n')
  if (r.code !== 0 && conflicted.length === 0) {
    throw new Error(r.stderr.trim() || 'git stash apply failed')
  }
  const clean = r.code === 0 && conflicted.length === 0
  let dropped = false
  if (opts.pop && clean) {
    await deleteStash(cwd, target)
    dropped = true
  }
  return { clean, conflicted, dropped, output }
}

/* ---------------- editing / deleting ---------------- */

export async function updateStash(
  cwd: string,
  id: string,
  patch: Partial<Pick<AppStash, 'name' | 'notes' | 'group' | 'pinned'>>
): Promise<void> {
  assertStashId(id)
  const list = await listRefs(cwd, APP_PREFIX)
  const current = list.find((s) => s.id === id)
  if (!current) throw new Error('This stash no longer exists')
  if (patch.name !== undefined && (/[\n\0]/.test(patch.name) || !patch.name.trim())) {
    throw new Error('Stash name must be a single non-empty line')
  }
  await updateMeta(cwd, id, () => {
    const { ref: _r, sha: _s, baseSubject: _b, ...meta } = current
    void _r
    void _s
    void _b
    return {
      ...meta,
      ...patch,
      name: patch.name?.trim() ?? meta.name,
      group: patch.group?.trim() ?? meta.group
    }
  })
}

/** App stashes go to the trash (recoverable); stack stashes are dropped. */
export async function deleteStash(cwd: string, target: StashTarget): Promise<void> {
  const t = await resolveTarget(cwd, target)
  if (target.kind === 'stack') {
    await git(cwd, ['stash', 'drop', '--quiet', t.label], { write: true })
    return
  }
  await git(cwd, ['update-ref', '-m', 'git-pro stash: trash', TRASH_PREFIX + target.id, t.sha], {
    write: true
  })
  await git(cwd, ['update-ref', '-d', t.ref, t.sha], { write: true })
  const store = await readStore(cwd)
  const meta = store.stashes[target.id]
  if (meta) {
    store.stashes[target.id] = { ...meta, deletedAt: Date.now() }
    await writeStore(cwd, store)
  }
}

export async function restoreStash(cwd: string, id: string): Promise<void> {
  assertStashId(id)
  const sha = await tryResolve(cwd, TRASH_PREFIX + id)
  if (!sha) throw new Error('Not in the trash')
  await git(cwd, ['update-ref', APP_PREFIX + id, sha], { write: true })
  await git(cwd, ['update-ref', '-d', TRASH_PREFIX + id, sha], { write: true })
  await updateMeta(cwd, id, (m) => (m ? { ...m, deletedAt: undefined } : m))
}

export async function purgeStash(cwd: string, id: string): Promise<void> {
  assertStashId(id)
  const sha = await tryResolve(cwd, TRASH_PREFIX + id)
  if (!sha) throw new Error('Not in the trash')
  await git(cwd, ['update-ref', '-d', TRASH_PREFIX + id, sha], { write: true })
  await updateMeta(cwd, id, () => undefined)
}

/** Creates a branch at the stash's base commit, switches to it and applies the stash there. */
export async function stashToBranch(
  cwd: string,
  target: StashTarget,
  branch: string
): Promise<void> {
  await assertBranchName(cwd, branch)
  const t = await resolveTarget(cwd, target)
  const base = await gitOut(cwd, ['rev-parse', `${t.sha}^1`])
  await git(cwd, ['switch', '-c', branch, base], { write: true })
  await git(cwd, ['stash', 'apply', '--index', t.sha], { write: true })
  await deleteStash(cwd, target)
}

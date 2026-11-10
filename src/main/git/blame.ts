import type { BlameCommit, BlameHunk, BlameResult } from '../../shared/types'
import { insideWorktree } from './hunks'
import { git } from './runner'
import { resolveCommit } from './util'

/** Above this many lines, blame is refused (the view would be unusable anyway). */
const MAX_LINES = 20000

/**
 * Parses `git blame --porcelain`. Each line starts with "<sha> <orig> <final> [<count>]";
 * the commit's details follow only the first time that commit appears; the content line
 * starts with a tab.
 */
export function parseBlame(out: string): Omit<BlameResult, 'path' | 'rev'> {
  const lines: string[] = []
  const hunks: BlameHunk[] = []
  const commits: Record<string, BlameCommit> = {}
  const rows = out.split('\n')
  let i = 0
  while (i < rows.length) {
    const header = /^([0-9a-f]{40,64}) (\d+) (\d+)(?: \d+)?$/.exec(rows[i])
    if (!header) {
      i++
      continue
    }
    const sha = header[1]
    const origLine = Number(header[2])
    i++
    const c: BlameCommit = commits[sha] ?? { sha, author: '', authorTime: 0, summary: '' }
    let origPath = ''
    for (; i < rows.length && !rows[i].startsWith('\t'); i++) {
      const row = rows[i]
      const sp = row.indexOf(' ')
      const key = sp < 0 ? row : row.slice(0, sp)
      const value = sp < 0 ? '' : row.slice(sp + 1)
      if (key === 'author') c.author = value
      else if (key === 'author-time') c.authorTime = Number(value)
      else if (key === 'summary') c.summary = value
      else if (key === 'filename') origPath = value
      else if (key === 'previous') {
        const p = value.indexOf(' ')
        c.previous = { sha: value.slice(0, p), path: value.slice(p + 1) }
      }
    }
    commits[sha] = c
    const content = i < rows.length ? rows[i].slice(1) : ''
    i++
    const last = hunks[hunks.length - 1]
    if (last && last.sha === sha && last.start + last.count === lines.length) {
      last.count++
    } else {
      hunks.push({
        start: lines.length,
        count: 1,
        sha,
        origLine,
        origPath: origPath || last?.origPath || ''
      })
    }
    if (origPath) hunks[hunks.length - 1].origPath ||= origPath
    lines.push(content)
  }
  return { lines, hunks, commits }
}

/** Who last changed each line of a file, at `rev` or (null) in the working tree. */
export async function blameFile(
  cwd: string,
  path: string,
  rev: string | null
): Promise<BlameResult> {
  insideWorktree(cwd, path)
  const args = ['blame', '--porcelain', '-M']
  if (rev) args.push(await resolveCommit(cwd, rev))
  args.push('--', path)
  const r = await git(cwd, args, { allowFail: true, quietStdout: true })
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'git blame failed')
  const parsed = parseBlame(r.stdout)
  if (parsed.lines.length > MAX_LINES) {
    throw new Error(`${path} has more than ${MAX_LINES} lines; blame it from a terminal`)
  }
  return { path, rev, ...parsed }
}

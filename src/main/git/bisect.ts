import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BisectState } from '../../shared/types'
import { git, gitOut } from './runner'
import { gitDir, isDirty, resolveCommit, tryResolve } from './util'

const IDLE: BisectState = {
  active: false,
  bad: null,
  good: [],
  skipped: [],
  current: null,
  remaining: null,
  candidates: null,
  firstBad: null
}

/** Where a bisect stands: the marks so far, how much is left, and the culprit once found. */
export async function bisectState(cwd: string): Promise<BisectState> {
  const dir = await gitDir(cwd)
  const logPath = join(dir, 'BISECT_LOG')
  if (!existsSync(logPath)) return IDLE
  const refs = (
    await gitOut(cwd, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/bisect'])
  )
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split(' ') as [string, string])
  const bad = refs.find(([r]) => r === 'refs/bisect/bad')?.[1] ?? null
  const good = refs.filter(([r]) => r.startsWith('refs/bisect/good-')).map(([, s]) => s)
  const skipped = refs.filter(([r]) => r.startsWith('refs/bisect/skip-')).map(([, s]) => s)

  // git writes "# first bad commit: [<sha>] <subject>" to the log once it is done.
  const log = readFileSync(logPath, 'utf8')
  const found = /^# first bad commit: \[([0-9a-f]+)\] (.*)$/m.exec(log)
  let remaining: number | null = null
  let candidates: number | null = null
  if (bad && good.length && !found) {
    const vars = await git(cwd, ['rev-list', '--bisect-vars', bad, ...good.map((g) => `^${g}`)], {
      allowFail: true
    })
    remaining = Number(/bisect_steps=(\d+)/.exec(vars.stdout)?.[1] ?? NaN)
    candidates = Number(/bisect_all=(\d+)/.exec(vars.stdout)?.[1] ?? NaN)
    if (!Number.isFinite(remaining)) remaining = null
    if (!Number.isFinite(candidates)) candidates = null
  }
  return {
    active: true,
    bad,
    good,
    skipped,
    current: await tryResolve(cwd, 'HEAD'),
    remaining,
    candidates,
    firstBad: found ? { sha: found[1], subject: found[2] } : null
  }
}

/**
 * Starts a bisect between a bad and a good commit; git checks out the midpoint. The working
 * tree must be clean, because every step checks out another commit.
 */
export async function bisectStart(cwd: string, bad: string, good: string): Promise<BisectState> {
  if ((await bisectState(cwd)).active) throw new Error('A bisect is already in progress')
  if (await isDirty(cwd)) {
    throw new Error('Bisect checks out other commits: commit or stash your changes first.')
  }
  const badSha = await resolveCommit(cwd, bad)
  const goodSha = await resolveCommit(cwd, good)
  if (badSha === goodSha) throw new Error('The good and bad commits are the same')
  const r = await git(cwd, ['bisect', 'start', badSha, goodSha], { write: true, allowFail: true })
  if (r.code !== 0) {
    await git(cwd, ['bisect', 'reset'], { write: true, allowFail: true })
    throw new Error(r.stderr.trim() || r.stdout.trim() || 'git bisect start failed')
  }
  return bisectState(cwd)
}

/** Marks the checked-out commit (or `rev`) good, bad or untestable. */
export async function bisectMark(
  cwd: string,
  verdict: 'good' | 'bad' | 'skip',
  rev?: string
): Promise<BisectState> {
  if (!['good', 'bad', 'skip'].includes(verdict)) throw new Error('Unknown verdict')
  if (!(await bisectState(cwd)).active) throw new Error('No bisect in progress')
  const args = ['bisect', verdict]
  if (rev) args.push(await resolveCommit(cwd, rev))
  const r = await git(cwd, args, { write: true, allowFail: true })
  if (r.code !== 0)
    throw new Error(r.stderr.trim() || r.stdout.trim() || `git bisect ${verdict} failed`)
  return bisectState(cwd)
}

/** Ends the bisect and returns to the branch it started from. */
export async function bisectReset(cwd: string): Promise<void> {
  await git(cwd, ['bisect', 'reset'], { write: true })
}

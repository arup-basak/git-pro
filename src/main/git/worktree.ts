import { toGitDateArg } from '../../shared/dates'
import type { CommitRequest, Person, RepoStatus } from '../../shared/types'
import { detectOp } from './opstate'
import { parseStatus } from './parse'
import { git, gitOut } from './runner'
import { tryResolve } from './util'

export async function getStatus(cwd: string): Promise<RepoStatus> {
  const out = await gitOut(cwd, [
    'status',
    '--porcelain=v2',
    '-z',
    '--branch',
    '--untracked-files=all'
  ])
  const s = parseStatus(out)
  const op = await detectOp(
    cwd,
    s.entries.filter((e) => e.conflicted).map((e) => e.path)
  )
  return { ...s, op }
}

function checkPaths(paths: string[]): void {
  for (const p of paths) if (!p || p.includes('\0')) throw new Error(`Invalid path "${p}"`)
}

export async function worktreeDiff(
  cwd: string,
  path: string,
  staged: boolean,
  untracked: boolean
): Promise<string> {
  checkPaths([path])
  // Fixed prefixes and no external diff tool, whatever the user's config says: the output is
  // parsed, and fed back to `git apply` for line staging.
  const base = ['diff', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/']
  if (untracked) {
    const r = await git(cwd, [...base, '--no-index', '--', '/dev/null', path], {
      allowFail: true,
      quietStdout: true
    })
    return r.stdout
  }
  const args = [...base, '-M', ...(staged ? ['--cached'] : []), '--', path]
  return (await git(cwd, args, { quietStdout: true })).stdout
}

export async function stage(cwd: string, paths: string[]): Promise<void> {
  checkPaths(paths)
  await git(cwd, ['add', '-A', '--', ...paths], { write: true })
}

export async function unstage(cwd: string, paths: string[]): Promise<void> {
  checkPaths(paths)
  if (await tryResolve(cwd, 'HEAD')) {
    await git(cwd, ['restore', '--staged', '--', ...paths], { write: true })
  } else {
    await git(cwd, ['rm', '--cached', '-r', '-q', '--', ...paths], { write: true })
  }
}

export async function discard(cwd: string, tracked: string[], untracked: string[]): Promise<void> {
  checkPaths([...tracked, ...untracked])
  if (tracked.length) {
    // Restore both index and worktree from HEAD so staged changes are discarded too.
    const hasHead = await tryResolve(cwd, 'HEAD')
    if (hasHead) {
      await git(cwd, ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...tracked], {
        write: true
      })
    } else {
      await git(cwd, ['rm', '--cached', '-r', '-q', '--', ...tracked], { write: true })
    }
  }
  if (untracked.length) {
    await git(cwd, ['clean', '-f', '-q', '--', ...untracked], { write: true })
  }
}

export async function identity(cwd: string): Promise<Person> {
  const get = async (key: string): Promise<string> => {
    const r = await git(cwd, ['config', '--get', key], { allowFail: true })
    return r.stdout.trim()
  }
  return { name: await get('user.name'), email: await get('user.email') }
}

export function assertPerson(p: Person): void {
  if (!p.name.trim()) throw new Error('Name is empty')
  if (/[<>\n\0]/.test(p.name)) throw new Error('Name must not contain <, > or newlines')
  if (/[<>\s\0]/.test(p.email)) throw new Error('Email must not contain <, > or whitespace')
}

function personArg(p: Person): string {
  assertPerson(p)
  return `${p.name} <${p.email}>`
}

export function commitEnv(
  req: Pick<CommitRequest, 'committer' | 'committerDate'>
): Record<string, string> {
  const env: Record<string, string> = {}
  if (req.committer) {
    assertPerson(req.committer)
    env.GIT_COMMITTER_NAME = req.committer.name
    env.GIT_COMMITTER_EMAIL = req.committer.email
  }
  if (req.committerDate) env.GIT_COMMITTER_DATE = toGitDateArg(req.committerDate)
  return env
}

export async function commit(cwd: string, req: CommitRequest): Promise<string> {
  const args = ['commit', '-F', '-', '--cleanup=strip']
  if (req.amend) args.push('--amend')
  if (req.signoff) args.push('--signoff')
  if (req.noVerify) args.push('--no-verify')
  if (req.allowEmpty) args.push('--allow-empty')
  if (req.sign === true) args.push('-S')
  else if (req.sign === false) args.push('--no-gpg-sign')
  if (req.author) args.push(`--author=${personArg(req.author)}`)
  if (req.authorDate) args.push(`--date=${toGitDateArg(req.authorDate)}`)
  if (!req.message.trim()) throw new Error('Commit message is empty')
  await git(cwd, args, { write: true, input: req.message, env: commitEnv(req) })
  return gitOut(cwd, ['rev-parse', 'HEAD'])
}

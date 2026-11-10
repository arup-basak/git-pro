import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { OpState, RebaseStop } from '../../shared/types'
import { git } from './runner'
import { gitDir } from './util'

function readTrim(path: string): string | null {
  try {
    return readFileSync(path, 'utf8').trim()
  } catch {
    return null
  }
}

/** Why a rebase is paused: conflicts, an `edit` stop, a `break`, or a failed `exec`. */
function rebaseStop(base: string, conflicted: string[]): RebaseStop {
  if (conflicted.length) return 'conflict'
  if (existsSync(join(base, 'amend'))) return 'edit'
  const last =
    readTrim(join(base, 'done'))
      ?.split('\n')
      .filter((l) => l && !l.startsWith('#'))
      .pop() ?? ''
  if (/^(break|b)(\s|$)/.test(last)) return 'break'
  if (/^(exec|x)\s/.test(last)) return 'exec'
  return 'conflict' // stopped on a pick whose conflicts are resolved but not yet continued
}

export async function detectOp(cwd: string, conflicted: string[]): Promise<OpState> {
  const dir = await gitDir(cwd)
  const rebaseMerge = join(dir, 'rebase-merge')
  const rebaseApply = join(dir, 'rebase-apply')
  if (existsSync(rebaseMerge) || existsSync(rebaseApply)) {
    const base = existsSync(rebaseMerge) ? rebaseMerge : rebaseApply
    const head = readTrim(join(base, 'head-name'))?.replace(/^refs\/heads\//, '') ?? 'HEAD'
    const n = readTrim(join(base, 'msgnum')) ?? readTrim(join(base, 'next'))
    const total = readTrim(join(base, 'end')) ?? readTrim(join(base, 'last'))
    const step = n && total ? ` (${n}/${total})` : ''
    const stoppedSha = readTrim(join(base, 'stopped-sha')) ?? undefined
    const stoppedSubject = readTrim(join(base, 'message'))?.split('\n')[0]
    return {
      kind: 'rebase',
      conflicted,
      detail: `Rebasing ${head}${step}`,
      rebaseStop: rebaseStop(base, conflicted),
      stoppedSha,
      stoppedSubject
    }
  }
  if (existsSync(join(dir, 'MERGE_HEAD'))) {
    return { kind: 'merge', conflicted, detail: 'Merge in progress' }
  }
  if (existsSync(join(dir, 'CHERRY_PICK_HEAD'))) {
    const sha = readTrim(join(dir, 'CHERRY_PICK_HEAD'))?.slice(0, 8)
    return { kind: 'cherry-pick', conflicted, detail: `Cherry-picking ${sha}` }
  }
  if (existsSync(join(dir, 'REVERT_HEAD'))) {
    const sha = readTrim(join(dir, 'REVERT_HEAD'))?.slice(0, 8)
    return { kind: 'revert', conflicted, detail: `Reverting ${sha}` }
  }
  if (existsSync(join(dir, 'BISECT_LOG'))) {
    return { kind: 'bisect', conflicted, detail: 'Bisect in progress' }
  }
  return { kind: 'none', conflicted }
}

/** Editor env that accepts whatever message git proposes (never opens an interactive editor). */
export const NON_INTERACTIVE_EDITOR = { GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true' }

export async function continueOp(cwd: string): Promise<void> {
  const op = await detectOp(cwd, [])
  const env = NON_INTERACTIVE_EDITOR
  switch (op.kind) {
    case 'rebase':
      await git(cwd, ['rebase', '--continue'], { write: true, env })
      return
    case 'merge':
      await git(cwd, ['commit', '--no-edit'], { write: true, env })
      return
    case 'cherry-pick':
      await git(cwd, ['cherry-pick', '--continue'], { write: true, env })
      return
    case 'revert':
      await git(cwd, ['revert', '--continue'], { write: true, env })
      return
    default:
      throw new Error('No operation in progress')
  }
}

export async function abortOp(cwd: string): Promise<void> {
  const op = await detectOp(cwd, [])
  const sub: Record<string, string[]> = {
    rebase: ['rebase', '--abort'],
    merge: ['merge', '--abort'],
    'cherry-pick': ['cherry-pick', '--abort'],
    revert: ['revert', '--abort'],
    bisect: ['bisect', 'reset']
  }
  const args = sub[op.kind]
  if (!args) throw new Error('No operation in progress')
  await git(cwd, args, { write: true })
}

export async function skipOp(cwd: string): Promise<void> {
  const op = await detectOp(cwd, [])
  const sub: Record<string, string[]> = {
    rebase: ['rebase', '--skip'],
    'cherry-pick': ['cherry-pick', '--skip'],
    revert: ['revert', '--skip']
  }
  const args = sub[op.kind]
  if (!args) throw new Error(`Cannot skip during ${op.kind}`)
  await git(cwd, args, { write: true, env: NON_INTERACTIVE_EDITOR })
}

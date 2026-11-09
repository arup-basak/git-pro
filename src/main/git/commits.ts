import type { ResetMode } from '../../shared/types'
import { backupHead } from './backup'
import { NON_INTERACTIVE_EDITOR } from './opstate'
import { git, gitOut } from './runner'
import { resolveCommit } from './util'

async function isMerge(cwd: string, sha: string): Promise<boolean> {
  const line = await gitOut(cwd, ['rev-list', '--parents', '-n1', sha])
  return line.split(' ').length > 2
}

export async function checkoutDetached(cwd: string, rev: string): Promise<void> {
  const sha = await resolveCommit(cwd, rev)
  await git(cwd, ['switch', '--detach', sha], { write: true })
}

export async function cherryPick(cwd: string, rev: string): Promise<void> {
  const sha = await resolveCommit(cwd, rev)
  const args = ['cherry-pick', ...((await isMerge(cwd, sha)) ? ['-m', '1'] : []), sha]
  await git(cwd, args, { write: true, env: NON_INTERACTIVE_EDITOR })
}

export async function revert(cwd: string, rev: string): Promise<void> {
  const sha = await resolveCommit(cwd, rev)
  const args = ['revert', '--no-edit', ...((await isMerge(cwd, sha)) ? ['-m', '1'] : []), sha]
  await git(cwd, args, { write: true, env: NON_INTERACTIVE_EDITOR })
}

/** Resets the current branch after recording a backup ref. Returns the backup ref. */
export async function reset(cwd: string, rev: string, mode: ResetMode): Promise<string | null> {
  const sha = await resolveCommit(cwd, rev)
  const backup = await backupHead(cwd, 'reset')
  await git(cwd, ['reset', `--${mode}`, sha], { write: true })
  return backup
}

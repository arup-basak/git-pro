import type { ResetMode } from '../../shared/types'
import { backupHead, createBackup } from './backup'
import { mergeTrees } from './mergeTree'
import { NON_INTERACTIVE_EDITOR } from './opstate'
import { FS } from './parse'
import { git, gitOut } from './runner'
import { assertBranchName, currentBranch, emptyTree, resolveCommit } from './util'

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

/**
 * Cherry-picks a commit onto a branch that is not checked out, without touching the working
 * tree: the commit's change is merged onto the branch tip in memory (merge-tree) and recorded
 * with the original author, date and message. Refuses when it would conflict. A backup of the
 * branch's old position is recorded first.
 */
export async function cherryPickTo(
  cwd: string,
  rev: string,
  branch: string
): Promise<{ branch: string; newTip: string; backupRef: string }> {
  const sha = await resolveCommit(cwd, rev)
  await assertBranchName(cwd, branch)
  if ((await currentBranch(cwd)) === branch) {
    throw new Error(`${branch} is checked out; use a normal cherry-pick`)
  }
  const tip = await resolveCommit(cwd, `refs/heads/${branch}`)
  const parents = (await gitOut(cwd, ['rev-list', '--parents', '-n1', sha])).split(' ').slice(1)
  // Merge commits are picked relative to their first parent, like `cherry-pick -m 1`.
  const base = parents[0] ?? (await emptyTree(cwd))
  const merged = await mergeTrees(cwd, base, tip, sha)
  if (!merged.clean) {
    throw new Error(
      `Cherry-picking ${sha.slice(0, 8)} onto ${branch} conflicts in ${[...merged.conflicted].join(', ')}`
    )
  }
  if (merged.tree === (await gitOut(cwd, ['rev-parse', `${tip}^{tree}`]))) {
    throw new Error(`${branch} already has the changes of ${sha.slice(0, 8)}`)
  }
  const [name, email, date, message] = (
    await gitOut(cwd, ['log', '-1', `--format=%an${FS}%ae${FS}%ad${FS}%B`, '--date=raw', sha])
  ).split(FS)
  const newTip = await gitOut(cwd, ['commit-tree', merged.tree, '-p', tip, '-F', '-'], {
    input: message,
    env: { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: date }
  })
  const backupRef = await createBackup(cwd, branch, tip, 'cherry-pick')
  await git(
    cwd,
    [
      'update-ref',
      '-m',
      `git-pro: cherry-pick ${sha.slice(0, 8)}`,
      `refs/heads/${branch}`,
      newTip,
      tip
    ],
    { write: true }
  )
  return { branch, newTip, backupRef }
}

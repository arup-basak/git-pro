import { createBackup } from './backup'
import { git } from './runner'
import { assertBranchName, assertSafe, currentBranch, resolveCommit } from './util'

export async function createBranch(
  cwd: string,
  name: string,
  startPoint: string,
  checkout: boolean
): Promise<void> {
  await assertBranchName(cwd, name)
  const sha = await resolveCommit(cwd, startPoint)
  if (checkout) await git(cwd, ['switch', '-c', name, sha], { write: true })
  else await git(cwd, ['branch', name, sha], { write: true })
}

export async function checkoutBranch(cwd: string, name: string): Promise<void> {
  await assertBranchName(cwd, name)
  await git(cwd, ['switch', name], { write: true })
}

export async function checkoutRemoteBranch(
  cwd: string,
  remoteShort: string,
  localName: string
): Promise<void> {
  assertSafe(remoteShort, 'remote branch')
  await assertBranchName(cwd, localName)
  await git(cwd, ['switch', '-c', localName, '--track', remoteShort], { write: true })
}

export async function renameBranch(cwd: string, oldName: string, newName: string): Promise<void> {
  await assertBranchName(cwd, oldName)
  await assertBranchName(cwd, newName)
  await git(cwd, ['branch', '-m', oldName, newName], { write: true })
}

/** Deletes a local branch after recording a backup ref. Returns the backup ref. */
export async function deleteBranch(cwd: string, name: string, force: boolean): Promise<string> {
  await assertBranchName(cwd, name)
  const sha = await resolveCommit(cwd, `refs/heads/${name}`)
  const backup = await createBackup(cwd, name, sha, 'delete')
  const r = await git(cwd, ['branch', force ? '-D' : '-d', name], { write: true, allowFail: true })
  if (r.code !== 0) {
    await git(cwd, ['update-ref', '-d', backup], { write: true })
    throw new Error(r.stderr.trim() || `Could not delete ${name}`)
  }
  return backup
}

export async function setUpstream(
  cwd: string,
  name: string,
  upstream: string | null
): Promise<void> {
  await assertBranchName(cwd, name)
  if (upstream === null) {
    await git(cwd, ['branch', '--unset-upstream', name], { write: true })
  } else {
    assertSafe(upstream, 'upstream')
    await git(cwd, ['branch', `--set-upstream-to=${upstream}`, name], { write: true })
  }
}

/**
 * Points a branch that is not checked out at another commit (`git branch -f`), after recording
 * a backup of where it was. The checked-out branch is moved with reset instead.
 */
export async function moveBranch(cwd: string, name: string, rev: string): Promise<string> {
  await assertBranchName(cwd, name)
  if ((await currentBranch(cwd)) === name) {
    throw new Error(`${name} is checked out; use Reset to move it`)
  }
  const sha = await resolveCommit(cwd, rev)
  const old = await resolveCommit(cwd, `refs/heads/${name}`)
  const backup = await createBackup(cwd, name, old, 'move')
  await git(cwd, ['update-ref', '-m', 'git-pro: move branch', `refs/heads/${name}`, sha, old], {
    write: true
  })
  return backup
}

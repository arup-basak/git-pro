import type { BackupInfo } from '../../shared/types'
import { FS, RS } from './parse'
import { git, gitOut } from './runner'
import { assertBranchName, currentBranch, refExists, resolveCommit, tryResolve } from './util'

export const BACKUP_PREFIX = 'refs/git-pro/backups/'

function stamp(d = new Date()): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`
  )
}

/**
 * Records `sha` under refs/git-pro/backups/<stamp>-<reason>/<name>. These refs are not pushed
 * by default and keep the old commits reachable (so gc never removes them).
 */
export async function createBackup(
  cwd: string,
  name: string,
  sha: string,
  reason: string
): Promise<string> {
  const ref = `${BACKUP_PREFIX}${stamp()}-${reason}/${name}`
  await git(cwd, ['update-ref', '-m', `git-pro backup (${reason})`, ref, sha], { write: true })
  return ref
}

/** Backs up the current branch (or detached HEAD). Returns null on an unborn HEAD. */
export async function backupHead(cwd: string, reason: string): Promise<string | null> {
  const head = await tryResolve(cwd, 'HEAD')
  if (!head) return null
  const branch = await currentBranch(cwd)
  return createBackup(cwd, branch ?? 'HEAD', head, reason)
}

export function parseBackupRef(ref: string): { createdAt: number; reason: string; name: string } {
  const rest = ref.slice(BACKUP_PREFIX.length)
  const slash = rest.indexOf('/')
  const head = rest.slice(0, slash)
  const name = rest.slice(slash + 1)
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d{3})-(.+)$/.exec(head)
  if (!m) return { createdAt: 0, reason: head, name }
  const createdAt = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]).getTime()
  return { createdAt, reason: m[8], name }
}

export async function listBackups(cwd: string): Promise<BackupInfo[]> {
  const out = await gitOut(cwd, [
    'for-each-ref',
    '--format=%(refname)%1f%(objectname)%1f%(contents:subject)%1e',
    BACKUP_PREFIX
  ])
  const list: BackupInfo[] = []
  for (const rec of out.split(RS)) {
    const r = rec.replace(/^\n/, '')
    if (!r) continue
    const [ref, sha, subject] = r.split(FS)
    list.push({ ref, sha, subject, ...parseBackupRef(ref) })
  }
  return list.sort((a, b) => b.createdAt - a.createdAt)
}

function assertBackupRef(ref: string): void {
  if (!ref.startsWith(BACKUP_PREFIX) || ref.includes('..')) throw new Error('Not a backup ref')
}

export async function restoreBackup(
  cwd: string,
  ref: string,
  mode: 'new-branch' | 'reset-original',
  newName?: string
): Promise<void> {
  assertBackupRef(ref)
  const sha = await resolveCommit(cwd, ref)
  if (mode === 'new-branch') {
    if (!newName) throw new Error('A branch name is required')
    await assertBranchName(cwd, newName)
    await git(cwd, ['branch', newName, sha], { write: true })
    return
  }
  const { name } = parseBackupRef(ref)
  if (name === 'HEAD')
    throw new Error('This backup was of a detached HEAD; restore it as a new branch')
  await assertBranchName(cwd, name)
  const branchRef = `refs/heads/${name}`
  if (!(await refExists(cwd, branchRef))) {
    await git(cwd, ['branch', name, sha], { write: true })
    return
  }
  const currentSha = await resolveCommit(cwd, branchRef)
  if (currentSha === sha) return
  await createBackup(cwd, name, currentSha, 'pre-restore')
  if ((await currentBranch(cwd)) === name) {
    // --keep refuses to discard local modifications instead of silently losing them.
    await git(cwd, ['reset', '--keep', sha], { write: true })
  } else {
    await git(cwd, ['branch', '-f', name, sha], { write: true })
  }
}

export async function deleteBackup(cwd: string, ref: string): Promise<void> {
  assertBackupRef(ref)
  await git(cwd, ['update-ref', '-d', ref], { write: true })
}

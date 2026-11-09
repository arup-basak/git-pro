import { toGitDateArg } from '../../shared/dates'
import type { GitDate } from '../../shared/types'
import { listRemotes } from './log'
import { git } from './runner'
import { assertRefName, assertSafe, resolveCommit } from './util'

async function assertTagName(cwd: string, name: string): Promise<void> {
  assertSafe(name, 'tag name')
  await assertRefName(cwd, `refs/tags/${name}`)
}

async function assertRemote(cwd: string, remote: string): Promise<void> {
  assertSafe(remote, 'remote')
  if (!(await listRemotes(cwd)).some((r) => r.name === remote)) {
    throw new Error(`Unknown remote "${remote}"`)
  }
}

export async function createTag(
  cwd: string,
  name: string,
  target: string,
  annotation: { message: string; date?: GitDate } | null
): Promise<void> {
  await assertTagName(cwd, name)
  const sha = await resolveCommit(cwd, target)
  if (!annotation) {
    await git(cwd, ['tag', name, sha], { write: true })
    return
  }
  // The tagger date is taken from GIT_COMMITTER_DATE.
  const env = annotation.date ? { GIT_COMMITTER_DATE: toGitDateArg(annotation.date) } : undefined
  await git(cwd, ['tag', '-a', name, sha, '-F', '-'], {
    write: true,
    input: annotation.message || name,
    env
  })
}

export async function deleteTag(cwd: string, name: string): Promise<void> {
  await assertTagName(cwd, name)
  await git(cwd, ['tag', '-d', name], { write: true })
}

export async function pushTag(cwd: string, remote: string, name: string): Promise<void> {
  await assertRemote(cwd, remote)
  await assertTagName(cwd, name)
  await git(cwd, ['push', remote, `refs/tags/${name}`], { write: true })
}

export async function deleteRemoteTag(cwd: string, remote: string, name: string): Promise<void> {
  await assertRemote(cwd, remote)
  await assertTagName(cwd, name)
  await git(cwd, ['push', remote, '--delete', `refs/tags/${name}`], { write: true })
}

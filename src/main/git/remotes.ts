import { buildPushArgs } from '../../shared/push'
import type { PushResult, PushSpec } from '../../shared/types'
import { listRemotes } from './log'
import { git } from './runner'
import {
  assertBranchName,
  assertRefName,
  assertSafe,
  refExists,
  resolveCommit,
  tryResolve
} from './util'

export async function assertRemote(cwd: string, remote: string): Promise<void> {
  assertSafe(remote, 'remote')
  const remotes = await listRemotes(cwd)
  if (!remotes.some((r) => r.name === remote)) throw new Error(`Unknown remote "${remote}"`)
}

export async function fetch(
  cwd: string,
  remote: string | null,
  prune: boolean,
  onProgress?: (l: string) => void
): Promise<void> {
  const args = ['fetch', '--progress']
  if (prune) args.push('--prune')
  if (remote) {
    await assertRemote(cwd, remote)
    args.push(remote)
  } else {
    args.push('--all')
  }
  await git(cwd, args, { write: true, onProgress })
}

export async function pull(
  cwd: string,
  mode: 'ff-only' | 'merge' | 'rebase',
  onProgress?: (l: string) => void
): Promise<void> {
  const flag = mode === 'ff-only' ? '--ff-only' : mode === 'rebase' ? '--rebase' : '--no-rebase'
  await git(cwd, ['pull', '--progress', flag], {
    write: true,
    onProgress,
    env: { GIT_EDITOR: 'true' }
  })
}

/** Validates a PushSpec and fills in the lease expectation from the remote-tracking ref. */
export async function preparePush(cwd: string, spec: PushSpec): Promise<PushSpec> {
  await assertRemote(cwd, spec.remote)
  await assertRefName(cwd, `refs/heads/${spec.dest}`)
  assertSafe(spec.dest, 'destination branch')
  if (spec.sourceKind === 'branch') {
    await assertBranchName(cwd, spec.source)
    if (!(await refExists(cwd, `refs/heads/${spec.source}`))) {
      throw new Error(`Local branch "${spec.source}" does not exist`)
    }
  } else {
    // Push the resolved SHA so tags/abbreviations can't be reinterpreted on the remote side.
    spec = { ...spec, source: await resolveCommit(cwd, spec.source) }
  }
  if (spec.force === 'lease') {
    const tracking = await tryResolve(cwd, `refs/remotes/${spec.remote}/${spec.dest}`)
    spec = { ...spec, leaseExpect: tracking ?? '' }
  }
  return spec
}

export async function push(
  cwd: string,
  input: PushSpec,
  onProgress?: (l: string) => void
): Promise<PushResult> {
  const spec = await preparePush(cwd, input)
  const r = await git(cwd, buildPushArgs(spec), { write: true, allowFail: true, onProgress })
  const statusLines = r.stdout
    .split('\n')
    .filter((l) => /^[ +\-*=!]\t/.test(l))
    .map((l) => {
      const [flag, refs, summary] = l.split('\t')
      const label =
        flag === '!'
          ? 'rejected'
          : flag === '*'
            ? 'new'
            : flag === '+'
              ? 'forced'
              : flag === '-'
                ? 'deleted'
                : flag === '='
                  ? 'up to date'
                  : 'updated'
      return `${label}: ${refs}${summary ? ` ${summary}` : ''}`
    })
  const ok = r.code === 0
  const errLines = r.stderr
    .split('\n')
    .filter((l) => /^(error|fatal|hint|remote):/.test(l))
    .join('\n')
  return {
    ok,
    summary: statusLines.join('\n') || (ok ? 'Pushed' : errLines || 'Push failed'),
    output: [r.stdout.trim(), r.stderr.trim()].filter(Boolean).join('\n')
  }
}

export async function deleteRemoteBranch(cwd: string, remote: string, name: string): Promise<void> {
  await assertRemote(cwd, remote)
  await assertRefName(cwd, `refs/heads/${name}`)
  await git(cwd, ['push', remote, '--delete', `refs/heads/${name}`], { write: true })
}

export async function addRemote(cwd: string, name: string, url: string): Promise<void> {
  assertSafe(name, 'remote name')
  assertSafe(url, 'URL')
  await git(cwd, ['remote', 'add', name, url], { write: true })
}

export async function removeRemote(cwd: string, name: string): Promise<void> {
  await assertRemote(cwd, name)
  await git(cwd, ['remote', 'remove', name], { write: true })
}

export async function setRemoteUrl(cwd: string, name: string, url: string): Promise<void> {
  await assertRemote(cwd, name)
  assertSafe(url, 'URL')
  await git(cwd, ['remote', 'set-url', name, url], { write: true })
}

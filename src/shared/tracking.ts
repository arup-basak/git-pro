import type { BranchInfo, RefsSnapshot, RemoteBranchInfo, RemoteInfo } from './types'

/**
 * How a local branch is connected to a remote:
 * - `tracking`: has an upstream that exists.
 * - `gone`: has an upstream, but that branch was deleted on the remote (seen after a prune).
 * - `unlinked`: no upstream, but a remote branch with the same name exists (`candidate`).
 * - `unpublished`: no upstream and no same-named branch on any remote.
 */
export type BranchTracking =
  | { kind: 'tracking'; upstream: string }
  | { kind: 'gone'; upstream: string }
  | { kind: 'unlinked'; candidate: string }
  | { kind: 'unpublished' }

/** The remote new branches go to by default: "origin" when there is one, else the first. */
export function defaultRemote(remotes: Pick<RemoteInfo, 'name'>[]): string | null {
  return remotes.find((r) => r.name === 'origin')?.name ?? remotes[0]?.name ?? null
}

/** Splits "origin/feature/x" into remote and branch, given the known remote names. */
export function splitRemoteRef(
  short: string,
  remotes: Pick<RemoteInfo, 'name'>[]
): { remote: string; name: string } | null {
  const remote = remotes
    .map((r) => r.name)
    .sort((a, b) => b.length - a.length)
    .find((n) => short.startsWith(n + '/'))
  return remote ? { remote, name: short.slice(remote.length + 1) } : null
}

export function branchTracking(
  b: Pick<BranchInfo, 'name' | 'upstream' | 'gone'>,
  remoteBranches: Pick<RemoteBranchInfo, 'remote' | 'name' | 'short'>[],
  preferredRemote: string | null
): BranchTracking {
  if (b.upstream)
    return b.gone
      ? { kind: 'gone', upstream: b.upstream }
      : { kind: 'tracking', upstream: b.upstream }
  const same = remoteBranches.filter((r) => r.name === b.name)
  const candidate = same.find((r) => r.remote === preferredRemote) ?? same[0]
  return candidate ? { kind: 'unlinked', candidate: candidate.short } : { kind: 'unpublished' }
}

export interface TrackingOverview {
  defaultRemote: string | null
  /** Tracking state of every local branch, by name. */
  byBranch: Map<string, BranchTracking>
  /** Remote branches that no local branch tracks or shares a name with. */
  remoteOnly: RemoteBranchInfo[]
  /** Local branch that tracks each remote branch, by "origin/x". */
  trackedBy: Map<string, string>
  /** Local branches that need attention (gone, unlinked or unpublished). */
  issues: number
}

export function trackingOverview(
  snap: Pick<RefsSnapshot, 'branches' | 'remoteBranches' | 'remotes'>
): TrackingOverview {
  const preferred = defaultRemote(snap.remotes)
  const byBranch = new Map<string, BranchTracking>()
  const trackedBy = new Map<string, string>()
  let issues = 0
  for (const b of snap.branches) {
    const t = branchTracking(b, snap.remoteBranches, preferred)
    byBranch.set(b.name, t)
    if (t.kind === 'tracking') trackedBy.set(t.upstream, b.name)
    // Without a remote there is nowhere to publish to, so "unpublished" is not actionable.
    else if (t.kind !== 'unpublished' || snap.remotes.length > 0) issues++
  }
  const localNames = new Set(snap.branches.map((b) => b.name))
  const remoteOnly = snap.remoteBranches.filter(
    (r) => !trackedBy.has(r.short) && !localNames.has(r.name)
  )
  return { defaultRemote: preferred, byBranch, remoteOnly, trackedBy, issues }
}

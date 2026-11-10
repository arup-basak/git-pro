import {
  splitRemoteRef,
  trackingOverview,
  type BranchTracking,
  type TrackingOverview
} from '@shared/tracking'
import type {
  BatchResult,
  LocalTrackingBranch,
  PublishItem,
  PublishResult,
  RefsSnapshot,
  UpstreamChange
} from '@shared/types'
import { useMemo } from 'react'
import { toast } from 'sonner'
import type { MenuEntry } from '../components/ui'
import { queryClient } from './actions'
import { call } from './api'
import { invalidateRepo, showError, useRefs } from './queries'
import { useUi } from './store'

/* Connecting local branches to remote branches: publish, track, stop tracking, create local. */

function repoId(): string {
  const r = useUi.getState().repo
  if (!r) throw new Error('No repository open')
  return r.id
}

/** Tracking state of every branch, derived from the refs snapshot (no extra git calls). */
export function useTracking(): TrackingOverview | null {
  const refs = useRefs()
  return useMemo(() => (refs.data ? trackingOverview(refs.data) : null), [refs.data])
}

function names(list: string[], max = 5): string {
  return list.length <= max
    ? list.join(', ')
    : `${list.slice(0, max).join(', ')} and ${list.length - max} more`
}

function failures(r: BatchResult): string {
  return r.failed.map((f) => `${f.name}: ${f.error}`).join('\n')
}

/** Pushes branches to `remote` and tracks them. Resolves to the result, or undefined on error. */
export async function publishBranches(
  remote: string,
  items: PublishItem[]
): Promise<PublishResult | undefined> {
  if (!items.length) return undefined
  const id = repoId()
  try {
    const r = await call('tracking.publish', id, remote, items)
    const ok = r.outcomes.filter((o) => o.ok)
    const bad = r.outcomes.filter((o) => !o.ok)
    if (!bad.length) {
      const one = items.length === 1 ? items[0] : null
      toast.success(
        one
          ? `Published ${one.branch} to ${remote}/${one.dest}`
          : `Published ${ok.length} branches to ${remote}`,
        {
          description: one
            ? `${ok[0].status} · ${one.branch} now tracks ${remote}/${one.dest}`
            : names(ok.map((o) => o.branch))
        }
      )
    } else {
      toast.error(
        ok.length
          ? `Published ${ok.length} of ${items.length} branches to ${remote}`
          : `Could not publish to ${remote}`,
        {
          description: bad.map((o) => `${o.branch}: ${o.status}`).join('\n'),
          duration: 12000
        }
      )
    }
    return r
  } catch (e) {
    showError(e, 'Publish failed')
    return undefined
  } finally {
    void invalidateRepo(queryClient, id)
  }
}

export const publishBranch = (
  branch: string,
  remote: string,
  dest = branch
): Promise<PublishResult | undefined> => publishBranches(remote, [{ branch, dest }])

/** Opens the Push dialog for a branch with "Set as upstream" on (other name, force, tags…). */
export function publishWithOptions(branch: string, remote?: string, dest = branch): void {
  useUi
    .getState()
    .openPush({ sourceKind: 'branch', source: branch, remote, dest, setUpstream: true })
}

export async function setUpstreams(
  changes: UpstreamChange[],
  success: (done: string[]) => string
): Promise<BatchResult | undefined> {
  if (!changes.length) return undefined
  const id = repoId()
  try {
    const r = await call('tracking.setUpstreams', id, changes)
    if (r.done.length) toast.success(success(r.done))
    if (r.failed.length) {
      toast.error(`${r.failed.length} branch${r.failed.length === 1 ? '' : 'es'} not changed`, {
        description: failures(r),
        duration: 12000
      })
    }
    return r
  } catch (e) {
    showError(e, 'Could not change upstream')
    return undefined
  } finally {
    void invalidateRepo(queryClient, id)
  }
}

export const trackUpstream = (branch: string, upstream: string): Promise<unknown> =>
  setUpstreams([{ branch, upstream }], () => `${branch} now tracks ${upstream}`)

export const stopTracking = (branch: string, upstream: string): Promise<unknown> =>
  setUpstreams([{ branch, upstream: null }], () => `${branch} no longer tracks ${upstream}`)

export async function createLocalBranches(
  items: LocalTrackingBranch[]
): Promise<BatchResult | undefined> {
  if (!items.length) return undefined
  const id = repoId()
  try {
    const r = await call('tracking.createLocal', id, items)
    if (r.done.length) {
      toast.success(
        r.done.length === 1
          ? `Created ${r.done[0]} tracking ${items.find((i) => i.name === r.done[0])?.remoteBranch}`
          : `Created ${r.done.length} local branches`,
        { description: r.done.length > 1 ? names(r.done) : 'Nothing was checked out.' }
      )
    }
    if (r.failed.length) {
      toast.error(`${r.failed.length} branch${r.failed.length === 1 ? '' : 'es'} not created`, {
        description: failures(r),
        duration: 12000
      })
    }
    return r
  } catch (e) {
    showError(e, 'Could not create branches')
    return undefined
  } finally {
    void invalidateRepo(queryClient, id)
  }
}

/** Where a branch whose upstream was deleted would be published again. */
export function republishTarget(
  upstream: string,
  refs: Pick<RefsSnapshot, 'remotes'>
): { remote: string; dest: string } | null {
  const split = splitRemoteRef(upstream, refs.remotes)
  return split ? { remote: split.remote, dest: split.name } : null
}

/** Context-menu entries that connect a local branch to a remote, for its tracking state. */
export function branchTrackingEntries(
  name: string,
  state: BranchTracking | undefined,
  refs: Pick<RefsSnapshot, 'remotes'>,
  preferredRemote: string | null
): MenuEntry[] {
  if (!state) return []
  const remotes = refs.remotes.map((r) => r.name)
  switch (state.kind) {
    case 'unpublished': {
      if (!remotes.length)
        return [{ label: 'Not on any remote (add a remote to publish)', disabled: true }]
      const ordered = [...remotes].sort((a, b) =>
        a === preferredRemote ? -1 : b === preferredRemote ? 1 : 0
      )
      return [
        ...ordered.map((r) => ({
          label: `Publish to ${r}`,
          hint: `${r}/${name}`,
          onSelect: () => void publishBranch(name, r)
        })),
        { label: 'Publish with options…', onSelect: () => publishWithOptions(name, ordered[0]) }
      ]
    }
    case 'unlinked':
      return [
        {
          label: `Track ${state.candidate}`,
          onSelect: () => void trackUpstream(name, state.candidate)
        }
      ]
    case 'gone': {
      const t = republishTarget(state.upstream, refs)
      return [
        {
          label: `Publish again to ${state.upstream}`,
          disabled: !t,
          onSelect: () => t && void publishBranch(name, t.remote, t.dest)
        },
        {
          label: `Stop tracking ${state.upstream}`,
          onSelect: () => void stopTracking(name, state.upstream)
        }
      ]
    }
    case 'tracking':
      return [
        {
          label: `Stop tracking ${state.upstream}`,
          onSelect: () => void stopTracking(name, state.upstream)
        }
      ]
  }
}

/** One-line description of a branch's tracking state, for tooltips. */
export function describeTracking(state: BranchTracking | undefined, hasRemotes: boolean): string {
  switch (state?.kind) {
    case 'tracking':
      return `tracks ${state.upstream}`
    case 'gone':
      return `upstream ${state.upstream} was deleted on the remote`
    case 'unlinked':
      return `${state.candidate} exists but is not tracked`
    case 'unpublished':
      return hasRemotes ? 'not on any remote yet' : 'local only (no remotes)'
    default:
      return ''
  }
}

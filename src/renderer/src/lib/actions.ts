import { nowGitDate } from '@shared/dates'
import type { AppStash, GitDate, ResetMode, StackStash, StashTarget } from '@shared/types'
import { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { confirmDialog, openForm } from './dialogs'
import { call, errorParts } from './api'
import { short } from './format'
import { invalidateRepo, showError } from './queries'
import { useUi } from './store'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 2000, refetchOnWindowFocus: false, retry: false }
  }
})

function repoId(): string {
  const r = useUi.getState().repo
  if (!r) throw new Error('No repository open')
  return r.id
}

/** Runs a git action with toasts and a full refresh afterwards. Returns undefined on failure. */
export async function run<T>(
  fn: () => Promise<T>,
  success?: string | ((r: T) => string | null),
  errorTitle?: string
): Promise<T | undefined> {
  const id = repoId()
  try {
    const r = await fn()
    const msg = typeof success === 'function' ? success(r) : success
    if (msg) toast.success(msg)
    return r
  } catch (e) {
    showError(e, errorTitle)
    return undefined
  } finally {
    void invalidateRepo(queryClient, id)
  }
}

export const copy = (text: string, what = 'Copied'): void => {
  void navigator.clipboard.writeText(text)
  toast.success(what, {
    description: text.length > 60 ? text.slice(0, 60) + '…' : text,
    duration: 1500
  })
}

/* ---------- branches ---------- */

export async function createBranchAt(startPoint: string, label = short(startPoint)): Promise<void> {
  const v = await openForm<{ name: string; checkout: boolean }>({
    title: 'Create branch',
    description: `Starting at ${label}`,
    submitLabel: 'Create',
    fields: [
      {
        name: 'name',
        label: 'Branch name',
        type: 'text',
        required: true,
        mono: true,
        placeholder: 'feature/my-branch'
      },
      { name: 'checkout', label: 'Check out after creating', type: 'checkbox', default: true }
    ]
  })
  if (!v) return
  await run(
    () => call('branch.create', repoId(), v.name.trim(), startPoint, v.checkout),
    `Created ${v.name.trim()}`
  )
}

export const checkoutBranch = (name: string): Promise<unknown> =>
  run(() => call('branch.checkout', repoId(), name), `Switched to ${name}`)

export async function checkoutRemoteBranch(remoteShort: string, remoteName: string): Promise<void> {
  const v = await openForm<{ name: string }>({
    title: 'Check out remote branch',
    description: `Creates a local branch tracking ${remoteShort}`,
    submitLabel: 'Check out',
    fields: [
      {
        name: 'name',
        label: 'Local branch name',
        type: 'text',
        default: remoteName,
        required: true,
        mono: true
      }
    ]
  })
  if (!v) return
  await run(
    () => call('branch.checkoutRemote', repoId(), remoteShort, v.name.trim()),
    `Switched to ${v.name.trim()}`
  )
}

export async function renameBranch(name: string): Promise<void> {
  const v = await openForm<{ name: string }>({
    title: `Rename ${name}`,
    submitLabel: 'Rename',
    fields: [
      { name: 'name', label: 'New name', type: 'text', default: name, required: true, mono: true }
    ]
  })
  if (!v || v.name.trim() === name) return
  await run(
    () => call('branch.rename', repoId(), name, v.name.trim()),
    `Renamed to ${v.name.trim()}`
  )
}

export async function deleteBranch(name: string): Promise<void> {
  const ok = await confirmDialog({
    title: `Delete branch ${name}?`,
    message: 'A backup ref is kept, so you can restore it later from Backups.',
    confirmLabel: 'Delete',
    danger: true
  })
  if (!ok) return
  try {
    await call('branch.delete', repoId(), name, false)
    toast.success(`Deleted ${name}`)
  } catch (e) {
    const { message } = errorParts(e)
    if (/not fully merged/i.test(message)) {
      const force = await confirmDialog({
        title: `${name} is not fully merged`,
        message: `Commits on ${name} are not on its upstream or HEAD. Delete anyway? (A backup ref is kept.)`,
        confirmLabel: 'Force delete',
        danger: true
      })
      if (force) await run(() => call('branch.delete', repoId(), name, true), `Deleted ${name}`)
    } else {
      showError(e)
    }
  } finally {
    void invalidateRepo(queryClient, repoId())
  }
}

export async function setUpstream(
  name: string,
  remoteBranches: string[],
  current?: string
): Promise<void> {
  const v = await openForm<{ upstream: string }>({
    title: `Upstream for ${name}`,
    submitLabel: 'Save',
    fields: [
      {
        name: 'upstream',
        label: 'Tracks',
        type: 'select',
        default: current ?? '',
        options: [
          { value: '', label: '(none)' },
          ...remoteBranches.map((r) => ({ value: r, label: r }))
        ]
      }
    ]
  })
  if (!v) return
  await run(
    () => call('branch.setUpstream', repoId(), name, v.upstream || null),
    'Upstream updated'
  )
}

export async function deleteRemoteBranch(remote: string, name: string): Promise<void> {
  const ok = await confirmDialog({
    title: `Delete ${remote}/${name} on the remote?`,
    message: `Runs git push ${remote} --delete refs/heads/${name}. This affects everyone using ${remote}.`,
    confirmLabel: 'Delete on remote',
    danger: true
  })
  if (ok)
    await run(
      () => call('remote.deleteBranch', repoId(), remote, name),
      `Deleted ${remote}/${name}`
    )
}

/* ---------- commits ---------- */

export async function checkoutCommit(sha: string): Promise<void> {
  const ok = await confirmDialog({
    title: `Check out ${short(sha)}?`,
    message: 'HEAD will be detached. Create a branch if you want to keep new commits.',
    confirmLabel: 'Check out'
  })
  if (ok) await run(() => call('commit.checkout', repoId(), sha), `HEAD is now at ${short(sha)}`)
}

export async function cherryPick(sha: string): Promise<void> {
  await run(
    () => call('commit.cherryPick', repoId(), sha),
    `Cherry-picked ${short(sha)}`,
    'Cherry-pick stopped'
  )
}

export async function revertCommit(sha: string): Promise<void> {
  const ok = await confirmDialog({
    title: `Revert ${short(sha)}?`,
    message: 'Creates a new commit that undoes this commit on the current branch.',
    confirmLabel: 'Revert'
  })
  if (ok)
    await run(
      () => call('commit.revert', repoId(), sha),
      `Reverted ${short(sha)}`,
      'Revert stopped'
    )
}

export async function resetTo(sha: string, branch: string | null): Promise<void> {
  const v = await openForm<{ mode: ResetMode }>({
    title: `Reset ${branch ?? 'HEAD'} to ${short(sha)}`,
    description: 'A backup ref of the current position is created first.',
    submitLabel: 'Reset',
    danger: true,
    fields: [
      {
        name: 'mode',
        label: 'Mode',
        type: 'select',
        default: 'mixed',
        options: [
          { value: 'soft', label: 'Soft — keep index and working tree' },
          { value: 'mixed', label: 'Mixed — keep working tree, reset index' },
          { value: 'keep', label: 'Keep — reset, but refuse if local changes would be lost' },
          { value: 'hard', label: 'Hard — discard all local changes' }
        ]
      }
    ]
  })
  if (!v) return
  if (v.mode === 'hard') {
    const ok = await confirmDialog({
      title: 'Discard all local changes?',
      message:
        'A hard reset throws away uncommitted changes in tracked files. Those cannot be recovered.',
      confirmLabel: 'Hard reset',
      danger: true
    })
    if (!ok) return
  }
  await run(() => call('commit.reset', repoId(), sha, v.mode), `Reset to ${short(sha)}`)
}

export function editHistoryFrom(sha: string, parent: string | null, tip?: string): void {
  const ui = useUi.getState()
  ui.openHistory({ tip: tip ?? ui.graphRef ?? 'HEAD', base: { sha: parent }, focus: sha })
}

/* ---------- tags ---------- */

export async function createTagAt(sha: string): Promise<void> {
  const v = await openForm<{
    name: string
    annotated: boolean
    message: string
    customDate: boolean
    date: GitDate
  }>({
    title: `Tag ${short(sha)}`,
    submitLabel: 'Create tag',
    fields: [
      {
        name: 'name',
        label: 'Tag name',
        type: 'text',
        required: true,
        mono: true,
        placeholder: 'v1.2.3'
      },
      { name: 'annotated', label: 'Annotated tag', type: 'checkbox', default: true },
      { name: 'message', label: 'Message', type: 'textarea', showIf: (x) => !!x.annotated },
      {
        name: 'customDate',
        label: 'Custom tagger date',
        type: 'checkbox',
        showIf: (x) => !!x.annotated
      },
      {
        name: 'date',
        label: 'Tagger date',
        type: 'date',
        default: nowGitDate(),
        showIf: (x) => !!x.annotated && !!x.customDate
      }
    ]
  })
  if (!v) return
  const annotation = v.annotated
    ? { message: v.message || v.name, date: v.customDate ? v.date : undefined }
    : null
  await run(
    () => call('tag.create', repoId(), v.name.trim(), sha, annotation),
    `Tagged ${v.name.trim()}`
  )
}

export async function deleteTag(name: string): Promise<void> {
  const ok = await confirmDialog({
    title: `Delete tag ${name}?`,
    message: 'Deletes the local tag only.',
    confirmLabel: 'Delete',
    danger: true
  })
  if (ok) await run(() => call('tag.delete', repoId(), name), `Deleted tag ${name}`)
}

export const pushTag = (remote: string, name: string): Promise<unknown> =>
  run(() => call('tag.push', repoId(), remote, name), `Pushed ${name} to ${remote}`)

export async function deleteRemoteTag(remote: string, name: string): Promise<void> {
  const ok = await confirmDialog({
    title: `Delete tag ${name} on ${remote}?`,
    message: `Runs git push ${remote} --delete refs/tags/${name}.`,
    confirmLabel: 'Delete on remote',
    danger: true
  })
  if (ok)
    await run(
      () => call('tag.deleteRemote', repoId(), remote, name),
      `Deleted ${name} on ${remote}`
    )
}

/* ---------- stash ---------- */

export function stashSave(opts: { paths?: string[]; staged?: boolean } = {}): void {
  useUi.getState().openStashDialog(opts)
}

/** Opens the merge editor on the current (live) conflicts. */
export function openLiveMerge(conflicted: string[], title: string): void {
  if (!conflicted.length) return
  useUi
    .getState()
    .openMerge({ source: { kind: 'live' }, paths: conflicted, path: conflicted[0], title })
}

export async function applyStash(
  target: StashTarget,
  label: string,
  pop: boolean,
  restoreIndex = false
): Promise<boolean> {
  const id = repoId()
  try {
    const r = await call('stash.apply', id, target, { pop, restoreIndex })
    if (r.clean) {
      toast.success(pop ? `Applied and removed “${label}”` : `Applied “${label}”`, {
        description:
          pop && target.kind === 'app' ? 'Moved to Recently deleted — restorable.' : undefined
      })
    } else {
      toast.warning(
        `“${label}” applied with ${r.conflicted.length} conflict${r.conflicted.length === 1 ? '' : 's'}`,
        {
          description: 'The stash was kept. Resolve the conflicts in the merge editor.',
          duration: 8000
        }
      )
      openLiveMerge(r.conflicted, `Stash apply · ${label}`)
    }
    return r.clean
  } catch (e) {
    showError(e, 'Could not apply stash')
    return false
  } finally {
    void invalidateRepo(queryClient, id)
  }
}

export async function deleteStash(target: StashTarget, label: string): Promise<void> {
  if (target.kind === 'stack') {
    const ok = await confirmDialog({
      title: `Drop ${label}?`,
      message: 'Entries on git’s stash stack cannot be recovered from the app once dropped.',
      confirmLabel: 'Drop',
      danger: true
    })
    if (!ok) return
  }
  await run(
    () => call('stash.delete', repoId(), target),
    target.kind === 'app' ? `Moved “${label}” to Recently deleted` : 'Stash dropped'
  )
  if (
    useUi.getState().stashSel &&
    JSON.stringify(useUi.getState().stashSel) === JSON.stringify(target)
  ) {
    useUi.getState().selectStash(null)
  }
}

export const restoreStash = (id: string): Promise<unknown> =>
  run(() => call('stash.restore', repoId(), id), 'Stash restored')

export async function purgeStash(id: string, label: string): Promise<void> {
  const ok = await confirmDialog({
    title: `Delete “${label}” forever?`,
    message: 'The stash commit becomes unreachable and will eventually be garbage-collected.',
    confirmLabel: 'Delete forever',
    danger: true
  })
  if (ok) await run(() => call('stash.purge', repoId(), id), 'Stash deleted')
}

export async function editStash(s: AppStash, groups: string[]): Promise<void> {
  const v = await openForm<{ name: string; group: string; notes: string }>({
    title: 'Edit stash',
    submitLabel: 'Save',
    fields: [
      { name: 'name', label: 'Name', type: 'text', default: s.name, required: true },
      {
        name: 'group',
        label: 'Group',
        type: 'text',
        default: s.group,
        placeholder: groups.length ? `e.g. ${groups.join(', ')}` : 'e.g. experiments',
        hint: 'Stashes with the same group are listed together.'
      },
      { name: 'notes', label: 'Notes', type: 'textarea', default: s.notes }
    ]
  })
  if (v) await run(() => call('stash.update', repoId(), s.id, v), 'Stash updated')
}

export const togglePin = (s: AppStash): Promise<unknown> =>
  run(() => call('stash.update', repoId(), s.id, { pinned: !s.pinned }))

export async function adoptStash(s: StackStash): Promise<void> {
  const v = await openForm<{ name: string; group: string }>({
    title: 'Move into app stashes',
    description: `${s.ref} becomes a named stash with a stable identity and leaves git’s stash stack.`,
    submitLabel: 'Move',
    fields: [
      {
        name: 'name',
        label: 'Name',
        type: 'text',
        default: s.message.replace(/^(?:WIP on|On) [^:]+: /, '')
      },
      { name: 'group', label: 'Group', type: 'text', default: 'imported' }
    ]
  })
  if (v)
    await run(
      () => call('stash.adopt', repoId(), s.index, s.sha, v.name, v.group),
      'Stash moved into app stashes'
    )
}

export async function stashToBranch(target: StashTarget, label: string): Promise<void> {
  const v = await openForm<{ name: string }>({
    title: 'Create branch from stash',
    description: `Creates a branch at the commit “${label}” was based on, switches to it and applies the stash there (no conflicts possible). The stash is then removed.`,
    submitLabel: 'Create branch',
    fields: [
      {
        name: 'name',
        label: 'Branch name',
        type: 'text',
        required: true,
        mono: true,
        placeholder: 'stash/my-work'
      }
    ]
  })
  if (v)
    await run(
      () => call('stash.toBranch', repoId(), target, v.name.trim()),
      `Switched to ${v.name.trim()}`
    )
}

/* ---------- remotes ---------- */

export const fetchRemote = (remote: string | null): Promise<unknown> =>
  run(
    () => call('remote.fetch', repoId(), remote, true),
    remote ? `Fetched ${remote}` : 'Fetched all remotes',
    'Fetch failed'
  )

export const pull = (mode: 'ff-only' | 'merge' | 'rebase'): Promise<unknown> =>
  run(() => call('remote.pull', repoId(), mode), 'Pulled', 'Pull failed')

export async function addRemote(): Promise<void> {
  const v = await openForm<{ name: string; url: string }>({
    title: 'Add remote',
    submitLabel: 'Add',
    fields: [
      { name: 'name', label: 'Name', type: 'text', default: 'origin', required: true, mono: true },
      {
        name: 'url',
        label: 'URL',
        type: 'text',
        required: true,
        mono: true,
        placeholder: 'git@github.com:me/repo.git'
      }
    ]
  })
  if (v)
    await run(
      () => call('remote.add', repoId(), v.name.trim(), v.url.trim()),
      `Added ${v.name.trim()}`
    )
}

export async function editRemote(name: string, url: string): Promise<void> {
  const v = await openForm<{ url: string }>({
    title: `Edit ${name}`,
    submitLabel: 'Save',
    fields: [{ name: 'url', label: 'URL', type: 'text', default: url, required: true, mono: true }]
  })
  if (v) await run(() => call('remote.setUrl', repoId(), name, v.url.trim()), 'Remote updated')
}

export async function removeRemote(name: string): Promise<void> {
  const ok = await confirmDialog({
    title: `Remove remote ${name}?`,
    message:
      'Removes the remote and its remote-tracking branches from this clone. Nothing is deleted on the server.',
    confirmLabel: 'Remove',
    danger: true
  })
  if (ok) await run(() => call('remote.remove', repoId(), name), `Removed ${name}`)
}

/* ---------- in-progress operations ---------- */

export const opContinue = (): Promise<unknown> =>
  run(() => call('op.continue', repoId()), 'Continued', 'Could not continue')
export const opSkip = (): Promise<unknown> => run(() => call('op.skip', repoId()), 'Skipped')

export async function opAbort(kind: string): Promise<void> {
  const ok = await confirmDialog({
    title: `Abort ${kind}?`,
    message: 'Returns the branch to where it was before the operation started.',
    confirmLabel: 'Abort',
    danger: true
  })
  if (ok) await run(() => call('op.abort', repoId()), 'Aborted')
}

/* ---------- backups ---------- */

export async function restoreBackup(ref: string, name: string): Promise<void> {
  const v = await openForm<{ mode: 'new-branch' | 'reset-original'; newName: string }>({
    title: 'Restore backup',
    description: ref,
    submitLabel: 'Restore',
    fields: [
      {
        name: 'mode',
        label: 'How',
        type: 'select',
        default: 'new-branch',
        options: [
          { value: 'new-branch', label: 'Create a new branch at the backup' },
          ...(name !== 'HEAD'
            ? [
                {
                  value: 'reset-original',
                  label: `Move ${name} back to the backup (a backup of its current position is kept)`
                }
              ]
            : [])
        ]
      },
      {
        name: 'newName',
        label: 'New branch name',
        type: 'text',
        default: `${name === 'HEAD' ? 'restored' : name}-restored`,
        mono: true,
        showIf: (x) => x.mode === 'new-branch'
      }
    ]
  })
  if (!v) return
  await run(
    () => call('backup.restore', repoId(), ref, v.mode, v.newName?.trim()),
    'Backup restored'
  )
}

export async function deleteBackup(ref: string): Promise<void> {
  const ok = await confirmDialog({
    title: 'Delete backup?',
    message: `${ref}\n\nThe commits may later be garbage-collected if nothing else references them.`,
    confirmLabel: 'Delete',
    danger: true
  })
  if (ok) await run(() => call('backup.delete', repoId(), ref), 'Backup deleted')
}

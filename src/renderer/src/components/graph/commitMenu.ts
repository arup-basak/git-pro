import type { CommitSummary } from '@shared/types'
import {
  checkoutCommit,
  cherryPick,
  copy,
  createBranchAt,
  createTagAt,
  editHistoryFrom,
  resetTo,
  revertCommit
} from '../../lib/actions'
import { short } from '../../lib/format'
import { useUi } from '../../lib/store'
import type { MenuEntry } from '../ui'

export function commitMenu(
  c: CommitSummary,
  currentBranch: string | null,
  tipHint?: string
): MenuEntry[] {
  const ui = useUi.getState()
  const parent = c.parents[0] ?? null
  return [
    {
      label: 'Edit date / author / message…',
      onSelect: () => editHistoryFrom(c.sha, parent, tipHint)
    },
    {
      label: 'Push this commit to a remote branch…',
      onSelect: () => ui.openPush({ sourceKind: 'commit', source: c.sha })
    },
    { separator: true },
    { label: 'New branch here…', onSelect: () => void createBranchAt(c.sha) },
    { label: 'Tag here…', onSelect: () => void createTagAt(c.sha) },
    { label: 'Check out (detached)…', onSelect: () => void checkoutCommit(c.sha) },
    { separator: true },
    {
      label: `Cherry-pick onto ${currentBranch ?? 'HEAD'}`,
      onSelect: () => void cherryPick(c.sha)
    },
    { label: 'Revert…', onSelect: () => void revertCommit(c.sha) },
    ...(currentBranch
      ? [
          {
            label: `Merge this commit into ${currentBranch}…`,
            onSelect: () =>
              ui.openIntegrate({ kind: 'merge', source: c.sha, target: currentBranch })
          },
          {
            label: `Rebase ${currentBranch} onto this commit…`,
            onSelect: () => ui.openIntegrate({ kind: 'rebase', branch: currentBranch, onto: c.sha })
          }
        ]
      : []),
    {
      label: `Reset ${currentBranch ?? 'HEAD'} to here…`,
      danger: true,
      onSelect: () => void resetTo(c.sha, currentBranch)
    },
    { separator: true },
    { label: `Copy SHA (${short(c.sha)})`, onSelect: () => copy(c.sha, 'SHA copied') },
    { label: 'Copy subject', onSelect: () => copy(c.subject) }
  ]
}

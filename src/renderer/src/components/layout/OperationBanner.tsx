import { GitMerge } from 'lucide-react'
import { opAbort, opContinue, opSkip, openLiveMerge } from '../../lib/actions'
import { useStatus } from '../../lib/queries'
import { short } from '../../lib/format'
import { useUi } from '../../lib/store'
import { Button } from '../ui'

export function OperationBanner() {
  const status = useStatus()
  const view = useUi((s) => s.view)
  const op = status.data?.op
  if (!op) return null
  const conflicted = op.conflicted
  if (op.kind === 'none' && conflicted.length === 0) return null

  const editing = op.kind === 'rebase' && op.rebaseStop === 'edit'
  const title = editing
    ? `Editing ${op.stoppedSha ? short(op.stoppedSha) : 'commit'} ${op.stoppedSubject ?? ''}`.trim()
    : op.kind === 'none'
      ? `${conflicted.length} unmerged file${conflicted.length === 1 ? '' : 's'} (e.g. from a stash apply)`
      : `${op.detail ?? op.kind}${conflicted.length ? ` — ${conflicted.length} conflicted file${conflicted.length === 1 ? '' : 's'}` : ''}`
  const hint = conflicted.length
    ? 'Resolve each file, then continue.'
    : editing
      ? `${op.detail ?? ''} · Change files and stage them; Continue amends this commit.`
      : op.kind === 'rebase' && op.rebaseStop === 'exec'
        ? 'A step of the rewrite failed (see the command log). Continue retries it.'
        : op.kind !== 'none'
          ? 'No conflicts left — continue when ready.'
          : ''

  return (
    <div className="flex h-10 shrink-0 items-center gap-3 border-b border-warn/30 bg-warn/10 px-3 text-[13px]">
      <GitMerge size={14} className="text-warn" />
      <span className="min-w-0 truncate font-medium text-warn">{title}</span>
      <span className="truncate text-xs text-muted">{hint}</span>
      <div className="flex-1" />
      {conflicted.length > 0 && view !== 'merge' && (
        <Button
          size="sm"
          variant="primary"
          onClick={() =>
            openLiveMerge(
              conflicted,
              op.kind === 'none' ? 'Resolve conflicts' : (op.detail ?? op.kind)
            )
          }
        >
          Open merge editor
        </Button>
      )}
      {op.kind !== 'none' && op.kind !== 'bisect' && (
        <>
          {op.kind !== 'merge' && !editing && (
            <Button size="sm" onClick={() => void opSkip()}>
              Skip
            </Button>
          )}
          <Button
            size="sm"
            variant={conflicted.length ? 'default' : 'primary'}
            disabled={conflicted.length > 0}
            onClick={() => void opContinue()}
          >
            Continue
          </Button>
        </>
      )}
      {op.kind !== 'none' && (
        <Button size="sm" variant="danger" onClick={() => void opAbort(op.kind)}>
          Abort
        </Button>
      )}
    </div>
  )
}

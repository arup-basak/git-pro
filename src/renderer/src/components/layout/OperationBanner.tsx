import { GitMerge } from 'lucide-react'
import { opAbort, opContinue, opSkip, openLiveMerge } from '../../lib/actions'
import { useStatus } from '../../lib/queries'
import { useUi } from '../../lib/store'
import { Button } from '../ui'

export function OperationBanner() {
  const status = useStatus()
  const view = useUi((s) => s.view)
  const op = status.data?.op
  if (!op) return null
  const conflicted = op.conflicted
  if (op.kind === 'none' && conflicted.length === 0) return null

  const title =
    op.kind === 'none'
      ? `${conflicted.length} unmerged file${conflicted.length === 1 ? '' : 's'} (e.g. from a stash apply)`
      : `${op.detail ?? op.kind}${conflicted.length ? ` — ${conflicted.length} conflicted file${conflicted.length === 1 ? '' : 's'}` : ''}`

  return (
    <div className="flex h-10 shrink-0 items-center gap-3 border-b border-warn/30 bg-warn/10 px-3 text-[13px]">
      <GitMerge size={14} className="text-warn" />
      <span className="font-medium text-warn">{title}</span>
      <span className="text-xs text-muted">
        {conflicted.length
          ? 'Resolve each file, then continue.'
          : op.kind !== 'none'
            ? 'No conflicts left — continue when ready.'
            : ''}
      </span>
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
          {op.kind !== 'merge' && (
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

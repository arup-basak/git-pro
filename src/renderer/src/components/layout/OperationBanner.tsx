import { useQuery } from '@tanstack/react-query'
import { GitMerge, Search } from 'lucide-react'
import { opAbort, opContinue, opSkip, openLiveMerge } from '../../lib/actions'
import { call } from '../../lib/api'
import { bisectEnd, bisectMark } from '../../lib/everyday'
import { short } from '../../lib/format'
import { keys, useRepoId, useStatus } from '../../lib/queries'
import { useUi } from '../../lib/store'
import { Button } from '../ui'

export function OperationBanner() {
  const status = useStatus()
  const view = useUi((s) => s.view)
  const op = status.data?.op
  if (!op) return null
  const conflicted = op.conflicted
  if (op.kind === 'none' && conflicted.length === 0) return null
  if (op.kind === 'bisect' && conflicted.length === 0) return <BisectBanner />

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

function BisectBanner() {
  const repoId = useRepoId()
  const ui = useUi()
  const q = useQuery({ queryKey: keys.bisect(repoId), queryFn: () => call('bisect.state', repoId) })
  const b = q.data
  const found = b?.firstBad
  return (
    <div className="flex h-10 shrink-0 items-center gap-3 border-b border-accent/30 bg-accent/10 px-3 text-[13px]">
      <Search size={14} className="text-accent" />
      <span className="min-w-0 truncate font-medium text-accent">
        {found
          ? `First bad commit: ${short(found.sha)} ${found.subject}`
          : `Bisecting · testing ${b?.current ? short(b.current) : '…'}`}
      </span>
      <span className="truncate text-xs text-muted">
        {found
          ? 'End the bisect to return to where you started.'
          : `Build or run it, then mark it.${b?.remaining != null ? ` About ${b.remaining} step${b.remaining === 1 ? '' : 's'} left (${b.candidates} suspects).` : ''}`}
      </span>
      <div className="flex-1" />
      {found ? (
        <Button
          size="sm"
          onClick={() => {
            ui.setGraphRef(null)
            ui.select(found.sha)
            ui.setView('graph')
          }}
        >
          Show commit
        </Button>
      ) : (
        <>
          <Button size="sm" onClick={() => void bisectMark('good')}>
            Good
          </Button>
          <Button size="sm" onClick={() => void bisectMark('bad')}>
            Bad
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void bisectMark('skip')}>
            Skip
          </Button>
        </>
      )}
      <Button size="sm" variant={found ? 'primary' : 'danger'} onClick={() => void bisectEnd()}>
        End bisect
      </Button>
    </div>
  )
}

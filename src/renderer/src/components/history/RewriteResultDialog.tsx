import type { RewriteResult } from '@shared/types'
import { ArrowUpFromLine, CheckCircle2 } from 'lucide-react'
import { checkoutBranch } from '../../lib/actions'
import { short } from '../../lib/format'
import { useRefs } from '../../lib/queries'
import { useUi } from '../../lib/store'
import { Button, Modal } from '../ui'

export function RewriteResultDialog({
  result,
  onClose
}: {
  result: RewriteResult
  onClose: () => void
}) {
  const ui = useUi()
  const refs = useRefs()
  const isCurrent = refs.data?.currentBranch === result.branch
  const branch = refs.data?.branches.find((b) => b.name === result.branch)
  const remote = branch?.upstream?.split('/')[0] ?? refs.data?.remotes[0]?.name

  return (
    <Modal
      open
      width={640}
      onOpenChange={(o) => !o && onClose()}
      title={
        <span className="flex items-center gap-2">
          <CheckCircle2 size={16} className="text-ok" /> {result.message}
        </span>
      }
      description={`Engine: ${result.engine === 'metadata' ? 'commit-tree (metadata only)' : 'interactive rebase'}`}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button
            onClick={() => {
              ui.setGraphRef(result.branch)
              ui.select(result.newTip)
              ui.setView('graph')
              onClose()
            }}
          >
            Show in graph
          </Button>
          {!isCurrent && (
            <Button
              onClick={() => {
                void checkoutBranch(result.branch)
                onClose()
              }}
            >
              Check out {result.branch}
            </Button>
          )}
          <Button
            variant="primary"
            icon={<ArrowUpFromLine size={13} />}
            disabled={!remote}
            onClick={() => {
              ui.openPush({
                sourceKind: 'branch',
                source: result.branch,
                remote,
                dest: result.branch,
                force: result.backupRef ? 'lease' : 'none'
              })
              onClose()
            }}
          >
            Push {result.branch}…
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-[13px]">
        <div className="grid grid-cols-[110px_1fr] gap-y-1.5">
          <span className="text-muted">Branch</span>
          <span className="mono">{result.branch}</span>
          <span className="text-muted">Tip</span>
          <span className="mono">
            {short(result.oldTip)} → {result.newTip ? short(result.newTip) : '—'}
          </span>
          {result.backupRef && (
            <>
              <span className="text-muted">Backup</span>
              <span className="mono text-xs break-all text-faint">{result.backupRef}</span>
            </>
          )}
        </div>
        {result.mapping.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">
              Rewritten commits
            </div>
            <div className="mono max-h-44 overflow-auto rounded-md border border-line bg-bg px-3 py-1.5 text-muted">
              {result.mapping.map((m) => (
                <div key={m.old}>
                  {short(m.old)} → <span className="text-fg">{short(m.new)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {result.staleRefs.length > 0 && (
          <div className="rounded-md border border-line bg-panel-2 px-3 py-2 text-xs text-muted">
            These refs still point at the original commits (unchanged):{' '}
            <span className="mono text-fg">{result.staleRefs.join(', ')}</span>
          </div>
        )}
      </div>
    </Modal>
  )
}

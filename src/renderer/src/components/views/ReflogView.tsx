import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { copy, createBranchAt, resetTo } from '../../lib/actions'
import { call } from '../../lib/api'
import { relative, short } from '../../lib/format'
import { keys, useRefs, useRepoId } from '../../lib/queries'
import { useUi } from '../../lib/store'
import { Empty, Select, Spinner, WithContextMenu } from '../ui'

export function ReflogView() {
  const repoId = useRepoId()
  const refs = useRefs()
  const ui = useUi()
  const [ref, setRef] = useState('HEAD')
  const log = useQuery({
    queryKey: keys.reflog(repoId, ref),
    queryFn: () => call('reflog.list', repoId, ref, 500)
  })
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3 text-xs">
        <span className="text-muted">Reflog of</span>
        <Select value={ref} onChange={(e) => setRef(e.target.value)} className="w-56">
          <option value="HEAD">HEAD</option>
          {refs.data?.branches.map((b) => (
            <option key={b.name} value={`refs/heads/${b.name}`}>
              {b.name}
            </option>
          ))}
        </Select>
        <span className="text-faint">
          Every position the ref has been at — right-click an entry to recover it.
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {log.isLoading && (
          <Empty>
            <Spinner />
          </Empty>
        )}
        {log.data?.length === 0 && <Empty>No reflog entries</Empty>}
        {log.data?.map((e) => (
          <WithContextMenu
            key={e.selector}
            entries={() => [
              { label: 'Show commit', onSelect: () => (ui.select(e.sha), ui.setView('graph')) },
              { label: 'New branch here…', onSelect: () => void createBranchAt(e.sha, e.selector) },
              {
                label: `Reset ${refs.data?.currentBranch ?? 'HEAD'} to here…`,
                danger: true,
                onSelect: () => void resetTo(e.sha, refs.data?.currentBranch ?? null)
              },
              { separator: true },
              { label: 'Copy SHA', onSelect: () => copy(e.sha, 'SHA copied') }
            ]}
          >
            <div className="flex h-7 cursor-default items-center gap-3 border-b border-line/50 px-3 hover:bg-hover">
              <span className="mono w-24 shrink-0 text-faint">
                {e.selector.replace(/^refs\/heads\//, '')}
              </span>
              <span className="mono w-16 shrink-0 text-accent">{short(e.sha)}</span>
              <span className="min-w-0 flex-1 truncate">{e.message}</span>
              <span className="shrink-0 text-xs text-faint">{relative(e.date)}</span>
            </div>
          </WithContextMenu>
        ))}
      </div>
    </div>
  )
}

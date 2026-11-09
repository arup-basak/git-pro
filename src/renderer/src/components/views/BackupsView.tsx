import { deleteBackup, restoreBackup } from '../../lib/actions'
import { short } from '../../lib/format'
import { useBackups } from '../../lib/queries'
import { useUi } from '../../lib/store'
import { Button, Empty, Spinner } from '../ui'

export function BackupsView() {
  const backups = useBackups()
  const ui = useUi()
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center border-b border-line px-3 text-xs text-faint">
        Every rewrite, reset and branch delete first records the old position under
        refs/git-pro/backups/. These refs are local only and keep old commits safe from garbage
        collection.
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {backups.isLoading && (
          <Empty>
            <Spinner />
          </Empty>
        )}
        {backups.data?.length === 0 && <Empty>No backups yet</Empty>}
        {backups.data && backups.data.length > 0 && (
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 bg-panel text-left text-[11px] text-faint">
              <tr className="border-b border-line">
                <th className="px-3 py-1.5 font-medium">When</th>
                <th className="font-medium">Reason</th>
                <th className="font-medium">Branch</th>
                <th className="font-medium">Commit</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {backups.data.map((b) => (
                <tr key={b.ref} className="h-9 border-b border-line/60 hover:bg-hover">
                  <td className="px-3 text-muted">{new Date(b.createdAt).toLocaleString()}</td>
                  <td>
                    <span className="rounded bg-line px-1.5 py-0.5 text-[11px] text-muted">
                      {b.reason}
                    </span>
                  </td>
                  <td className="mono">{b.name}</td>
                  <td className="max-w-[360px] truncate">
                    <button
                      className="mono mr-2 text-accent hover:underline"
                      onClick={() => (ui.select(b.sha), ui.setView('graph'))}
                    >
                      {short(b.sha)}
                    </button>
                    <span className="text-muted">{b.subject}</span>
                  </td>
                  <td className="pr-3 text-right whitespace-nowrap">
                    <Button size="sm" onClick={() => void restoreBackup(b.ref, b.name)}>
                      Restore…
                    </Button>{' '}
                    <Button size="sm" variant="ghost" onClick={() => void deleteBackup(b.ref)}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

import { useMemo } from 'react'
import { cx } from '../../lib/format'
import { parsePatch } from '../../lib/patch'
import { Empty, Spinner } from '../ui'

export function DiffView({ patch, loading }: { patch: string; loading?: boolean }) {
  const { files, truncated } = useMemo(() => parsePatch(patch), [patch])
  if (loading) {
    return (
      <Empty>
        <Spinner />
      </Empty>
    )
  }
  if (!files.length) return <Empty>No changes to show</Empty>
  return (
    <div className="h-full overflow-auto bg-bg">
      {files.map((f, i) => (
        <div key={i} className="border-b border-line">
          <div className="sticky top-0 z-10 border-b border-line bg-panel-2 px-3 py-1.5 mono font-medium">
            {f.title}
          </div>
          {f.binary && <div className="px-3 py-2 text-muted">Binary file</div>}
          <table className="w-full border-collapse mono leading-[18px]">
            <tbody>
              {f.lines.map((l, j) => (
                <tr
                  key={j}
                  className={cx(
                    l.kind === 'add' && 'bg-ok/10',
                    l.kind === 'del' && 'bg-bad/10',
                    l.kind === 'hunk' && 'bg-accent/10 text-accent',
                    l.kind === 'meta' && 'text-faint'
                  )}
                >
                  <td className="w-10 pr-2 text-right align-top text-faint select-none">
                    {l.oldNo ?? ''}
                  </td>
                  <td className="w-10 pr-2 text-right align-top text-faint select-none">
                    {l.newNo ?? ''}
                  </td>
                  <td
                    className={cx(
                      'w-4 text-center align-top select-none',
                      l.kind === 'add' && 'text-ok',
                      l.kind === 'del' && 'text-bad'
                    )}
                  >
                    {l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ''}
                  </td>
                  <td className="pr-4 break-all whitespace-pre-wrap select-text">
                    {l.text || ' '}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {truncated && <div className="p-3 text-warn">Diff truncated (too large to display)</div>}
    </div>
  )
}

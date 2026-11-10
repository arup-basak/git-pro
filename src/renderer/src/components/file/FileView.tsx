import type { BlameResult } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { History, ScanSearch, Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { call } from '../../lib/api'
import { openBlame } from '../../lib/everyday'
import { cx, relative, short } from '../../lib/format'
import { langFromPath, useTokens } from '../../lib/highlight'
import { useRepoId } from '../../lib/queries'
import { useUi, type FileRequest } from '../../lib/store'
import { TokenLine } from '../code/Code'
import { DiffView } from '../commit/DiffView'
import { Button, Empty, Spinner, WithContextMenu } from '../ui'

const UNCOMMITTED = /^0+$/

export function FileView() {
  const req = useUi((s) => s.file)
  if (!req) {
    return (
      <Empty>
        Right-click a file in Changes, a commit or a stash, then choose Blame or File history.
      </Empty>
    )
  }
  return <FilePane key={`${req.path}\0${req.tab}\0${req.rev}`} req={req} />
}

function FilePane({ req }: { req: FileRequest }) {
  const ui = useUi()
  const tab = (t: FileRequest['tab']): void => ui.openFile({ ...req, tab: t })
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3 text-xs">
        <span className="mono min-w-0 truncate text-[13px] text-fg">{req.path}</span>
        <div className="ml-2 flex rounded-md border border-line p-0.5">
          {(
            [
              ['blame', 'Blame', <ScanSearch key="b" size={12} />],
              ['history', 'History', <History key="h" size={12} />]
            ] as const
          ).map(([t, label, icon]) => (
            <button
              key={t}
              onClick={() => tab(t)}
              className={cx(
                'flex h-6 items-center gap-1 rounded px-2',
                req.tab === t ? 'bg-line-strong text-fg' : 'text-muted hover:text-fg'
              )}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
        {req.tab === 'blame' && (
          <>
            <span className="text-faint">
              {req.rev ? (
                <>
                  at <span className="mono text-muted">{short(req.rev)}</span>
                </>
              ) : (
                'working tree'
              )}
            </span>
            {req.rev && (
              <Button size="sm" variant="ghost" onClick={() => openBlame(req.path, null)}>
                Back to the working tree
              </Button>
            )}
          </>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {req.tab === 'blame' ? <BlamePane req={req} /> : <HistoryPane path={req.path} />}
      </div>
    </div>
  )
}

function showCommit(sha: string): void {
  const ui = useUi.getState()
  ui.setGraphRef(null)
  ui.select(sha)
  ui.setView('graph')
}

function BlamePane({ req }: { req: FileRequest }) {
  const repoId = useRepoId()
  const q = useQuery({
    queryKey: ['repo', repoId, 'blame', req.path, req.rev],
    queryFn: () => call('file.blame', repoId, req.path, req.rev),
    staleTime: 5000
  })
  if (q.isLoading) {
    return (
      <Empty>
        <Spinner />
      </Empty>
    )
  }
  if (!q.data) return <Empty>{q.error ? (q.error as Error).message : 'Nothing to blame'}</Empty>
  return <BlameTable data={q.data} />
}

function BlameTable({ data }: { data: BlameResult }) {
  const text = useMemo(() => data.lines.join('\n'), [data])
  const tokens = useTokens(text, langFromPath(data.path))
  const [oldest, newest] = useMemo(() => {
    const times = Object.values(data.commits)
      .map((c) => c.authorTime)
      .filter((t) => t > 0)
    return [Math.min(...times), Math.max(...times)]
  }, [data])
  const age = (t: number): number => (newest > oldest ? (t - oldest) / (newest - oldest) : 1)

  return (
    <div className="h-full overflow-auto bg-bg">
      <table className="mono w-max min-w-full border-collapse leading-[19px]">
        <tbody>
          {data.hunks.map((h) => {
            const c = data.commits[h.sha]
            const uncommitted = UNCOMMITTED.test(h.sha)
            return Array.from({ length: h.count }, (_, k) => {
              const i = h.start + k
              return (
                <tr key={i} className={cx(k === 0 && i > 0 && 'border-t border-line/60')}>
                  <td
                    className="w-[3px] p-0"
                    style={{
                      background: uncommitted
                        ? 'var(--color-warn)'
                        : `rgba(110, 168, 254, ${0.12 + 0.75 * age(c.authorTime)})`
                    }}
                  />
                  <td className="w-[300px] max-w-[300px] border-r border-line pr-2 pl-2 align-top font-sans text-xs select-none">
                    {k === 0 &&
                      (uncommitted ? (
                        <span className="text-warn">Not committed yet</span>
                      ) : (
                        <WithContextMenu
                          entries={() => [
                            { label: 'Show commit', onSelect: () => showCommit(h.sha) },
                            {
                              label: 'Blame at this commit',
                              onSelect: () => openBlame(h.origPath || data.path, h.sha)
                            },
                            ...(c.previous
                              ? [
                                  {
                                    label: 'Blame before this change',
                                    onSelect: () => openBlame(c.previous!.path, c.previous!.sha)
                                  }
                                ]
                              : [])
                          ]}
                        >
                          <div className="flex items-center gap-1.5">
                            <button
                              className="mono shrink-0 text-accent hover:underline"
                              title={`${c.summary}\n\nClick to show this commit`}
                              onClick={() => showCommit(h.sha)}
                            >
                              {short(h.sha)}
                            </button>
                            <span className="min-w-0 truncate text-muted" title={c.summary}>
                              {c.summary}
                            </span>
                            <span className="ml-auto shrink-0 text-faint" title={c.author}>
                              {relative(c.authorTime)}
                            </span>
                            {c.previous && (
                              <button
                                className="shrink-0 text-faint hover:text-fg"
                                title="Blame before this change"
                                onClick={() => openBlame(c.previous!.path, c.previous!.sha)}
                              >
                                <Undo2 size={11} />
                              </button>
                            )}
                          </div>
                        </WithContextMenu>
                      ))}
                  </td>
                  <td className="w-12 pr-2 text-right align-top text-faint/70 select-none">
                    {i + 1}
                  </td>
                  <td className="pr-4 whitespace-pre select-text">
                    <TokenLine text={data.lines[i]} tokens={tokens?.[i] ?? null} />
                    {data.lines[i] === '' ? ' ' : null}
                  </td>
                </tr>
              )
            })
          })}
        </tbody>
      </table>
    </div>
  )
}

function HistoryPane({ path }: { path: string }) {
  const repoId = useRepoId()
  const log = useQuery({
    queryKey: ['repo', repoId, 'file-log', path],
    queryFn: () => call('log.list', repoId, { limit: 1000, path, follow: true })
  })
  const [picked, setPicked] = useState<string | null>(null)
  const sel = picked ?? log.data?.[0]?.sha ?? null
  const diff = useQuery({
    queryKey: ['repo', repoId, 'file-diff', sel, path],
    queryFn: async () => {
      // Before a rename the file had another name; then show the whole commit.
      const d = await call('commit.diff', repoId, sel!, [path])
      return d || call('commit.diff', repoId, sel!)
    },
    enabled: !!sel
  })
  if (log.isLoading) {
    return (
      <Empty>
        <Spinner />
      </Empty>
    )
  }
  if (!log.data?.length) return <Empty>No commits touch this file</Empty>
  return (
    <div className="flex h-full min-h-0">
      <div className="w-[380px] shrink-0 overflow-auto border-r border-line py-1">
        <div className="px-3 py-1 text-[11px] font-semibold tracking-wide text-faint uppercase">
          {log.data.length} commit{log.data.length === 1 ? '' : 's'}
        </div>
        {log.data.map((c) => (
          <WithContextMenu
            key={c.sha}
            entries={() => [
              { label: 'Show in graph', onSelect: () => showCommit(c.sha) },
              { label: 'Blame at this commit', onSelect: () => openBlame(path, c.sha) }
            ]}
          >
            <div
              onClick={() => setPicked(c.sha)}
              className={cx(
                'cursor-default px-3 py-1.5',
                c.sha === sel ? 'bg-accent-strong/30' : 'hover:bg-hover'
              )}
            >
              <div className="truncate">{c.subject}</div>
              <div className="flex gap-2 text-xs text-faint">
                <span className="mono">{short(c.sha)}</span>
                <span className="truncate">{c.author.name}</span>
                <span className="ml-auto shrink-0">{relative(c.author.date.ts)}</span>
              </div>
            </div>
          </WithContextMenu>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <DiffView patch={diff.data ?? ''} loading={diff.isLoading} />
      </div>
    </div>
  )
}

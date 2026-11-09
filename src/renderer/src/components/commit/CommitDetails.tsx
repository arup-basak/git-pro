import { formatGitDate } from '@shared/dates'
import type { FileChange, Identity } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpFromLine, CalendarClock, Copy, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { copy, editHistoryFrom } from '../../lib/actions'
import { call } from '../../lib/api'
import { cx, relative, short } from '../../lib/format'
import { useCommitDetail, useRefs, useRepoId } from '../../lib/queries'
import { useUi } from '../../lib/store'
import { Badge, Button, Empty, Spinner } from '../ui'
import { DiffView } from './DiffView'

const STATUS_COLOR: Record<string, string> = {
  A: 'text-ok',
  M: 'text-warn',
  D: 'text-bad',
  R: 'text-accent',
  C: 'text-accent',
  T: 'text-muted'
}

export function FileRow({
  f,
  active,
  onClick,
  right
}: {
  f: Pick<FileChange, 'path' | 'oldPath' | 'status'> & {
    additions?: number | null
    deletions?: number | null
  }
  active: boolean
  onClick: () => void
  right?: React.ReactNode
}) {
  const name = f.path.split('/').pop()
  const dir = f.path.slice(0, f.path.length - (name?.length ?? 0))
  return (
    <div
      onClick={onClick}
      title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
      className={cx(
        'group flex h-[24px] cursor-default items-center gap-2 px-2',
        active ? 'bg-accent-strong/30' : 'hover:bg-hover'
      )}
    >
      <span
        className={cx(
          'mono w-3 shrink-0 text-center font-semibold',
          STATUS_COLOR[f.status] ?? 'text-muted'
        )}
      >
        {f.status}
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span>{name}</span>
        <span className="ml-1.5 text-xs text-faint">{dir}</span>
      </span>
      {f.additions != null && <span className="mono text-[11px] text-ok">+{f.additions}</span>}
      {f.deletions != null && <span className="mono text-[11px] text-bad">−{f.deletions}</span>}
      {right}
    </div>
  )
}

function Person({ label, who }: { label: string; who: Identity }) {
  return (
    <>
      <div className="text-faint">{label}</div>
      <div className="min-w-0">
        <div className="truncate" title={who.email}>
          {who.name} <span className="text-faint">&lt;{who.email}&gt;</span>
        </div>
        <div className="mono text-muted">
          {formatGitDate(who.date)} <span className="text-faint">· {relative(who.date.ts)}</span>
        </div>
      </div>
    </>
  )
}

export function CommitDetails({ sha }: { sha: string }) {
  const repoId = useRepoId()
  const ui = useUi()
  const refs = useRefs()
  const detail = useCommitDetail(sha)
  const [file, setFile] = useState<string | null>(null)
  const d = detail.data
  const selectedFile = d?.files.find((f) => f.path === file)
  const diff = useQuery({
    queryKey: ['repo', repoId, 'commit-diff', sha, file],
    queryFn: () =>
      call(
        'commit.diff',
        repoId,
        sha,
        selectedFile
          ? [selectedFile.path, ...(selectedFile.oldPath ? [selectedFile.oldPath] : [])]
          : undefined
      ),
    enabled: !!d && (file !== null || d.files.length <= 40),
    staleTime: Infinity
  })

  if (detail.isLoading) {
    return (
      <Empty>
        <Spinner />
      </Empty>
    )
  }
  if (!d)
    return (
      <Empty>{detail.error ? String((detail.error as Error).message) : 'Commit not found'}</Empty>
    )
  const body = d.message.split('\n').slice(1).join('\n').trim()

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-[360px] shrink-0 flex-col overflow-auto border-r border-line p-3">
        <div className="mb-1 flex flex-wrap gap-1">
          {d.refs
            .filter((r) => r.kind !== 'head')
            .map((r) => (
              <Badge
                key={r.kind + r.name}
                color={
                  r.current
                    ? 'current'
                    : r.kind === 'remote'
                      ? 'remote'
                      : r.kind === 'tag'
                        ? 'tag'
                        : 'branch'
                }
              >
                {r.name}
              </Badge>
            ))}
          {d.signed && (
            <Badge color="remote" title="This commit carries a GPG/SSH signature">
              <ShieldCheck size={11} className="mr-0.5" /> signed
            </Badge>
          )}
        </div>
        <div className="text-[14px] font-semibold select-text">{d.subject}</div>
        {body && (
          <div className="mt-2 text-[12.5px] whitespace-pre-wrap text-muted select-text">
            {body}
          </div>
        )}
        <div className="mt-3 grid grid-cols-[72px_1fr] gap-x-2 gap-y-2 text-[12px]">
          <div className="text-faint">SHA</div>
          <button
            className="mono flex items-center gap-1 text-left hover:text-accent"
            onClick={() => copy(d.sha, 'SHA copied')}
          >
            {d.sha.slice(0, 16)}… <Copy size={11} />
          </button>
          <div className="text-faint">Parents</div>
          <div className="flex flex-wrap gap-1.5">
            {d.parents.length === 0 && <span className="text-muted">root commit</span>}
            {d.parents.map((p) => (
              <button
                key={p}
                className="mono text-accent hover:underline"
                onClick={() => ui.select(p)}
              >
                {short(p)}
              </button>
            ))}
          </div>
          <Person label="Author" who={d.author} />
          <Person label="Committer" who={d.committer} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            icon={<CalendarClock size={12} />}
            onClick={() =>
              editHistoryFrom(
                d.sha,
                d.parents[0] ?? null,
                ui.graphRef ?? refs.data?.currentBranch ?? undefined
              )
            }
          >
            Edit date / author / message
          </Button>
          <Button
            size="sm"
            icon={<ArrowUpFromLine size={12} />}
            onClick={() => ui.openPush({ sourceKind: 'commit', source: d.sha })}
          >
            Push commit…
          </Button>
        </div>
      </div>
      <div className="flex w-[300px] shrink-0 flex-col border-r border-line">
        <div
          onClick={() => setFile(null)}
          className={cx(
            'flex h-8 shrink-0 cursor-default items-center border-b border-line px-2 text-xs',
            file === null ? 'text-fg' : 'text-muted hover:text-fg'
          )}
        >
          {d.files.length} changed file{d.files.length === 1 ? '' : 's'}
          {file !== null && <span className="ml-auto text-accent">show all</span>}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {d.files.map((f) => (
            <FileRow key={f.path} f={f} active={f.path === file} onClick={() => setFile(f.path)} />
          ))}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        {file === null && d.files.length > 40 ? (
          <Empty>Select a file to see its diff</Empty>
        ) : (
          <DiffView patch={diff.data ?? ''} loading={diff.isLoading} />
        )}
      </div>
    </div>
  )
}

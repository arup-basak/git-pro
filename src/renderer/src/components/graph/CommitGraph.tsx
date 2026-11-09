import type { CommitSummary, RefLabel } from '@shared/types'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Search, X } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { compactDate, cx, short } from '../../lib/format'
import { LANE_COLORS, computeLanes, type LaneRow } from '../../lib/lanes'
import { useLog, useRefs } from '../../lib/queries'
import { useUi } from '../../lib/store'
import { CommitDetails } from '../commit/CommitDetails'
import { Badge, Button, Empty, Select, Spinner, WithContextMenu } from '../ui'
import { commitMenu } from './commitMenu'

const ROW = 26
const LANE_W = 14

function GraphCell({ row, width }: { row: LaneRow; width: number }) {
  const x = (l: number): number => 9 + l * LANE_W
  const mid = ROW / 2
  return (
    <svg width={width} height={ROW} className="shrink-0">
      {row.lines.map((ln, i) => {
        const color = LANE_COLORS[ln.color % LANE_COLORS.length]
        let d: string
        if (ln.half === 'full') d = `M${x(ln.from)} 0 V${ROW}`
        else if (ln.half === 'top')
          d =
            ln.from === ln.to
              ? `M${x(ln.from)} 0 V${mid}`
              : `M${x(ln.from)} 0 C${x(ln.from)} ${mid} ${x(ln.to)} ${mid / 2} ${x(ln.to)} ${mid}`
        else
          d =
            ln.from === ln.to
              ? `M${x(ln.from)} ${mid} V${ROW}`
              : `M${x(ln.from)} ${mid} C${x(ln.from)} ${mid + mid / 2} ${x(ln.to)} ${mid} ${x(ln.to)} ${ROW}`
        return <path key={i} d={d} stroke={color} strokeWidth={1.6} fill="none" />
      })}
      <circle
        cx={x(row.lane)}
        cy={mid}
        r={4}
        fill={LANE_COLORS[row.color % LANE_COLORS.length]}
        stroke="#0b0d10"
        strokeWidth={1.5}
      />
    </svg>
  )
}

function RefBadges({ refs }: { refs: RefLabel[] }) {
  return (
    <>
      {refs
        .filter((r) => r.kind !== 'head')
        .map((r) => (
          <Badge
            key={`${r.kind}:${r.name}`}
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
            {r.kind === 'tag' ? `🏷 ${r.name}` : r.name}
          </Badge>
        ))}
      {refs.some((r) => r.kind === 'head') && !refs.some((r) => r.current) && (
        <Badge color="head">HEAD</Badge>
      )}
    </>
  )
}

const Row = memo(function Row({
  c,
  lane,
  graphWidth,
  selected,
  onSelect,
  currentBranch,
  tipHint
}: {
  c: CommitSummary
  lane: LaneRow
  graphWidth: number
  selected: boolean
  onSelect: (sha: string) => void
  currentBranch: string | null
  tipHint?: string
}) {
  const isHead = c.refs.some((r) => r.kind === 'head')
  return (
    <WithContextMenu entries={() => commitMenu(c, currentBranch, tipHint)}>
      <div
        onMouseDown={() => onSelect(c.sha)}
        className={cx(
          'flex h-[26px] cursor-default items-center gap-2 pr-3',
          selected ? 'bg-accent-strong/30' : 'hover:bg-hover'
        )}
      >
        <GraphCell row={lane} width={graphWidth} />
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <RefBadges refs={c.refs} />
          <span className={cx('truncate', isHead && 'font-semibold')}>{c.subject}</span>
        </div>
        <span
          className="w-36 shrink-0 truncate text-muted"
          title={`${c.author.name} <${c.author.email}>`}
        >
          {c.author.name}
        </span>
        <span
          className="mono w-[128px] shrink-0 text-muted"
          title={`Author:    ${compactDate(c.author.date)} ${c.author.date.tz}\nCommitter: ${compactDate(c.committer.date)} ${c.committer.date.tz}`}
        >
          {compactDate(c.author.date)}
        </span>
        <span className="mono w-[62px] shrink-0 text-faint">{short(c.sha)}</span>
      </div>
    </WithContextMenu>
  )
})

export function GraphView() {
  const selected = useUi((s) => s.selectedSha)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cx('min-h-0', selected ? 'h-[52%]' : 'flex-1')}>
        <CommitGraph />
      </div>
      {selected && (
        <div className="min-h-0 flex-1 border-t border-line-strong">
          <CommitDetails key={selected} sha={selected} />
        </div>
      )}
    </div>
  )
}

export function CommitGraph() {
  const ui = useUi()
  const refs = useRefs()
  const [limit, setLimit] = useState(400)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState<'message' | 'author' | 'sha'>('message')
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(t)
  }, [searchInput])
  useEffect(() => setLimit(400), [ui.graphRef, search, mode])

  const log = useLog({
    ref: ui.graphRef ?? undefined,
    limit,
    search: search || undefined,
    searchMode: mode
  })
  const commits = useMemo(() => log.data ?? [], [log.data])
  const lanes = useMemo(() => computeLanes(commits), [commits])
  const graphWidth = Math.min(
    220,
    18 + LANE_W * Math.max(1, ...lanes.map((l) => l.width)) - LANE_W / 2
  )
  const parentRef = useRef<HTMLDivElement>(null)
  const virt = useVirtualizer({
    count: commits.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW,
    overscan: 20
  })

  const select = ui.select
  const selectedIndex = commits.findIndex((c) => c.sha === ui.selectedSha)
  useEffect(() => {
    if (selectedIndex >= 0) virt.scrollToIndex(selectedIndex, { align: 'auto' })
  }, [selectedIndex, virt])

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const next = Math.min(
      commits.length - 1,
      Math.max(0, selectedIndex + (e.key === 'ArrowDown' ? 1 : -1))
    )
    if (commits[next]) select(commits[next].sha)
  }

  const tipHint = ui.graphRef ?? refs.data?.currentBranch ?? undefined

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <div className="relative">
          <Search size={13} className="absolute top-1/2 left-2 -translate-y-1/2 text-faint" />
          <input
            data-graph-search
            className="field w-72 pl-7"
            placeholder={
              mode === 'sha'
                ? 'SHA…'
                : mode === 'author'
                  ? 'Author name or email…'
                  : 'Search commit messages…'
            }
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <Select
          value={mode}
          onChange={(e) => setMode(e.target.value as typeof mode)}
          className="w-28"
        >
          <option value="message">Message</option>
          <option value="author">Author</option>
          <option value="sha">SHA</option>
        </Select>
        {ui.graphRef && (
          <span className="flex items-center gap-1 rounded bg-accent/15 py-0.5 pr-1 pl-2 text-xs text-accent">
            {ui.graphRef.replace(/^refs\/tags\//, 'tag ')}
            <button
              className="rounded p-0.5 hover:bg-accent/20"
              onClick={() => ui.setGraphRef(null)}
              title="Show all"
            >
              <X size={11} />
            </button>
          </span>
        )}
        <div className="flex-1" />
        {log.isFetching && <Spinner size={12} />}
        <span className="text-xs text-faint">
          {commits.length}
          {commits.length >= limit ? '+' : ''} commits
        </span>
      </div>
      <div
        ref={parentRef}
        tabIndex={0}
        onKeyDown={onKey}
        className="min-h-0 flex-1 overflow-auto outline-none"
      >
        {log.isError && <Empty>{String((log.error as Error).message)}</Empty>}
        {!log.isLoading && !log.isError && commits.length === 0 && (
          <Empty>{search ? 'No commits match' : 'No commits yet'}</Empty>
        )}
        <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
          {virt.getVirtualItems().map((v) => {
            const c = commits[v.index]
            return (
              <div
                key={c.sha}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${v.start}px)`
                }}
              >
                <Row
                  c={c}
                  lane={lanes[v.index]}
                  graphWidth={graphWidth}
                  selected={c.sha === ui.selectedSha}
                  onSelect={select}
                  currentBranch={refs.data?.currentBranch ?? null}
                  tipHint={tipHint}
                />
              </div>
            )
          })}
        </div>
        {commits.length >= limit && (
          <div className="flex justify-center py-3">
            <Button
              size="sm"
              onClick={() => setLimit((l) => Math.min(l + 1000, 5000))}
              disabled={limit >= 5000}
            >
              Load more
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

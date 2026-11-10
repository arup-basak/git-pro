import { formatGitDate, nowGitDate, sameDate, spreadEvenly, spreadRandom } from '@shared/dates'
import type {
  GitDate,
  HistoryAction,
  HistoryRange,
  HistoryRow,
  Person,
  RowEdit
} from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  GripVertical,
  RotateCcw
} from 'lucide-react'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { queryClient } from '../../lib/actions'
import { call } from '../../lib/api'
import { cx, defaultEditedBranchName, short } from '../../lib/format'
import { invalidateRepo, showError, useRefs, useRepoId } from '../../lib/queries'
import { useUi, type HistoryRequest } from '../../lib/store'
import { Button, Checkbox, DateField, Empty, Select, Spinner } from '../ui'
import { formatOffset, parseOffset } from './dateTools'

interface RowState {
  action: HistoryAction
  message?: string
  author?: Person
  authorDate?: GitDate
  committer?: Person
  committerDate?: GitDate
}

type DateTarget = 'both' | 'author' | 'committer'

export function HistoryEditorView() {
  const req = useUi((s) => s.history)
  const refs = useRefs()
  const ui = useUi()
  if (!req) {
    const tip = refs.data?.currentBranch ?? 'HEAD'
    return (
      <Empty>
        <div className="flex flex-col items-center gap-3">
          <div>
            Pick commits to edit: right-click a commit in the graph, or start from the latest
            commits.
          </div>
          <Button
            variant="primary"
            disabled={!refs.data?.head}
            onClick={() => ui.openHistory({ tip, base: { count: 10 } })}
          >
            Edit the last 10 commits of {tip}
          </Button>
        </div>
      </Empty>
    )
  }
  return <Loader key={req.nonce} req={req} />
}

function Loader({ req }: { req: HistoryRequest }) {
  const repoId = useRepoId()
  const ui = useUi()
  const refs = useRefs()
  const [count, setCount] = useState('count' in req.base ? String(req.base.count) : '')
  const range = useQuery({
    // Outside the ['repo', …] namespace so background refreshes never swap rows under an edit in progress;
    // the main process re-validates the tip when applying.
    queryKey: ['history-range', repoId, req.tip, req.base, req.nonce],
    queryFn: () => call('history.range', repoId, req.tip, req.base),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnMount: false
  })
  const reload = (base: HistoryRequest['base'], tip = req.tip): void =>
    ui.openHistory({ tip, base, focus: req.focus })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3 text-xs">
        <span className="text-muted">Tip</span>
        <Select
          value={req.tip}
          onChange={(tip) => reload(req.base, tip)}
          className="w-48"
          aria-label="Tip"
          options={[
            ...(refs.data?.branches.some((b) => b.name === req.tip)
              ? []
              : [{ value: req.tip, label: req.tip }]),
            ...(refs.data?.branches ?? []).map((b) => ({ value: b.name, label: b.name }))
          ]}
        />
        <span className="ml-2 text-muted">Range</span>
        {'sha' in req.base ? (
          <span className="mono rounded bg-line px-2 py-0.5">
            {req.base.sha ? `after ${short(req.base.sha)}` : 'from the root commit'}
          </span>
        ) : (
          <span className="text-muted">last</span>
        )}
        <input
          className="field w-16"
          type="number"
          min={1}
          placeholder="N"
          value={count}
          onChange={(e) => setCount(e.target.value)}
          onKeyDown={(e) =>
            e.key === 'Enter' && Number(count) > 0 && reload({ count: Number(count) })
          }
        />
        <Button
          size="sm"
          disabled={!(Number(count) > 0)}
          onClick={() => reload({ count: Number(count) })}
        >
          Load last N
        </Button>
        <Button size="sm" variant="ghost" onClick={() => reload({ sha: null })}>
          Whole history
        </Button>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          icon={<RotateCcw size={12} />}
          onClick={() => reload(req.base)}
        >
          Reload
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        {range.isLoading ? (
          <Empty>
            <Spinner />
          </Empty>
        ) : range.data ? (
          <Editor range={range.data} req={req} />
        ) : (
          <Empty>{range.error ? String((range.error as Error).message) : 'Nothing to edit'}</Empty>
        )}
      </div>
    </div>
  )
}

function Editor({ range, req }: { range: HistoryRange; req: HistoryRequest }) {
  const repoId = useRepoId()
  const ui = useUi()
  const original = useMemo(() => new Map(range.rows.map((r) => [r.sha, r])), [range])
  const [order, setOrder] = useState<string[]>(() => range.rows.map((r) => r.sha))
  const [state, setState] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      range.rows.map((r) => [r.sha, { action: req.preset?.[r.sha] ?? ('pick' as HistoryAction) }])
    )
  )
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<string | null>(req.focus ?? null)
  const [cascade, setCascade] = useState(true)
  const [outMode, setOutMode] = useState<'new-branch' | 'in-place'>('new-branch')
  const [branchName, setBranchName] = useState(() =>
    defaultEditedBranchName(range.tipBranch ?? 'detached')
  )
  const [preserveCommitter, setPreserveCommitter] = useState(true)
  const [autostash, setAutostash] = useState(false)
  const anySigned = range.rows.some((r) => r.signed)
  const [resign, setResign] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dragSha, setDragSha] = useState<string | null>(null)
  const hasMerges = range.rows.some((r) => r.isMerge)

  useEffect(() => {
    if (req.focus) document.getElementById(`hrow-${req.focus}`)?.scrollIntoView({ block: 'center' })
  }, [req.focus])

  const eff = (sha: string) => {
    const o = original.get(sha)!
    const s = state[sha]
    return {
      message: s.message ?? o.message,
      author: s.author ?? { name: o.author.name, email: o.author.email },
      authorDate: s.authorDate ?? o.author.date,
      committer: s.committer ?? { name: o.committer.name, email: o.committer.email },
      committerDate: s.committerDate ?? o.committer.date
    }
  }

  const patch = (sha: string, p: Partial<RowState>): void =>
    setState((st) => ({ ...st, [sha]: { ...st[sha], ...p } }))

  /** Applies a date change to one row and, if cascading, shifts every later row by the same delta. */
  const setDate = (sha: string, which: 'author' | 'committer', d: GitDate): void => {
    const before = which === 'author' ? eff(sha).authorDate : eff(sha).committerDate
    const delta = d.ts - before.ts
    setState((st) => {
      const next = { ...st }
      next[sha] = { ...next[sha], [which === 'author' ? 'authorDate' : 'committerDate']: d }
      if (cascade && delta !== 0) {
        const later = order.slice(order.indexOf(sha) + 1)
        for (const s of later) {
          const o = original.get(s)!
          const cur = next[s]
          const ad = cur.authorDate ?? o.author.date
          const cd = cur.committerDate ?? o.committer.date
          next[s] = {
            ...cur,
            ...(which === 'author' ? { authorDate: { ...ad, ts: ad.ts + delta } } : {}),
            committerDate: { ...cd, ts: cd.ts + delta }
          }
        }
      }
      return next
    })
  }

  const isEdited = (sha: string): boolean => {
    const o = original.get(sha)!
    const e = eff(sha)
    return (
      e.message !== o.message ||
      e.author.name !== o.author.name ||
      e.author.email !== o.author.email ||
      !sameDate(e.authorDate, o.author.date) ||
      e.committer.name !== o.committer.name ||
      e.committer.email !== o.committer.email ||
      !sameDate(e.committerDate, o.committer.date)
    )
  }

  const structural =
    order.some((sha, i) => sha !== range.rows[i].sha) ||
    order.some((sha) => state[sha].action !== 'pick')
  const editedCount = order.filter(isEdited).length
  const dirty = structural || editedCount > 0

  // Chronology: a commit dated before the commit below it (its predecessor in the new order).
  const warnings = useMemo(() => {
    const w = new Set<string>()
    const kept = order.filter((s) => state[s].action !== 'drop')
    for (let i = 1; i < kept.length; i++) {
      if (eff(kept[i]).authorDate.ts < eff(kept[i - 1]).authorDate.ts) w.add(kept[i])
    }
    return w
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, state])

  const move = (sha: string, to: number): void =>
    setOrder((o) => {
      const from = o.indexOf(sha)
      const next = o.slice()
      next.splice(from, 1)
      next.splice(Math.max(0, Math.min(next.length, to)), 0, sha)
      return next
    })

  const resetAll = (): void => {
    setOrder(range.rows.map((r) => r.sha))
    setState(
      Object.fromEntries(range.rows.map((r) => [r.sha, { action: 'pick' as HistoryAction }]))
    )
  }

  const buildPlan = () => {
    const rows: RowEdit[] = order.map((sha) => {
      const o = original.get(sha)!
      const e = eff(sha)
      const r: RowEdit = { sha, action: state[sha].action }
      if (e.message !== o.message) r.message = e.message
      if (e.author.name !== o.author.name || e.author.email !== o.author.email) r.author = e.author
      if (!sameDate(e.authorDate, o.author.date)) r.authorDate = e.authorDate
      if (e.committer.name !== o.committer.name || e.committer.email !== o.committer.email)
        r.committer = e.committer
      if (!sameDate(e.committerDate, o.committer.date)) r.committerDate = e.committerDate
      return r
    })
    return {
      tip: range.tipBranch ?? range.tipSha,
      tipSha: range.tipSha,
      baseSha: range.baseSha,
      rows,
      output:
        outMode === 'new-branch'
          ? { mode: 'new-branch' as const, name: branchName.trim() }
          : { mode: 'in-place' as const },
      preserveCommitterDates: preserveCommitter,
      resign,
      autostash
    }
  }

  const apply = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await call('history.apply', repoId, buildPlan())
      if (r.status === 'conflict') {
        toast.warning('The rebase stopped on a conflict', {
          description: 'Resolve it in the merge editor, then Continue from the banner.',
          duration: 10000
        })
        ui.setView('changes')
      } else if (r.status === 'paused') {
        toast.info('Stopped to edit a commit', {
          description: 'Change its files and stage them, then Continue from the banner.',
          duration: 10000
        })
        ui.setView('changes')
      } else {
        ui.showRewriteResult(r)
      }
    } catch (e) {
      showError(e, 'Rewrite failed')
    } finally {
      setBusy(false)
      void invalidateRepo(queryClient, repoId)
    }
  }

  const display = order.slice().reverse() // newest first, like the graph
  const sel = order.filter((s) => selected.has(s)) // oldest → newest

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-2 text-xs">
        <Checkbox
          checked={selected.size === order.length && order.length > 0}
          onChange={(v) => setSelected(v ? new Set(order) : new Set())}
          label={
            <span className="text-muted">
              {selected.size ? `${selected.size} selected` : 'Select all'}
            </span>
          }
        />
        <Checkbox
          checked={cascade}
          onChange={setCascade}
          label={<span className="text-muted">Shift later commits with date edits</span>}
          title="When you change a commit's date, move every newer commit by the same amount, keeping the original spacing"
        />
        <div className="flex-1" />
        {warnings.size > 0 && (
          <span
            className="flex items-center gap-1 text-warn"
            title="Some commits are dated before the commit they follow"
          >
            <AlertTriangle size={12} /> {warnings.size} out of order
          </span>
        )}
        <span className="text-faint">
          {range.rows.length} commits · newest at the top
          {hasMerges ? ' · contains merges (reorder disabled)' : ''}
        </span>
        <Button
          size="sm"
          variant="ghost"
          icon={<RotateCcw size={12} />}
          onClick={resetAll}
          disabled={!dirty}
        >
          Reset all
        </Button>
      </div>

      {sel.length > 0 && <BulkTools sel={sel} eff={eff} setState={setState} original={original} />}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead className="sticky top-0 z-10 bg-panel text-left text-[11px] text-faint">
            <tr className="border-b border-line">
              <th className="w-8" />
              <th className="w-6" />
              <th className="w-[88px] font-medium">Action</th>
              <th className="w-[72px] font-medium">Commit</th>
              <th className="font-medium">Message</th>
              <th className="w-[150px] font-medium">Author</th>
              <th className="w-[290px] font-medium">Author date</th>
              <th className="w-[290px] pr-3 font-medium">Committer date</th>
            </tr>
          </thead>
          <tbody>
            {display.map((sha) => {
              const o = original.get(sha)!
              const e = eff(sha)
              const st = state[sha]
              const idx = order.indexOf(sha)
              const isOpen = expanded === sha
              const changed = (a: boolean): string => (a ? 'text-edit' : '')
              return (
                <Fragment key={sha}>
                  <tr
                    id={`hrow-${sha}`}
                    onDragOver={(ev) => dragSha && ev.preventDefault()}
                    onDrop={() => {
                      if (dragSha && dragSha !== sha) move(dragSha, order.indexOf(sha))
                      setDragSha(null)
                    }}
                    className={cx(
                      'h-9 border-b border-line',
                      st.action === 'drop' && 'opacity-40 line-through',
                      (st.action === 'squash' || st.action === 'fixup') && 'bg-panel-2',
                      st.action === 'edit' && 'bg-edit/[0.07]',
                      selected.has(sha) ? 'bg-accent-strong/15' : 'hover:bg-hover',
                      dragSha === sha && 'opacity-50',
                      req.focus === sha && 'outline outline-1 -outline-offset-1 outline-accent/60'
                    )}
                  >
                    <td className="text-center">
                      <input
                        type="checkbox"
                        className="accent-accent-strong"
                        checked={selected.has(sha)}
                        onChange={() =>
                          setSelected((s) => {
                            const n = new Set(s)
                            if (n.has(sha)) n.delete(sha)
                            else n.add(sha)
                            return n
                          })
                        }
                      />
                    </td>
                    <td>
                      <span
                        draggable={!hasMerges}
                        onDragStart={() => setDragSha(sha)}
                        onDragEnd={() => setDragSha(null)}
                        className={cx(
                          'flex cursor-grab text-faint',
                          hasMerges && 'cursor-not-allowed opacity-30'
                        )}
                        title="Drag to reorder"
                      >
                        <GripVertical size={13} />
                      </span>
                    </td>
                    <td>
                      <Select<HistoryAction>
                        className="h-6 w-[80px] pl-1.5 text-xs"
                        disabled={hasMerges}
                        value={st.action}
                        aria-label="Action"
                        onChange={(action) => patch(sha, { action })}
                        options={[
                          { value: 'pick', label: 'pick' },
                          {
                            value: 'edit',
                            label: 'edit',
                            title: 'Stop at this commit so you can change its files'
                          },
                          { value: 'squash', label: 'squash', disabled: idx === 0 },
                          { value: 'fixup', label: 'fixup', disabled: idx === 0 },
                          { value: 'drop', label: 'drop' }
                        ]}
                      />
                    </td>
                    <td className="mono text-faint">
                      {short(sha)}
                      {o.signed && <span title="signed"> ✓</span>}
                    </td>
                    <td className="max-w-0 pr-2">
                      <button
                        className={cx(
                          'flex w-full items-center gap-1 text-left',
                          changed(e.message !== o.message)
                        )}
                        onClick={() => setExpanded(isOpen ? null : sha)}
                        title="Edit message and identities"
                      >
                        <ChevronRight
                          size={12}
                          className={cx(
                            'shrink-0 text-faint transition-transform',
                            isOpen && 'rotate-90'
                          )}
                        />
                        {warnings.has(sha) && (
                          <span title="Dated before the previous commit">
                            <AlertTriangle size={12} className="shrink-0 text-warn" />
                          </span>
                        )}
                        <span className="truncate">{e.message.split('\n')[0]}</span>
                      </button>
                    </td>
                    <td
                      className={cx(
                        'truncate',
                        changed(
                          e.author.name !== o.author.name || e.author.email !== o.author.email
                        )
                      )}
                      title={`${e.author.name} <${e.author.email}>`}
                    >
                      {e.author.name}
                    </td>
                    <td className={changed(!sameDate(e.authorDate, o.author.date))}>
                      <DateField
                        compact
                        changed={!sameDate(e.authorDate, o.author.date)}
                        value={e.authorDate}
                        onChange={(d) => setDate(sha, 'author', d)}
                      />
                    </td>
                    <td
                      className={cx('pr-3', changed(!sameDate(e.committerDate, o.committer.date)))}
                    >
                      <DateField
                        compact
                        changed={!sameDate(e.committerDate, o.committer.date)}
                        value={e.committerDate}
                        onChange={(d) => setDate(sha, 'committer', d)}
                      />
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-line bg-panel">
                      <td colSpan={8} className="px-10 py-3">
                        <RowDetail
                          o={o}
                          e={e}
                          onPatch={(p) => patch(sha, p)}
                          onReset={() =>
                            patch(sha, {
                              message: undefined,
                              author: undefined,
                              committer: undefined,
                              authorDate: undefined,
                              committerDate: undefined
                            })
                          }
                          canMove={!hasMerges}
                          onMove={(d) => move(sha, idx + d)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-line bg-panel px-3 py-2.5">
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[13px]">
            <input
              type="radio"
              className="accent-accent-strong"
              checked={outMode === 'new-branch'}
              onChange={() => setOutMode('new-branch')}
            />
            New branch
          </label>
          <input
            className="field mono w-72"
            value={branchName}
            disabled={outMode !== 'new-branch'}
            onChange={(e) => setBranchName(e.target.value)}
          />
          <label
            className={cx(
              'ml-2 flex items-center gap-1.5 text-[13px]',
              !range.tipBranch && 'opacity-40'
            )}
          >
            <input
              type="radio"
              className="accent-accent-strong"
              disabled={!range.tipBranch}
              checked={outMode === 'in-place'}
              onChange={() => setOutMode('in-place')}
            />
            Rewrite {range.tipBranch ?? 'branch'} in place
          </label>
        </div>
        {structural && (
          <>
            <Checkbox
              checked={preserveCommitter}
              onChange={setPreserveCommitter}
              label="Keep committer dates"
            />
            <Checkbox checked={autostash} onChange={setAutostash} label="Autostash" />
          </>
        )}
        {anySigned && <Checkbox checked={resign} onChange={setResign} label="Re-sign commits" />}
        <div className="flex-1" />
        <span className="text-xs text-muted">
          {!dirty
            ? 'No changes yet'
            : structural
              ? 'Structural edit — uses rebase (conflicts possible)'
              : `${editedCount} commit${editedCount === 1 ? '' : 's'} edited — metadata only, conflict-free`}
        </span>
        <Button
          variant={outMode === 'in-place' ? 'danger' : 'primary'}
          disabled={!dirty || busy || (outMode === 'new-branch' && !branchName.trim())}
          onClick={() => void apply()}
        >
          {busy
            ? 'Applying…'
            : outMode === 'in-place'
              ? `Rewrite ${range.tipBranch}`
              : 'Create branch'}
        </Button>
      </div>
    </div>
  )
}

function RowDetail({
  o,
  e,
  onPatch,
  onReset,
  canMove,
  onMove
}: {
  o: HistoryRow
  e: { message: string; author: Person; committer: Person }
  onPatch: (p: Partial<RowState>) => void
  onReset: () => void
  canMove: boolean
  onMove: (delta: number) => void
}) {
  return (
    <div className="flex gap-6">
      <div className="flex-1">
        <div className="mb-1 text-[11px] text-faint">Message</div>
        <textarea
          className="field mono h-28 w-full resize-y py-1.5"
          value={e.message.replace(/\n$/, '')}
          onChange={(ev) =>
            onPatch({
              message:
                ev.target.value === o.message.replace(/\n$/, '')
                  ? undefined
                  : ev.target.value + '\n'
            })
          }
        />
      </div>
      <div className="flex w-[380px] flex-col gap-2">
        {(['author', 'committer'] as const).map((who) => (
          <div key={who}>
            <div className="mb-1 text-[11px] text-faint capitalize">{who}</div>
            <div className="flex gap-1.5">
              <input
                className="field min-w-0 flex-1"
                value={e[who].name}
                onChange={(ev) => onPatch({ [who]: { ...e[who], name: ev.target.value } })}
              />
              <input
                className="field min-w-0 flex-1"
                value={e[who].email}
                onChange={(ev) => onPatch({ [who]: { ...e[who], email: ev.target.value } })}
              />
            </div>
          </div>
        ))}
        <div className="mt-1 flex gap-2">
          <Button size="sm" icon={<RotateCcw size={11} />} onClick={onReset}>
            Reset commit
          </Button>
          <Button
            size="sm"
            icon={<ArrowUp size={11} />}
            disabled={!canMove}
            onClick={() => onMove(1)}
            title="Move newer"
          />
          <Button
            size="sm"
            icon={<ArrowDown size={11} />}
            disabled={!canMove}
            onClick={() => onMove(-1)}
            title="Move older"
          />
          <span className="ml-auto self-center text-[11px] text-faint">
            was {formatGitDate(o.author.date)}
          </span>
        </div>
      </div>
    </div>
  )
}

function BulkTools({
  sel,
  eff,
  setState,
  original
}: {
  sel: string[]
  eff: (sha: string) => { authorDate: GitDate; committerDate: GitDate }
  setState: (fn: (s: Record<string, RowState>) => Record<string, RowState>) => void
  original: Map<string, HistoryRow>
}) {
  const [target, setTarget] = useState<DateTarget>('both')
  const [offset, setOffset] = useState('+1h')
  const first = eff(sel[0]).authorDate
  const last = eff(sel[sel.length - 1]).authorDate
  const [start, setStart] = useState<GitDate>(first)
  const [end, setEnd] = useState<GitDate>(
    last.ts > first.ts ? last : { ...first, ts: first.ts + 3600 * Math.max(1, sel.length - 1) }
  )
  const [fixed, setFixed] = useState<GitDate>(nowGitDate)
  const parsed = parseOffset(offset)

  const assign = (fn: (sha: string, i: number) => { a?: GitDate; c?: GitDate }): void =>
    setState((st) => {
      const next = { ...st }
      sel.forEach((sha, i) => {
        const { a, c } = fn(sha, i)
        next[sha] = {
          ...next[sha],
          ...(a && target !== 'committer' ? { authorDate: a } : {}),
          ...(c && target !== 'author' ? { committerDate: c } : {})
        }
      })
      return next
    })

  const withTs = (d: GitDate, ts: number, tz = d.tz): GitDate => ({ ts, tz })

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-panel-2 px-3 py-2 text-xs">
      <div className="flex items-center gap-1.5">
        <span className="text-muted">Apply to</span>
        <Select<DateTarget>
          value={target}
          onChange={setTarget}
          className="h-6 w-[150px] text-xs"
          aria-label="Apply to"
          options={[
            { value: 'both', label: 'author + committer' },
            { value: 'author', label: 'author dates' },
            { value: 'committer', label: 'committer dates' }
          ]}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <input
          className={cx('field mono h-6 w-24', parsed === null && 'border-bad')}
          value={offset}
          onChange={(e) => setOffset(e.target.value)}
          title="e.g. +2h, -1d 3h, 90m"
        />
        <Button
          size="sm"
          disabled={parsed === null}
          onClick={() =>
            assign((sha) => {
              const e = eff(sha)
              return {
                a: withTs(e.authorDate, e.authorDate.ts + parsed!),
                c: withTs(e.committerDate, e.committerDate.ts + parsed!)
              }
            })
          }
        >
          Shift {parsed !== null ? formatOffset(parsed) : ''}
        </Button>
      </div>
      <div className="flex items-center gap-1.5">
        <DateField compact value={start} onChange={setStart} />
        <span className="text-faint">→</span>
        <DateField compact value={end} onChange={setEnd} />
        <Button
          size="sm"
          disabled={end.ts < start.ts}
          onClick={() => {
            const ts = spreadEvenly(start.ts, end.ts, sel.length)
            assign((_s, i) => ({
              a: withTs(start, ts[i], start.tz),
              c: withTs(start, ts[i], start.tz)
            }))
          }}
        >
          Spread evenly
        </Button>
        <Button
          size="sm"
          disabled={end.ts < start.ts}
          onClick={() => {
            const ts = spreadRandom(start.ts, end.ts, sel.length)
            assign((_s, i) => ({
              a: withTs(start, ts[i], start.tz),
              c: withTs(start, ts[i], start.tz)
            }))
          }}
        >
          Random (in order)
        </Button>
      </div>
      <div className="flex items-center gap-1.5">
        <DateField compact value={fixed} onChange={setFixed} />
        <Button size="sm" onClick={() => assign(() => ({ a: fixed, c: fixed }))}>
          Set all
        </Button>
      </div>
      <Button
        size="sm"
        onClick={() =>
          setState((st) => {
            const next = { ...st }
            for (const sha of sel) next[sha] = { ...next[sha], committerDate: eff(sha).authorDate }
            return next
          })
        }
      >
        Committer = author
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          setState((st) => {
            const next = { ...st }
            for (const sha of sel) {
              const o = original.get(sha)!
              next[sha] = {
                ...next[sha],
                authorDate: o.author.date,
                committerDate: o.committer.date
              }
            }
            return next
          })
        }
      >
        Reset dates
      </Button>
    </div>
  )
}

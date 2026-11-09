import type { MergeResolution, MergeVersions } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronUp, FileWarning, X } from 'lucide-react'
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { queryClient } from '../../lib/actions'
import { call } from '../../lib/api'
import { cx } from '../../lib/format'
import { langFromPath } from '../../lib/highlight'
import { invalidateRepo, showError, useRepoId, useStatus } from '../../lib/queries'
import { useUi, type MergeRequest } from '../../lib/store'
import { CodeEditor, CodeView } from '../code/Code'
import { Button, Empty, Spinner } from '../ui'
import {
  compose,
  parseConflicts,
  resolvedText,
  type Choice,
  type ConflictSeg,
  type Segment
} from './conflicts'

type Tab = 'result' | 'ours' | 'theirs' | 'base'

/** Language of the file being merged, for syntax highlighting of every block. */
const LangCtx = createContext<string | null>(null)

function Code({ text, className, dim }: { text: string; className?: string; dim?: boolean }) {
  const lang = useContext(LangCtx)
  return (
    <div className={cx('overflow-x-auto', className)}>
      <CodeView text={text || ' '} lang={lang} dim={dim} />
    </div>
  )
}

function TextBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const lines = text.split('\n')
  if (lines.length <= 14 || open) return <Code text={text.replace(/\n$/, '')} dim />
  return (
    <>
      <Code text={lines.slice(0, 4).join('\n')} dim />
      <button
        onClick={() => setOpen(true)}
        className="mono w-full bg-panel-2 py-0.5 text-center text-[11px] text-faint hover:text-fg"
      >
        ⋯ {lines.length - 8} unchanged lines
      </button>
      <Code text={lines.slice(-4).join('\n').replace(/\n$/, '')} dim />
    </>
  )
}

/** Git's marker labels are refs, commit subjects, or (for dry runs) bare object ids; hide the latter. */
function SideLabel({ kind, label, className }: { kind: string; label: string; className: string }) {
  const meaningful = label && !/^[0-9a-f]{40}([0-9a-f]{24})?$/i.test(label.trim())
  return (
    <div className="flex items-baseline gap-2 px-3 pt-1 text-[10px]">
      <span className={cx('font-semibold tracking-wide uppercase', className)}>{kind}</span>
      {meaningful && <span className="mono truncate text-faint">{label}</span>}
    </div>
  )
}

function ConflictBlock({
  seg,
  index,
  total,
  readOnly,
  onChange,
  innerRef
}: {
  seg: ConflictSeg
  index: number
  total: number
  readOnly: boolean
  onChange: (s: ConflictSeg) => void
  innerRef: (el: HTMLDivElement | null) => void
}) {
  const resolved = resolvedText(seg)
  const lang = useContext(LangCtx)
  const choose = (choice: Choice): void =>
    onChange({
      ...seg,
      choice,
      custom: choice === 'custom' ? (resolvedText(seg) ?? seg.ours) : seg.custom
    })
  const opts: Array<[Choice, string]> = [
    ['ours', 'Current'],
    ['theirs', 'Incoming'],
    ['both', 'Both'],
    ...(seg.base !== null ? ([['base', 'Base']] as Array<[Choice, string]>) : []),
    ['custom', 'Edit']
  ]
  return (
    <div
      ref={innerRef}
      className={cx('my-1 border-y', resolved === null ? 'border-warn/40' : 'border-ok/30')}
    >
      <div className="flex h-7 items-center gap-1 bg-panel-2 px-3 text-[11px]">
        <span className={cx('font-semibold', resolved === null ? 'text-warn' : 'text-ok')}>
          {resolved === null ? 'Conflict' : 'Resolved'} {index + 1}/{total}
        </span>
        <div className="flex-1" />
        {!readOnly &&
          opts.map(([c, label]) => (
            <button
              key={c}
              onClick={() => choose(c)}
              className={cx(
                'rounded px-2 py-0.5',
                seg.choice === c
                  ? 'bg-accent-strong text-white'
                  : 'text-muted hover:bg-hover hover:text-fg'
              )}
            >
              {label}
            </button>
          ))}
        {!readOnly && seg.choice && (
          <button
            className="ml-1 rounded px-1.5 py-0.5 text-faint hover:text-fg"
            onClick={() => onChange({ ...seg, choice: null })}
            title="Undo choice"
          >
            <X size={11} />
          </button>
        )}
      </div>
      {seg.choice === 'custom' ? (
        <CodeEditor
          lang={lang}
          autoFocus
          rows={Math.min(24, Math.max(3, seg.custom.split('\n').length + 1))}
          value={seg.custom}
          onChange={(v) => onChange({ ...seg, custom: v })}
        />
      ) : resolved !== null ? (
        <Code text={resolved.replace(/\n$/, '')} className="bg-ok/5" />
      ) : (
        <div className="grid grid-cols-2 divide-x divide-line">
          <div>
            <SideLabel kind="Current" label={seg.oursLabel} className="text-accent" />
            <Code text={seg.ours.replace(/\n$/, '')} className="bg-accent/5" />
          </div>
          <div>
            <SideLabel kind="Incoming" label={seg.theirsLabel} className="text-ok" />
            <Code text={seg.theirs.replace(/\n$/, '')} className="bg-ok/5" />
          </div>
          {seg.base !== null && (
            <div className="col-span-2 border-t border-line">
              <div className="px-3 pt-1 text-[10px] tracking-wide text-faint uppercase">Base</div>
              <Code text={seg.base.replace(/\n$/, '')} dim />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FileMerge({
  req,
  versions,
  onResolved
}: {
  req: MergeRequest
  versions: MergeVersions
  onResolved: () => void
}) {
  const repoId = useRepoId()
  const readOnly = req.source.kind !== 'live'
  const lang = langFromPath(versions.path)
  const [segs, setSegs] = useState<Segment[]>(() => parseConflicts(versions.merged ?? ''))
  const [tab, setTab] = useState<Tab>('result')
  const [manual, setManual] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const blockRefs = useRef<Array<HTMLDivElement | null>>([])
  const [cursor, setCursor] = useState(0)
  const { text, unresolved } = useMemo(() => compose(segs), [segs])
  const conflicts = segs.filter((s): s is ConflictSeg => s.kind === 'conflict')

  const save = async (resolution: MergeResolution): Promise<void> => {
    setSaving(true)
    try {
      await call('merge.resolve', repoId, versions.path, resolution)
      toast.success(`Resolved ${versions.path}`)
      await invalidateRepo(queryClient, repoId)
      onResolved()
    } catch (e) {
      showError(e, 'Could not resolve')
    } finally {
      setSaving(false)
    }
  }

  const jump = (dir: 1 | -1): void => {
    if (!conflicts.length) return
    const next = (cursor + dir + conflicts.length) % conflicts.length
    setCursor(next)
    blockRefs.current[next]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  const deleted = versions.ours === null || versions.theirs === null
  if (versions.binary || (deleted && !readOnly && conflicts.length === 0)) {
    return (
      <Empty>
        <div className="flex flex-col items-center gap-3">
          <FileWarning className="text-warn" />
          <div>
            {versions.binary
              ? 'Binary file — choose one side.'
              : versions.ours === null
                ? 'Deleted in the current version, modified in the incoming one.'
                : 'Modified in the current version, deleted in the incoming one.'}
          </div>
          {!readOnly && (
            <div className="flex gap-2">
              {versions.ours !== null || versions.binary ? (
                <Button onClick={() => save({ take: 'ours' })}>Keep current</Button>
              ) : null}
              {versions.theirs !== null || versions.binary ? (
                <Button onClick={() => save({ take: 'theirs' })}>Keep incoming</Button>
              ) : null}
              <Button variant="danger" onClick={() => save({ delete: true })}>
                Delete file
              </Button>
            </div>
          )}
        </div>
      </Empty>
    )
  }

  let ci = -1
  return (
    <LangCtx.Provider value={lang}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
          {(['result', 'ours', 'theirs', 'base'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cx(
                'h-7 rounded px-2.5 text-xs',
                tab === t ? 'bg-line text-fg' : 'text-muted hover:text-fg'
              )}
            >
              {t === 'result'
                ? 'Result'
                : t === 'ours'
                  ? 'Current'
                  : t === 'theirs'
                    ? 'Incoming'
                    : 'Base'}
            </button>
          ))}
          <div className="flex-1" />
          {tab === 'result' && manual === null && (
            <>
              <span className={cx('mr-2 text-xs', unresolved ? 'text-warn' : 'text-ok')}>
                {unresolved
                  ? `${unresolved} unresolved`
                  : conflicts.length
                    ? 'All resolved'
                    : 'No conflict markers'}
              </span>
              <Button
                size="sm"
                variant="ghost"
                icon={<ChevronUp size={12} />}
                onClick={() => jump(-1)}
                disabled={!conflicts.length}
              />
              <Button
                size="sm"
                variant="ghost"
                icon={<ChevronDown size={12} />}
                onClick={() => jump(1)}
                disabled={!conflicts.length}
              />
            </>
          )}
          {!readOnly && tab === 'result' && (
            <>
              {conflicts.length > 0 && manual === null && (
                <>
                  <Button
                    size="sm"
                    onClick={() =>
                      setSegs((s) =>
                        s.map((x) => (x.kind === 'conflict' ? { ...x, choice: 'ours' } : x))
                      )
                    }
                  >
                    All current
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      setSegs((s) =>
                        s.map((x) => (x.kind === 'conflict' ? { ...x, choice: 'theirs' } : x))
                      )
                    }
                  >
                    All incoming
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant={manual !== null ? 'default' : 'ghost'}
                onClick={() => setManual(manual === null ? text : null)}
              >
                {manual === null ? 'Edit as text' : 'Back to blocks'}
              </Button>
            </>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-bg">
          {tab !== 'result' && (
            <FullFile
              text={
                tab === 'ours' ? versions.ours : tab === 'theirs' ? versions.theirs : versions.base
              }
              missing={
                tab === 'base'
                  ? '(no common ancestor version)'
                  : '(file does not exist on this side)'
              }
            />
          )}
          {tab === 'result' &&
            (manual !== null ? (
              <CodeEditor lang={lang} className="h-full" value={manual} onChange={setManual} />
            ) : (
              segs.map((s, i) => {
                if (s.kind === 'text') return <TextBlock key={i} text={s.text} />
                ci++
                const idx = ci
                return (
                  <ConflictBlock
                    key={i}
                    seg={s}
                    index={idx}
                    total={conflicts.length}
                    readOnly={readOnly}
                    innerRef={(el) => (blockRefs.current[idx] = el)}
                    onChange={(next) => setSegs((all) => all.map((x, j) => (j === i ? next : x)))}
                  />
                )
              })
            ))}
        </div>
        {!readOnly && (
          <div className="flex h-11 shrink-0 items-center gap-2 border-t border-line px-3">
            <span className="text-xs text-faint">
              Saving writes the result to the file and stages it (git add).
            </span>
            <div className="flex-1" />
            <Button onClick={() => save({ take: 'ours' })} disabled={saving}>
              Take current file
            </Button>
            <Button onClick={() => save({ take: 'theirs' })} disabled={saving}>
              Take incoming file
            </Button>
            <Button
              variant="primary"
              icon={<Check size={13} />}
              disabled={saving || (manual === null && unresolved > 0)}
              onClick={() => save({ content: manual ?? text })}
            >
              Save &amp; mark resolved
            </Button>
          </div>
        )}
      </div>
    </LangCtx.Provider>
  )
}

function FullFile({ text, missing }: { text: string | null; missing: string }) {
  const lang = useContext(LangCtx)
  if (text === null) return <Empty>{missing}</Empty>
  return <CodeView text={text} lang={lang} lineNumbers className="bg-bg" />
}

export function MergeEditorView() {
  const req = useUi((s) => s.merge)
  const ui = useUi()
  const repoId = useRepoId()
  const status = useStatus()
  const live = req?.source.kind === 'live'
  const stillConflicted = useMemo(
    () => new Set((status.data?.entries ?? []).filter((e) => e.conflicted).map((e) => e.path)),
    [status.data]
  )
  const versions = useQuery({
    // Deliberately outside the ['repo', …] namespace: background refreshes must not reset in-progress choices.
    queryKey: ['merge-versions', repoId, req?.path, req?.source],
    queryFn: () => call('merge.versions', repoId, req!.path, req!.source),
    enabled: !!req,
    staleTime: Infinity,
    gcTime: 0
  })

  // Close automatically once every conflict we have actually seen is resolved. (Status may still be
  // the cached pre-apply snapshot right after opening, which has no conflicts yet.)
  const sawConflicts = useRef(false)
  useEffect(() => {
    if (!live || !req || !status.data) return
    if (stillConflicted.size > 0) {
      sawConflicts.current = true
      return
    }
    if (!sawConflicts.current) return
    toast.success('All conflicts resolved', {
      description:
        status.data.op.kind !== 'none'
          ? `Continue the ${status.data.op.kind} from the banner above.`
          : undefined
    })
    ui.closeMerge()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, stillConflicted.size, status.data])

  if (!req) return <Empty>No merge in progress</Empty>
  const next = (): void => {
    const remaining = req.paths.filter((p) => p !== req.path && stillConflicted.has(p))
    if (remaining.length) ui.openMerge({ ...req, path: remaining[0] })
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-60 shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex h-9 items-center justify-between border-b border-line px-3">
          <span className="truncate text-xs font-semibold" title={req.title}>
            {req.title}
          </span>
          <button
            className="rounded p-1 text-muted hover:bg-hover hover:text-fg"
            onClick={ui.closeMerge}
            title="Close"
          >
            <X size={13} />
          </button>
        </div>
        {!live && (
          <div className="border-b border-line bg-accent/10 px-3 py-2 text-[11px] leading-snug text-accent">
            Preview only — nothing has been applied yet.
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto py-1">
          {req.paths.map((p) => {
            const done = live && !stillConflicted.has(p)
            return (
              <div
                key={p}
                onClick={() => ui.openMerge({ ...req, path: p })}
                className={cx(
                  'mx-1 flex h-[26px] cursor-default items-center gap-2 rounded px-2',
                  p === req.path ? 'bg-accent-strong/25' : 'hover:bg-hover'
                )}
              >
                {done ? (
                  <Check size={12} className="text-ok" />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-warn" />
                )}
                <span className={cx('truncate', done && 'text-muted line-through')} title={p}>
                  {p.split('/').pop()}
                </span>
              </div>
            )
          })}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center border-b border-line px-3">
          <span className="mono truncate">{req.path}</span>
        </div>
        <div className="min-h-0 flex-1">
          {versions.isLoading ? (
            <Empty>
              <Spinner />
            </Empty>
          ) : versions.data ? (
            <FileMerge key={req.path} req={req} versions={versions.data} onResolved={next} />
          ) : (
            <Empty>
              {versions.error ? String((versions.error as Error).message) : 'Not available'}
            </Empty>
          )}
        </div>
      </div>
    </div>
  )
}

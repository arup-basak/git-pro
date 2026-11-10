import { memo, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { cx } from '../../lib/format'
import { langFromPath, useTokenizer, type ThemedToken } from '../../lib/highlight'
import {
  pairRuns,
  parsePatch,
  splitRows,
  type DiffFile,
  type DiffHunk,
  type DiffLine
} from '../../lib/patch'
import { useViewSettings, type DiffLayout } from '../../lib/settings'
import { wordDiff, type Range } from '../../lib/wordDiff'
import { TokenLine } from '../code/Code'
import { Empty, Spinner } from '../ui'

/** Above this many lines per side, skip syntax highlighting to keep large diffs snappy. */
const HIGHLIGHT_MAX_LINES = 8000

interface Decorated {
  tokens: Array<ThemedToken[] | null>
  marks: Array<Range[] | null>
}

/**
 * Highlights the old and new side of a file diff separately (so each side is tokenized as
 * continuous code), then maps tokens back onto the diff lines. Also pairs runs of removed/added
 * lines and computes word-level change marks.
 */
function useDecorations(file: DiffFile, wordMarks: boolean): Decorated {
  const tokenize = useTokenizer(langFromPath(file.path))
  return useMemo(() => {
    const oldSide: string[] = []
    const newSide: string[] = []
    for (const l of file.lines) {
      if (l.kind === 'ctx') {
        oldSide.push(l.text)
        newSide.push(l.text)
      } else if (l.kind === 'del') oldSide.push(l.text)
      else if (l.kind === 'add') newSide.push(l.text)
    }
    const big = oldSide.length > HIGHLIGHT_MAX_LINES || newSide.length > HIGHLIGHT_MAX_LINES
    const oldTok = tokenize && !big && oldSide.length ? tokenize(oldSide.join('\n')) : null
    const newTok = tokenize && !big && newSide.length ? tokenize(newSide.join('\n')) : null

    const tokens: Array<ThemedToken[] | null> = []
    const marks: Array<Range[] | null> = new Array(file.lines.length).fill(null)
    let oi = 0
    let ni = 0
    for (const l of file.lines) {
      if (l.kind === 'ctx') {
        tokens.push(newTok?.[ni] ?? null)
        oi++
        ni++
      } else if (l.kind === 'del') tokens.push(oldTok?.[oi++] ?? null)
      else if (l.kind === 'add') tokens.push(newTok?.[ni++] ?? null)
      else tokens.push(null)
    }

    if (wordMarks) {
      for (const [d, a] of pairRuns(file.lines)) {
        const w = wordDiff(file.lines[d].text, file.lines[a].text)
        if (w) {
          marks[d] = w.a
          marks[a] = w.b
        }
      }
    }
    return { tokens, marks }
  }, [file, tokenize, wordMarks])
}

/** Line selection in a diff (for staging, discarding or stashing single lines). */
export interface DiffSelection {
  /** Selected change ordinals (DiffLine.change). */
  selected: ReadonlySet<number>
  onChange(next: Set<number>): void
  /** Buttons for a hunk header; receives the hunk's change ordinals. */
  hunkActions?(changes: number[]): ReactNode
}

const ROW_TINT: Partial<Record<DiffLine['kind'], string>> = {
  add: 'bg-ok/[0.08]',
  del: 'bg-bad/[0.08]',
  hunk: 'bg-accent/[0.07] text-accent/80',
  meta: 'text-faint'
}

function lineTint(l: DiffLine, selected: boolean): string {
  if (l.kind === 'add') return selected ? 'bg-ok/25' : 'bg-ok/[0.08]'
  if (l.kind === 'del') return selected ? 'bg-bad/25' : 'bg-bad/[0.08]'
  return ''
}

/** The text cell of one diff line (syntax tokens + changed-word marks). */
function LineText({
  line,
  tokens,
  marks,
  wrap,
  className
}: {
  line: DiffLine
  tokens: ThemedToken[] | null
  marks: Range[] | null
  wrap: boolean
  className?: string
}) {
  const code = line.kind === 'add' || line.kind === 'del' || line.kind === 'ctx'
  return (
    <td
      className={cx(
        'pr-4 align-top select-text',
        wrap ? 'break-all whitespace-pre-wrap' : 'whitespace-pre',
        className
      )}
    >
      {code ? (
        <TokenLine
          text={line.text}
          tokens={tokens}
          marks={marks}
          markClass={line.kind === 'add' ? 'rounded-[2px] bg-ok/30' : 'rounded-[2px] bg-bad/30'}
        />
      ) : (
        line.text
      )}
      {line.text === '' ? ' ' : null}
    </td>
  )
}

function Sign({ kind, className }: { kind: DiffLine['kind']; className?: string }) {
  return (
    <td
      className={cx(
        'w-4 text-center align-top select-none',
        className,
        kind === 'add' && 'text-ok',
        kind === 'del' && 'text-bad'
      )}
    >
      {kind === 'add' ? '+' : kind === 'del' ? '−' : ''}
    </td>
  )
}

const NUM = 'w-10 pr-2 text-right align-top text-faint/70 select-none'

/** A small square checkbox drawn in the selection gutter. */
function Tick({ state }: { state: 'on' | 'off' | 'some' }) {
  return (
    <span
      className={cx(
        'mt-[3px] flex h-[13px] w-[13px] items-center justify-center rounded-[3px] border text-[9px] leading-none',
        state === 'off'
          ? 'border-line-strong group-hover/g:border-accent'
          : 'border-accent-strong bg-accent-strong text-white'
      )}
    >
      {state === 'on' ? '✓' : state === 'some' ? '–' : ''}
    </span>
  )
}

/** Mouse handling for the selection gutter: click, shift-click ranges and drag-to-select. */
function useGutter(sel: DiffSelection | undefined, order: number[]) {
  const anchor = useRef<number | null>(null)
  const drag = useRef<{ on: boolean } | null>(null)
  useEffect(() => {
    const up = (): void => {
      drag.current = null
    }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])
  if (!sel) return null
  const set = (changes: number[], on: boolean): void => {
    const next = new Set(sel.selected)
    for (const c of changes) {
      if (on) next.add(c)
      else next.delete(c)
    }
    sel.onChange(next)
  }
  return {
    down(c: number, shift: boolean): void {
      if (shift && anchor.current !== null) {
        const a = order.indexOf(anchor.current)
        const b = order.indexOf(c)
        set(order.slice(Math.min(a, b), Math.max(a, b) + 1), true)
        return
      }
      const on = !sel.selected.has(c)
      drag.current = { on }
      anchor.current = c
      set([c], on)
    },
    enter(c: number): void {
      if (drag.current && sel.selected.has(c) !== drag.current.on) set([c], drag.current.on)
    },
    hunk(changes: number[]): void {
      set(changes, !changes.every((c) => sel.selected.has(c)))
    }
  }
}

type Gutter = NonNullable<ReturnType<typeof useGutter>>

function GutterCell({
  line,
  gutter,
  selected,
  className
}: {
  line: DiffLine | undefined
  gutter: Gutter
  selected: ReadonlySet<number>
  className?: string
}) {
  const c = line?.change
  if (c === undefined) return <td className={cx('w-5', className)} />
  return (
    <td
      className={cx('group/g w-5 cursor-pointer pl-1 align-top select-none', className)}
      title="Select this line (shift-click for a range, drag for several)"
      onMouseDown={(e) => {
        e.preventDefault()
        gutter.down(c, e.shiftKey)
      }}
      onMouseEnter={() => gutter.enter(c)}
    >
      <Tick state={selected.has(c) ? 'on' : 'off'} />
    </td>
  )
}

/** A hunk header row: optional hunk checkbox and actions, header text spanning the rest. */
function HunkRow({
  line,
  hunk,
  span,
  sel,
  gutter
}: {
  line: DiffLine
  hunk: DiffHunk | undefined
  span: number
  sel: DiffSelection | undefined
  gutter: Gutter | null
}) {
  const changes = hunk?.changes ?? []
  const n = changes.filter((c) => sel?.selected.has(c)).length
  return (
    <tr className={ROW_TINT.hunk}>
      {gutter && (
        <td
          className="group/g w-5 cursor-pointer pl-1 align-top select-none"
          title="Select every changed line in this hunk"
          onMouseDown={(e) => {
            e.preventDefault()
            gutter.hunk(changes)
          }}
        >
          <Tick state={n === 0 ? 'off' : n === changes.length ? 'on' : 'some'} />
        </td>
      )}
      <td colSpan={span} className="pr-2">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate px-1 select-text">{line.text}</span>
          {sel?.hunkActions && (
            <span className="flex shrink-0 gap-1 py-0.5 text-fg">{sel.hunkActions(changes)}</span>
          )}
        </div>
      </td>
    </tr>
  )
}

function UnifiedBody({
  file,
  deco,
  wrap,
  sel,
  gutter
}: {
  file: DiffFile
  deco: Decorated
  wrap: boolean
  sel?: DiffSelection
  gutter: Gutter | null
}) {
  return (
    <tbody>
      {file.lines.map((l, j) => {
        if (l.kind === 'hunk' && (sel || gutter)) {
          return (
            <HunkRow
              key={j}
              line={l}
              hunk={file.hunks[l.hunk ?? -1]}
              span={4}
              sel={sel}
              gutter={gutter}
            />
          )
        }
        const on = l.change !== undefined && !!sel?.selected.has(l.change)
        return (
          <tr
            key={j}
            className={l.kind === 'add' || l.kind === 'del' ? lineTint(l, on) : ROW_TINT[l.kind]}
          >
            {gutter && sel && <GutterCell line={l} gutter={gutter} selected={sel.selected} />}
            <td className={NUM}>{l.oldNo ?? ''}</td>
            <td className={NUM}>{l.newNo ?? ''}</td>
            <Sign kind={l.kind} />
            <LineText line={l} tokens={deco.tokens[j]} marks={deco.marks[j]} wrap={wrap} />
          </tr>
        )
      })}
    </tbody>
  )
}

/** One side (number, sign, text) of a side-by-side row; empty when the side has no line. */
function Half({
  file,
  deco,
  j,
  side,
  wrap,
  sel,
  gutter
}: {
  file: DiffFile
  deco: Decorated
  j: number | undefined
  side: 'left' | 'right'
  wrap: boolean
  sel?: DiffSelection
  gutter: Gutter | null
}) {
  const edge = side === 'right' && 'border-l border-line'
  if (j === undefined) {
    const empty = 'bg-panel-2/60'
    return (
      <>
        {gutter && <td className={cx('w-5', empty, edge)} />}
        <td className={cx(NUM, empty, !gutter && edge)} />
        <td className={empty} />
        <td className={empty} />
      </>
    )
  }
  const l = file.lines[j]
  const tint = lineTint(l, l.change !== undefined && !!sel?.selected.has(l.change))
  return (
    <>
      {gutter && sel && (
        <GutterCell line={l} gutter={gutter} selected={sel.selected} className={cx(tint, edge)} />
      )}
      <td className={cx(NUM, tint, !gutter && edge)}>
        {side === 'left' ? (l.oldNo ?? '') : (l.newNo ?? '')}
      </td>
      <Sign kind={l.kind} className={tint} />
      <LineText
        line={l}
        tokens={deco.tokens[j]}
        marks={deco.marks[j]}
        wrap={wrap}
        className={tint}
      />
    </>
  )
}

function SplitBody({
  file,
  deco,
  wrap,
  sel,
  gutter
}: {
  file: DiffFile
  deco: Decorated
  wrap: boolean
  sel?: DiffSelection
  gutter: Gutter | null
}) {
  const rows = useMemo(() => splitRows(file.lines), [file])
  const cols = gutter ? 8 : 6
  return (
    <tbody>
      {rows.map((r, i) => {
        if (r.full === undefined) {
          return (
            <tr key={i}>
              <Half
                file={file}
                deco={deco}
                j={r.left}
                side="left"
                wrap={wrap}
                sel={sel}
                gutter={gutter}
              />
              <Half
                file={file}
                deco={deco}
                j={r.right}
                side="right"
                wrap={wrap}
                sel={sel}
                gutter={gutter}
              />
            </tr>
          )
        }
        const l = file.lines[r.full]
        if (l.kind === 'hunk' && (sel || gutter)) {
          return (
            <HunkRow
              key={i}
              line={l}
              hunk={file.hunks[l.hunk ?? -1]}
              span={cols - (gutter ? 1 : 0)}
              sel={sel}
              gutter={gutter}
            />
          )
        }
        return (
          <tr key={i} className={ROW_TINT[l.kind]}>
            <td colSpan={cols} className="px-3 whitespace-pre-wrap select-text">
              {l.text}
            </td>
          </tr>
        )
      })}
    </tbody>
  )
}

const FileDiff = memo(function FileDiff({
  file,
  wrap,
  wordMarks,
  layout,
  sel
}: {
  file: DiffFile
  wrap: boolean
  wordMarks: boolean
  layout: DiffLayout
  sel?: DiffSelection
}) {
  const deco = useDecorations(file, wordMarks)
  const order = useMemo(() => file.hunks.flatMap((h) => h.changes), [file])
  const gutter = useGutter(sel, order)
  const lang = langFromPath(file.path)
  const split = layout === 'split'
  return (
    <div className="border-b border-line" data-diff-layout={layout}>
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-panel-2 px-3 py-1.5">
        <span className="mono font-medium">{file.title}</span>
        {lang && <span className="rounded bg-line px-1.5 text-[10px] text-faint">{lang}</span>}
      </div>
      {file.binary && <div className="px-3 py-2 text-muted">Binary file</div>}
      <table
        className={cx(
          'mono border-collapse leading-[19px]',
          wrap ? 'w-full' : 'w-max min-w-full',
          split && wrap && 'table-fixed'
        )}
      >
        {split && wrap && (
          <colgroup>
            {gutter && <col className="w-5" />}
            <col className="w-10" />
            <col className="w-4" />
            <col />
            {gutter && <col className="w-5" />}
            <col className="w-10" />
            <col className="w-4" />
            <col />
          </colgroup>
        )}
        {split ? (
          <SplitBody file={file} deco={deco} wrap={wrap} sel={sel} gutter={gutter} />
        ) : (
          <UnifiedBody file={file} deco={deco} wrap={wrap} sel={sel} gutter={gutter} />
        )}
      </table>
    </div>
  )
})

export function DiffView({
  patch,
  loading,
  layout,
  selection,
  empty = 'No changes to show'
}: {
  patch: string
  loading?: boolean
  /** Overrides the View setting (e.g. to force a unified diff in a narrow pane). */
  layout?: DiffLayout
  /** Enables line selection (applies to the first file shown). */
  selection?: DiffSelection
  empty?: ReactNode
}) {
  const { files, truncated } = useMemo(() => parsePatch(patch), [patch])
  const wrap = useViewSettings((s) => s.wrap)
  const wordMarks = useViewSettings((s) => s.wordDiff)
  const preferred = useViewSettings((s) => s.diffLayout)
  if (loading) {
    return (
      <Empty>
        <Spinner />
      </Empty>
    )
  }
  if (!files.length) return <Empty>{empty}</Empty>
  return (
    <div className="h-full overflow-auto bg-bg">
      {files.map((f, i) => (
        <FileDiff
          key={`${i}:${f.title}`}
          file={f}
          wrap={wrap}
          wordMarks={wordMarks}
          layout={layout ?? preferred}
          sel={i === 0 && !truncated ? selection : undefined}
        />
      ))}
      {truncated && <div className="p-3 text-warn">Diff truncated (too large to display)</div>}
    </div>
  )
}

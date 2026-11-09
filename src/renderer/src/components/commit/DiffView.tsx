import { memo, useMemo } from 'react'
import { cx } from '../../lib/format'
import { langFromPath, useTokenizer, type ThemedToken } from '../../lib/highlight'
import { pairRuns, parsePatch, splitRows, type DiffFile, type DiffLine } from '../../lib/patch'
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

const ROW_TINT: Partial<Record<DiffLine['kind'], string>> = {
  add: 'bg-ok/[0.08]',
  del: 'bg-bad/[0.08]',
  hunk: 'bg-accent/[0.07] text-accent/80',
  meta: 'text-faint'
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

function UnifiedBody({ file, deco, wrap }: { file: DiffFile; deco: Decorated; wrap: boolean }) {
  return (
    <tbody>
      {file.lines.map((l, j) => (
        <tr key={j} className={ROW_TINT[l.kind]}>
          <td className={NUM}>{l.oldNo ?? ''}</td>
          <td className={NUM}>{l.newNo ?? ''}</td>
          <Sign kind={l.kind} />
          <LineText line={l} tokens={deco.tokens[j]} marks={deco.marks[j]} wrap={wrap} />
        </tr>
      ))}
    </tbody>
  )
}

/** One side (number, sign, text) of a side-by-side row; empty when the side has no line. */
function Half({
  file,
  deco,
  j,
  side,
  wrap
}: {
  file: DiffFile
  deco: Decorated
  j: number | undefined
  side: 'left' | 'right'
  wrap: boolean
}) {
  if (j === undefined) {
    const empty = 'bg-panel-2/60'
    return (
      <>
        <td className={cx(NUM, empty, side === 'right' && 'border-l border-line')} />
        <td className={empty} />
        <td className={empty} />
      </>
    )
  }
  const l = file.lines[j]
  const tint = l.kind === 'add' ? 'bg-ok/[0.08]' : l.kind === 'del' ? 'bg-bad/[0.08]' : ''
  return (
    <>
      <td className={cx(NUM, tint, side === 'right' && 'border-l border-line')}>
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

function SplitBody({ file, deco, wrap }: { file: DiffFile; deco: Decorated; wrap: boolean }) {
  const rows = useMemo(() => splitRows(file.lines), [file])
  return (
    <tbody>
      {rows.map((r, i) =>
        r.full !== undefined ? (
          <tr key={i} className={ROW_TINT[file.lines[r.full].kind]}>
            <td colSpan={6} className="px-3 whitespace-pre-wrap select-text">
              {file.lines[r.full].text}
            </td>
          </tr>
        ) : (
          <tr key={i}>
            <Half file={file} deco={deco} j={r.left} side="left" wrap={wrap} />
            <Half file={file} deco={deco} j={r.right} side="right" wrap={wrap} />
          </tr>
        )
      )}
    </tbody>
  )
}

const FileDiff = memo(function FileDiff({
  file,
  wrap,
  wordMarks,
  layout
}: {
  file: DiffFile
  wrap: boolean
  wordMarks: boolean
  layout: DiffLayout
}) {
  const deco = useDecorations(file, wordMarks)
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
            <col className="w-10" />
            <col className="w-4" />
            <col />
            <col className="w-10" />
            <col className="w-4" />
            <col />
          </colgroup>
        )}
        {split ? (
          <SplitBody file={file} deco={deco} wrap={wrap} />
        ) : (
          <UnifiedBody file={file} deco={deco} wrap={wrap} />
        )}
      </table>
    </div>
  )
})

export function DiffView({
  patch,
  loading,
  layout
}: {
  patch: string
  loading?: boolean
  /** Overrides the View setting (e.g. to force a unified diff in a narrow pane). */
  layout?: DiffLayout
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
  if (!files.length) return <Empty>No changes to show</Empty>
  return (
    <div className="h-full overflow-auto bg-bg">
      {files.map((f, i) => (
        <FileDiff
          key={`${i}:${f.title}`}
          file={f}
          wrap={wrap}
          wordMarks={wordMarks}
          layout={layout ?? preferred}
        />
      ))}
      {truncated && <div className="p-3 text-warn">Diff truncated (too large to display)</div>}
    </div>
  )
}

import { memo, useMemo } from 'react'
import { cx } from '../../lib/format'
import { langFromPath, useTokenizer, type ThemedToken } from '../../lib/highlight'
import { parsePatch, type DiffFile } from '../../lib/patch'
import { useViewSettings } from '../../lib/settings'
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
      // Pair each run of removed lines with the run of added lines right after it.
      let k = 0
      while (k < file.lines.length) {
        if (file.lines[k].kind !== 'del') {
          k++
          continue
        }
        const delStart = k
        while (k < file.lines.length && file.lines[k].kind === 'del') k++
        const addStart = k
        while (k < file.lines.length && file.lines[k].kind === 'add') k++
        const pairs = Math.min(addStart - delStart, k - addStart)
        for (let p = 0; p < pairs; p++) {
          const d = wordDiff(file.lines[delStart + p].text, file.lines[addStart + p].text)
          if (d) {
            marks[delStart + p] = d.a
            marks[addStart + p] = d.b
          }
        }
      }
    }
    return { tokens, marks }
  }, [file, tokenize, wordMarks])
}

const FileDiff = memo(function FileDiff({
  file,
  wrap,
  wordMarks
}: {
  file: DiffFile
  wrap: boolean
  wordMarks: boolean
}) {
  const { tokens, marks } = useDecorations(file, wordMarks)
  const lang = langFromPath(file.path)
  return (
    <div className="border-b border-line">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-panel-2 px-3 py-1.5">
        <span className="mono font-medium">{file.title}</span>
        {lang && <span className="rounded bg-line px-1.5 text-[10px] text-faint">{lang}</span>}
      </div>
      {file.binary && <div className="px-3 py-2 text-muted">Binary file</div>}
      <table
        className={cx('mono border-collapse leading-[19px]', wrap ? 'w-full' : 'w-max min-w-full')}
      >
        <tbody>
          {file.lines.map((l, j) => (
            <tr
              key={j}
              className={cx(
                l.kind === 'add' && 'bg-ok/[0.08]',
                l.kind === 'del' && 'bg-bad/[0.08]',
                l.kind === 'hunk' && 'bg-accent/[0.07] text-accent/80',
                l.kind === 'meta' && 'text-faint'
              )}
            >
              <td className="w-10 pr-2 text-right align-top text-faint/70 select-none">
                {l.oldNo ?? ''}
              </td>
              <td className="w-10 pr-2 text-right align-top text-faint/70 select-none">
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
              <td
                className={cx(
                  'pr-4 select-text',
                  wrap ? 'break-all whitespace-pre-wrap' : 'whitespace-pre'
                )}
              >
                {l.kind === 'add' || l.kind === 'del' || l.kind === 'ctx' ? (
                  <TokenLine
                    text={l.text}
                    tokens={tokens[j]}
                    marks={marks[j]}
                    markClass={
                      l.kind === 'add' ? 'rounded-[2px] bg-ok/30' : 'rounded-[2px] bg-bad/30'
                    }
                  />
                ) : (
                  l.text
                )}
                {l.text === '' ? ' ' : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
})

export function DiffView({ patch, loading }: { patch: string; loading?: boolean }) {
  const { files, truncated } = useMemo(() => parsePatch(patch), [patch])
  const wrap = useViewSettings((s) => s.wrap)
  const wordMarks = useViewSettings((s) => s.wordDiff)
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
        <FileDiff key={`${i}:${f.title}`} file={f} wrap={wrap} wordMarks={wordMarks} />
      ))}
      {truncated && <div className="p-3 text-warn">Diff truncated (too large to display)</div>}
    </div>
  )
}

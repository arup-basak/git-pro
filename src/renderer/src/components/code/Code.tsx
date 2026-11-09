import { useMemo, useRef, type CSSProperties, type ReactNode } from 'react'
import { cx } from '../../lib/format'
import { useTokens, type ThemedToken } from '../../lib/highlight'
import type { Range } from '../../lib/wordDiff'

function tokenStyle(t: ThemedToken): CSSProperties | undefined {
  if (!t.color && !t.fontStyle) return undefined
  const fs = t.fontStyle ?? 0
  return {
    color: t.color,
    fontStyle: fs & 1 ? 'italic' : undefined,
    fontWeight: fs & 2 ? 600 : undefined,
    textDecoration: fs & 4 ? 'underline' : fs & 8 ? 'line-through' : undefined
  }
}

/**
 * One line of code: syntax-coloured tokens, optionally overlaid with "changed" ranges
 * (word-level diff marks).
 */
export function TokenLine({
  text,
  tokens,
  marks,
  markClass
}: {
  text: string
  tokens?: ThemedToken[] | null
  marks?: Range[] | null
  markClass?: string
}): ReactNode {
  const usable = tokens && tokens.reduce((n, t) => n + t.content.length, 0) === text.length
  if (!usable && !marks?.length) return text
  const segs: Array<Pick<ThemedToken, 'content'> & Partial<ThemedToken>> = usable
    ? tokens!
    : [{ content: text }]
  const out: ReactNode[] = []
  let pos = 0
  let mi = 0
  let key = 0
  for (const t of segs) {
    let s = 0
    while (s < t.content.length) {
      const abs = pos + s
      while (marks && mi < marks.length && marks[mi][1] <= abs) mi++
      const m = marks?.[mi]
      const inMark = !!m && m[0] <= abs
      const boundary = inMark ? m![1] : m ? m[0] : Infinity
      const end = Math.min(t.content.length, boundary - pos)
      out.push(
        <span
          key={key++}
          style={tokenStyle(t as ThemedToken)}
          className={inMark ? markClass : undefined}
        >
          {t.content.slice(s, end)}
        </span>
      )
      s = end
    }
    pos += t.content.length
  }
  return out
}

function splitLines(text: string): string[] {
  const lines = text.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Read-only highlighted code with optional line numbers. */
export function CodeView({
  text,
  lang,
  lineNumbers,
  startLine = 1,
  className,
  dim
}: {
  text: string
  lang: string | null
  lineNumbers?: boolean
  startLine?: number
  className?: string
  dim?: boolean
}) {
  const tokens = useTokens(text, lang)
  const lines = useMemo(() => splitLines(text), [text])
  return (
    <div
      className={cx(
        'mono min-w-fit py-1 leading-[19px] select-text',
        dim && 'opacity-60',
        className
      )}
    >
      {lines.map((l, i) => (
        <div key={i} className="flex">
          {lineNumbers && (
            <span className="sticky left-0 w-12 shrink-0 bg-inherit pr-3 text-right text-faint select-none">
              {startLine + i}
            </span>
          )}
          <span className={cx('whitespace-pre', !lineNumbers && 'px-3')}>
            <TokenLine text={l} tokens={tokens?.[i]} />
            {l === '' ? ' ' : null}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * Editable code with live syntax highlighting: a transparent textarea layered over a
 * highlighted <pre> with identical metrics (no wrapping, synchronized scrolling).
 */
export function CodeEditor({
  value,
  onChange,
  lang,
  rows,
  className,
  autoFocus
}: {
  value: string
  onChange: (v: string) => void
  lang: string | null
  rows?: number
  className?: string
  autoFocus?: boolean
}) {
  const tokens = useTokens(value, lang)
  const pre = useRef<HTMLPreElement>(null)
  const lines = value.split('\n')
  return (
    <div className={cx('relative bg-bg', className)}>
      <pre
        ref={pre}
        aria-hidden
        className="mono pointer-events-none absolute inset-0 m-0 overflow-hidden px-3 py-1 leading-[19px] whitespace-pre text-fg"
      >
        {lines.map((l, i) => (
          <div key={i}>
            <TokenLine text={l} tokens={tokens?.[i]} />
            {l === '' ? ' ' : null}
          </div>
        ))}
      </pre>
      <textarea
        value={value}
        rows={rows}
        autoFocus={autoFocus}
        wrap="off"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        className="mono relative block h-full w-full resize-y overflow-auto border-0 bg-transparent px-3 py-1 leading-[19px] whitespace-pre text-transparent caret-fg outline-none selection:bg-accent/30"
        style={{ WebkitTextFillColor: 'transparent' }}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (pre.current) {
            pre.current.scrollTop = e.currentTarget.scrollTop
            pre.current.scrollLeft = e.currentTarget.scrollLeft
          }
        }}
        onKeyDown={(e) => {
          // Tab inserts two spaces instead of moving focus.
          if (e.key === 'Tab' && !e.shiftKey) {
            e.preventDefault()
            const el = e.currentTarget
            const { selectionStart: s, selectionEnd: t } = el
            const next = value.slice(0, s) + '  ' + value.slice(t)
            onChange(next)
            requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2))
          }
        }}
      />
    </div>
  )
}

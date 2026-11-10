import '@xterm/xterm/css/xterm.css'
import { ChevronDown, Eraser, Plus, SquareTerminal, X } from 'lucide-react'
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { cx } from '../../lib/format'
import { useUi } from '../../lib/store'
import {
  MIN_TERMINAL_HEIGHT,
  attachTerminal,
  clearTerminal,
  closeTerminal,
  newTerminal,
  selectTerminal,
  setTerminalHeight,
  toggleTerminal,
  useTerminals
} from '../../lib/terminal'
import { Button } from '../ui'

const iconBtn = 'rounded p-1 text-muted hover:bg-hover hover:text-fg'

/** Shows one terminal tab; the xterm element is moved in on mount and out on unmount. */
function TerminalView({ id }: { id: string }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => (host.current ? attachTerminal(id, host.current) : undefined), [id])
  return <div ref={host} className="absolute inset-0 py-1 pl-3" />
}

/** Drag the panel's top edge to resize it. */
function ResizeHandle() {
  const start = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const y0 = e.clientY
    const h0 = useTerminals.getState().height
    const max = (): number => Math.max(MIN_TERMINAL_HEIGHT, window.innerHeight - 220)
    const move = (ev: PointerEvent): void =>
      setTerminalHeight(Math.min(max(), Math.max(MIN_TERMINAL_HEIGHT, h0 + y0 - ev.clientY)))
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize terminal"
      onPointerDown={start}
      className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize"
    />
  )
}

/** Bottom panel with the repository's terminals (View → Terminal, ⌃`). */
export function TerminalPanel() {
  const repoId = useUi((s) => s.repo?.id)
  const open = useTerminals((s) => s.open)
  const height = useTerminals((s) => s.height)
  const allTabs = useTerminals((s) => s.tabs)
  const active = useTerminals((s) => (repoId ? s.active[repoId] : undefined))
  if (!open || !repoId) return null
  const tabs = allTabs.filter((t) => t.repoId === repoId)
  const current = tabs.find((t) => t.id === active) ?? tabs[tabs.length - 1]

  return (
    <section
      aria-label="Terminal"
      style={{ height: Math.min(height, Math.max(MIN_TERMINAL_HEIGHT, window.innerHeight - 220)) }}
      className="relative flex shrink-0 flex-col border-t border-line-strong bg-bg"
    >
      <ResizeHandle />
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line bg-panel pr-1.5 pl-2 text-xs">
        <div role="tablist" className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
          {tabs.map((t) => (
            <div
              key={t.id}
              role="tab"
              aria-selected={t.id === current?.id}
              title={t.exited != null ? `${t.title} — exited with code ${t.exited}` : t.title}
              onMouseDown={(e) => {
                // Middle-click closes, as in most terminals and browsers.
                if (e.button === 1) {
                  e.preventDefault()
                  closeTerminal(t.id)
                }
              }}
              onClick={() => selectTerminal(repoId, t.id)}
              className={cx(
                'group flex h-6 shrink-0 cursor-default items-center gap-1.5 rounded pr-1 pl-2',
                t.id === current?.id ? 'bg-line-strong text-fg' : 'text-muted hover:bg-hover'
              )}
            >
              <SquareTerminal size={12} className={t.exited != null ? 'text-bad' : 'text-faint'} />
              <span className="max-w-[160px] truncate">{t.title}</span>
              <button
                type="button"
                aria-label={`Close ${t.title}`}
                title="Close terminal"
                onClick={(e) => {
                  e.stopPropagation()
                  closeTerminal(t.id)
                }}
                className={cx(
                  'rounded p-0.5 hover:bg-hover hover:text-fg',
                  t.id === current?.id ? 'text-muted' : 'opacity-0 group-hover:opacity-100'
                )}
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          title="New terminal"
          aria-label="New terminal"
          className={iconBtn}
          onClick={() => void newTerminal(repoId)}
        >
          <Plus size={13} />
        </button>
        <div className="flex-1" />
        {current && (
          <button
            type="button"
            title="Clear"
            aria-label="Clear terminal"
            className={iconBtn}
            onClick={() => clearTerminal(current.id)}
          >
            <Eraser size={12} />
          </button>
        )}
        <button
          type="button"
          title="Hide terminal (⌃`)"
          aria-label="Hide terminal"
          className={iconBtn}
          onClick={() => toggleTerminal(repoId, false)}
        >
          <ChevronDown size={13} />
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        {current ? (
          <TerminalView key={current.id} id={current.id} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Button
              size="sm"
              icon={<SquareTerminal size={12} />}
              onClick={() => void newTerminal(repoId)}
            >
              New terminal
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}

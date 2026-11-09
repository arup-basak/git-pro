import { formatCommand } from '@shared/push'
import { Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cx } from '../../lib/format'
import { useUi } from '../../lib/store'

const READ_ONLY = new Set([
  'log',
  'rev-parse',
  'status',
  'for-each-ref',
  'cat-file',
  'diff',
  'show-ref',
  'symbolic-ref',
  'config',
  'remote',
  'rev-list',
  'merge-base',
  'reflog',
  'hash-object',
  'ls-tree',
  'check-ref-format',
  'diff-tree',
  'merge-tree',
  'write-tree',
  'stash list',
  '--version'
])

function subcommand(args: string[]): string {
  const i = args.findIndex((a) => !a.startsWith('-') && !a.includes('='))
  return args[i] === 'stash' ? `stash ${args[i + 1] ?? ''}` : (args[i] ?? '')
}

export function CommandLog() {
  const ui = useUi()
  const [writesOnly, setWritesOnly] = useState(true)
  const [open, setOpen] = useState<number | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const entries = ui.commands.filter(
    (c) => !writesOnly || !READ_ONLY.has(subcommand(c.args).trim()) || c.code !== 0
  )
  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [entries.length])
  if (!ui.logOpen) return null
  return (
    <div className="flex h-56 shrink-0 flex-col border-t border-line-strong bg-panel">
      <div className="flex h-8 shrink-0 items-center gap-3 border-b border-line px-3 text-xs">
        <span className="font-semibold">Command log</span>
        <label className="flex items-center gap-1.5 text-muted">
          <input
            type="checkbox"
            className="accent-accent-strong"
            checked={writesOnly}
            onChange={(e) => setWritesOnly(e.target.checked)}
          />
          Changes &amp; errors only
        </label>
        <div className="flex-1" />
        <button
          className="rounded p-1 text-muted hover:bg-hover hover:text-fg"
          onClick={ui.clearCommands}
          title="Clear"
        >
          <Trash2 size={12} />
        </button>
        <button
          className="rounded p-1 text-muted hover:bg-hover hover:text-fg"
          onClick={() => ui.toggleLog(false)}
          title="Close"
        >
          <X size={12} />
        </button>
      </div>
      <div className="mono min-h-0 flex-1 overflow-auto py-1">
        {entries.map((c) => (
          <div key={c.id}>
            <div
              onClick={() => setOpen(open === c.id ? null : c.id)}
              className="flex cursor-default items-center gap-3 px-3 py-0.5 hover:bg-hover"
            >
              <span className="w-16 shrink-0 text-faint">
                {new Date(c.startedAt).toLocaleTimeString()}
              </span>
              <span
                className={cx('w-6 shrink-0 text-right', c.code === 0 ? 'text-ok' : 'text-bad')}
              >
                {c.code ?? '—'}
              </span>
              <span className="min-w-0 flex-1 truncate select-text">{formatCommand(c.args)}</span>
              <span className="shrink-0 text-faint">{c.durationMs}ms</span>
            </div>
            {open === c.id && (
              <pre className="mx-3 mb-1 max-h-40 overflow-auto rounded border border-line bg-bg px-2 py-1 whitespace-pre-wrap text-muted select-text">
                {[c.stdout && `stdout:\n${c.stdout}`, c.stderr && `stderr:\n${c.stderr}`]
                  .filter(Boolean)
                  .join('\n\n') || '(no output)'}
              </pre>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  )
}

export function StatusBar() {
  const ui = useUi()
  const last = ui.commands[ui.commands.length - 1]
  return (
    <div className="flex h-6 shrink-0 items-center gap-3 border-t border-line bg-panel px-3 text-[11px] text-faint">
      <span className="mono truncate">{ui.repo?.path}</span>
      <div className="flex-1" />
      {ui.progress ? (
        <span className="mono truncate text-accent">{ui.progress}</span>
      ) : last ? (
        <button className="mono truncate hover:text-fg" onClick={() => ui.toggleLog(true)}>
          {last.code === 0 ? '✓' : '✗'} git {subcommand(last.args)}
        </button>
      ) : null}
    </div>
  )
}

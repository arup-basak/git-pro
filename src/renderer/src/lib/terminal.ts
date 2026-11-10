import { FitAddon } from '@xterm/addon-fit'
import { Terminal, type ITheme } from '@xterm/xterm'
import { toast } from 'sonner'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { call } from './api'

/**
 * In-app terminals. Shells run in the main process (node-pty); each tab here owns one xterm.js
 * instance that lives outside React, so switching tabs, views or repositories never loses
 * scrollback. Tabs belong to the repository they were opened in.
 */

export interface TerminalTab {
  id: string
  repoId: string
  title: string
  /** Exit code once the shell has ended with an error (the tab stays open to show why). */
  exited: number | null
}

interface TerminalState {
  open: boolean
  height: number
  tabs: TerminalTab[]
  /** repoId → active tab id */
  active: Record<string, string>
}

export const MIN_TERMINAL_HEIGHT = 120

export const useTerminals = create<TerminalState>()(
  persist((): TerminalState => ({ open: false, height: 260, tabs: [], active: {} }), {
    name: 'gitpro.terminal',
    storage: createJSONStorage(() => window.localStorage),
    partialize: ({ height }) => ({ height })
  })
)

const THEME: ITheme = {
  background: '#0b0d10',
  foreground: '#d8dde5',
  cursor: '#6ea8fe',
  cursorAccent: '#0b0d10',
  selectionBackground: '#2b4d80',
  black: '#1c212a',
  red: '#f2665b',
  green: '#4cc38a',
  yellow: '#f0b429',
  blue: '#6ea8fe',
  magenta: '#c49bf5',
  cyan: '#5ccfe6',
  white: '#d8dde5',
  brightBlack: '#5d6574',
  brightRed: '#ff8f85',
  brightGreen: '#72dba8',
  brightYellow: '#ffcd5c',
  brightBlue: '#94c0ff',
  brightMagenta: '#d9bbff',
  brightCyan: '#8ee2f2',
  brightWhite: '#ffffff'
}

interface Instance {
  term: Terminal
  fit: FitAddon
  /** xterm renders into this element; it is moved into whichever panel shows the tab. */
  el: HTMLDivElement
  opened: boolean
}

const instances = new Map<string, Instance>()
/** Output that arrived before its tab finished registering. */
const early = new Map<string, string>()
let listening = false

function listen(): void {
  if (listening) return
  listening = true
  window.gitPro.on((ev) => {
    if (ev.type === 'terminal-data') {
      const inst = instances.get(ev.id)
      if (inst) inst.term.write(ev.data)
      else early.set(ev.id, (early.get(ev.id) ?? '') + ev.data)
    } else if (ev.type === 'terminal-exit') {
      onExit(ev.id, ev.exitCode)
    }
  })
}

function onExit(id: string, exitCode: number): void {
  const tab = useTerminals.getState().tabs.find((t) => t.id === id)
  if (!tab) return
  // A clean `exit` closes the tab, like most terminals; errors stay visible.
  if (exitCode === 0) return void closeTerminal(id, false)
  instances
    .get(id)
    ?.term.write(
      `\r\n\x1b[2m[process exited with code ${exitCode} — press any key to close]\x1b[0m`
    )
  useTerminals.setState((s) => ({
    tabs: s.tabs.map((t) => (t.id === id ? { ...t, exited: exitCode } : t))
  }))
}

function makeInstance(id: string): Instance {
  const term = new Terminal({
    fontFamily: "'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, monospace",
    fontSize: 12,
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 10_000,
    allowTransparency: false,
    theme: THEME
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  const el = document.createElement('div')
  el.style.width = '100%'
  el.style.height = '100%'
  term.onData((data) => {
    if (useTerminals.getState().tabs.find((t) => t.id === id)?.exited != null)
      return void closeTerminal(id, false)
    void call('terminal.write', id, data).catch(() => {})
  })
  term.onResize(({ cols, rows }) => void call('terminal.resize', id, cols, rows).catch(() => {}))
  return { term, fit, el, opened: false }
}

/** Starts a shell in the repository and shows it. */
export async function newTerminal(repoId: string): Promise<void> {
  listen()
  try {
    const info = await call('terminal.create', repoId, 100, 24)
    const inst = makeInstance(info.id)
    instances.set(info.id, inst)
    const pending = early.get(info.id)
    if (pending) {
      inst.term.write(pending)
      early.delete(info.id)
    }
    useTerminals.setState((s) => {
      const same = s.tabs.filter((t) => t.repoId === repoId && t.title.startsWith(info.shell))
      const title = same.length ? `${info.shell} ${same.length + 1}` : info.shell
      return {
        open: true,
        tabs: [...s.tabs, { id: info.id, repoId, title, exited: null }],
        active: { ...s.active, [repoId]: info.id }
      }
    })
  } catch (e) {
    toast.error('Could not start a terminal', { description: (e as Error).message })
  }
}

/** Ends the shell (unless it already exited) and removes its tab. */
export function closeTerminal(id: string, kill = true): void {
  if (kill) void call('terminal.kill', id).catch(() => {})
  const inst = instances.get(id)
  instances.delete(id)
  early.delete(id)
  inst?.term.dispose()
  inst?.el.remove()
  useTerminals.setState((s) => {
    const tab = s.tabs.find((t) => t.id === id)
    const tabs = s.tabs.filter((t) => t.id !== id)
    if (!tab) return { tabs }
    const left = tabs.filter((t) => t.repoId === tab.repoId)
    const active = { ...s.active }
    if (active[tab.repoId] === id) {
      if (left.length) active[tab.repoId] = left[left.length - 1].id
      else delete active[tab.repoId]
    }
    return { tabs, active, open: left.length > 0 ? s.open : false }
  })
}

export function selectTerminal(repoId: string, id: string): void {
  useTerminals.setState((s) => ({ active: { ...s.active, [repoId]: id } }))
}

/** Shows or hides the panel; opening it with no shell for this repository starts one. */
export function toggleTerminal(repoId: string, open?: boolean): void {
  const s = useTerminals.getState()
  const next = open ?? !s.open
  if (next && !s.tabs.some((t) => t.repoId === repoId)) return void newTerminal(repoId)
  useTerminals.setState({ open: next })
}

export function setTerminalHeight(height: number): void {
  useTerminals.setState({ height: Math.round(height) })
}

/** Mounts tab `id` into `host` (moving it from wherever it was) and keeps it sized to fit. */
export function attachTerminal(id: string, host: HTMLElement): () => void {
  const inst = instances.get(id)
  if (!inst) return () => {}
  host.appendChild(inst.el)
  if (!inst.opened) {
    // xterm measures the font on open, so the element must already be in the page.
    inst.term.open(inst.el)
    inst.opened = true
  }
  let frame = 0
  const fit = (): void => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      if (host.clientWidth > 0 && host.clientHeight > 0) inst.fit.fit()
    })
  }
  fit()
  inst.term.focus()
  const ro = new ResizeObserver(fit)
  ro.observe(host)
  return () => {
    cancelAnimationFrame(frame)
    ro.disconnect()
    if (inst.el.parentElement === host) inst.el.remove()
  }
}

/** Clears the scrollback (⌘K belongs to Commit in the app menu). */
export function clearTerminal(id: string): void {
  const inst = instances.get(id)
  inst?.term.clear()
  inst?.term.focus()
}

import { accessSync, chmodSync, constants, existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { IPty } from 'node-pty'
import type { AppEvent, TerminalInfo } from '../shared/types'

/**
 * Interactive shells for the in-app terminal. Each runs the user's own login shell in an open
 * repository; output is streamed to the renderer as `terminal-data` events.
 */

interface Session {
  pty: IPty
  /** Output not yet sent; flushed every few ms so heavy output doesn't flood IPC. */
  pending: string
  timer: NodeJS.Timeout | null
}

const sessions = new Map<string, Session>()
let nextId = 1
let send: (event: AppEvent) => void = () => {}
let ptyModule: typeof import('node-pty') | null = null

export function setTerminalSink(sink: (event: AppEvent) => void): void {
  send = sink
}

function defaultShell(): { file: string; args: string[] } {
  if (process.platform === 'win32')
    return {
      file: process.env.COMSPEC?.toLowerCase().includes('powershell')
        ? process.env.COMSPEC
        : 'powershell.exe',
      args: []
    }
  const file = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  // A login shell reads the user's profile, like a new Terminal.app window.
  return { file, args: ['-l'] }
}

function shellEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    // Don't leak Electron's own switches (e.g. ELECTRON_RUN_AS_NODE) into the user's commands.
    if (v !== undefined && !k.startsWith('ELECTRON_')) env[k] = v
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'GitPro'
  // Apps started from Finder have no locale, which breaks UTF-8 in many CLIs.
  if (!env.LANG && process.platform !== 'win32') env.LANG = 'en_US.UTF-8'
  return env
}

/**
 * node-pty spawns shells through a small `spawn-helper` binary, and npm can install it without
 * its executable bit (install scripts are not always run). Restore it before the first spawn.
 */
function ensureSpawnHelper(): void {
  if (process.platform === 'win32') return
  let root: string
  try {
    root = dirname(require.resolve('node-pty/package.json')).replace(
      'app.asar',
      'app.asar.unpacked'
    )
  } catch {
    return
  }
  for (const dir of ['build/Release', `prebuilds/${process.platform}-${process.arch}`]) {
    const helper = join(root, dir, 'spawn-helper')
    if (!existsSync(helper)) continue
    try {
      accessSync(helper, constants.X_OK)
    } catch {
      try {
        chmodSync(helper, 0o755)
      } catch {
        // read-only install; spawning will report the real error
      }
    }
  }
}

function loadPty(): typeof import('node-pty') {
  if (!ptyModule) {
    ensureSpawnHelper()
    // Loaded lazily so a broken native module only disables the terminal, not the app.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ptyModule = require('node-pty') as typeof import('node-pty')
  }
  return ptyModule
}

function flush(id: string): void {
  const s = sessions.get(id)
  if (!s) return
  s.timer = null
  if (!s.pending) return
  const data = s.pending
  s.pending = ''
  send({ type: 'terminal-data', id, data })
}

const clampSize = (n: number, max: number): number =>
  Number.isFinite(n) ? Math.max(2, Math.min(max, Math.floor(n))) : 80

export function createTerminal(cwd: string, cols: number, rows: number): TerminalInfo {
  const { file, args } = defaultShell()
  const pty = loadPty().spawn(file, args, {
    name: 'xterm-256color',
    cols: clampSize(cols, 1000),
    rows: clampSize(rows, 500),
    cwd,
    env: shellEnv()
  })
  const id = String(nextId++)
  const session: Session = { pty, pending: '', timer: null }
  sessions.set(id, session)
  pty.onData((data) => {
    session.pending += data
    session.timer ??= setTimeout(() => flush(id), 4)
  })
  pty.onExit(({ exitCode }) => {
    flush(id)
    if (session.timer) clearTimeout(session.timer)
    sessions.delete(id)
    send({ type: 'terminal-exit', id, exitCode })
  })
  return { id, shell: basename(file), cwd }
}

function session(id: string): Session {
  const s = sessions.get(id)
  if (!s) throw new Error('This terminal has exited')
  return s
}

export function writeTerminal(id: string, data: string): void {
  if (typeof data !== 'string') return
  session(id).pty.write(data)
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  const s = sessions.get(id)
  // Resizes race with exit; ignore unknown ids.
  if (s) s.pty.resize(clampSize(cols, 1000), clampSize(rows, 500))
}

export function killTerminal(id: string): void {
  const s = sessions.get(id)
  if (!s) return
  sessions.delete(id)
  if (s.timer) clearTimeout(s.timer)
  try {
    s.pty.kill()
  } catch {
    // already gone
  }
}

/** Ends every shell (window closed / app quitting). */
export function killAllTerminals(): void {
  for (const id of [...sessions.keys()]) killTerminal(id)
}

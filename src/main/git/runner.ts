import { spawn } from 'node:child_process'
import type { CommandLogEntry } from '../../shared/types'

export interface RunOptions {
  env?: Record<string, string>
  input?: string | Buffer
  /** Serialize with other writes on the same repo (avoids index.lock races). */
  write?: boolean
  /** Do not throw on a non-zero exit code. */
  allowFail?: boolean
  /** Receives stderr progress lines (split on \r and \n). */
  onProgress?: (line: string) => void
  /** Do not record stdout in the command log (large outputs such as diffs and logs). */
  quietStdout?: boolean
}

export interface RunResult {
  code: number
  stdout: string
  stdoutBuf: Buffer
  stderr: string
}

export class GitError extends Error {
  constructor(
    message: string,
    readonly args: string[],
    readonly code: number | null,
    readonly stderr: string,
    readonly stdout: string
  ) {
    super(message)
    this.name = 'GitError'
  }
}

type LogSink = (entry: CommandLogEntry) => void

let logSink: LogSink | null = null
let nextId = 1
let gitBinary = 'git'
let baseEnv: NodeJS.ProcessEnv = process.env

export function setCommandLogSink(sink: LogSink | null): void {
  logSink = sink
}

export function configureGit(opts: { binary?: string; env?: NodeJS.ProcessEnv }): void {
  if (opts.binary) gitBinary = opts.binary
  if (opts.env) baseEnv = opts.env
}

const writeQueues = new Map<string, Promise<unknown>>()

function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeQueues.get(key) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  writeQueues.set(
    key,
    next.catch(() => undefined)
  )
  return next
}

const MAX_LOG = 20_000

function clip(s: string): string {
  return s.length > MAX_LOG ? s.slice(0, MAX_LOG) + `\n… (${s.length - MAX_LOG} more chars)` : s
}

/** Runs `git <args>` in `cwd` without a shell. */
export function git(cwd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const exec = (): Promise<RunResult> => spawnGit(cwd, args, opts)
  return opts.write ? serialize(cwd, exec) : exec()
}

function spawnGit(cwd: string, args: string[], opts: RunOptions): Promise<RunResult> {
  const fullArgs = ['-c', 'core.quotepath=false', '-c', 'color.ui=false', ...args]
  const env: Record<string, string> = {
    ...(baseEnv as Record<string, string>),
    GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat',
    LC_ALL: 'C',
    ...(opts.write ? {} : { GIT_OPTIONAL_LOCKS: '0' }),
    ...opts.env
  }
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const child = spawn(gitBinary, fullArgs, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    const err: Buffer[] = []
    let progressBuf = ''
    child.stdout.on('data', (b: Buffer) => out.push(b))
    child.stderr.on('data', (b: Buffer) => {
      err.push(b)
      if (opts.onProgress) {
        progressBuf += b.toString('utf8')
        const parts = progressBuf.split(/[\r\n]/)
        progressBuf = parts.pop() ?? ''
        for (const p of parts) if (p.trim()) opts.onProgress(p)
      }
    })
    child.on('error', (e) => {
      reject(new GitError(`Failed to run git: ${e.message}`, args, null, '', ''))
    })
    child.on('close', (code) => {
      const stdoutBuf = Buffer.concat(out)
      const stdout = stdoutBuf.toString('utf8')
      const stderr = Buffer.concat(err).toString('utf8')
      if (opts.onProgress && progressBuf.trim()) opts.onProgress(progressBuf)
      logSink?.({
        id: nextId++,
        repo: cwd,
        args,
        startedAt,
        durationMs: Date.now() - startedAt,
        code,
        stdout: opts.quietStdout ? `(${stdoutBuf.length} bytes)` : clip(stdout),
        stderr: clip(stderr)
      })
      const result: RunResult = { code: code ?? -1, stdout, stdoutBuf, stderr }
      if (code !== 0 && !opts.allowFail) {
        const firstLine =
          stderr
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
            .join('\n') || `git ${args[0]} exited with code ${code}`
        reject(new GitError(firstLine, args, code, stderr, stdout))
      } else {
        resolve(result)
      }
    })
    if (opts.input !== undefined) child.stdin.end(opts.input)
    else child.stdin.end()
  })
}

/** Convenience: stdout with the trailing newline removed. */
export async function gitOut(cwd: string, args: string[], opts: RunOptions = {}): Promise<string> {
  const r = await git(cwd, args, opts)
  return r.stdout.replace(/\n$/, '')
}

/** Shell-quotes a string for POSIX sh. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { git, gitOut } from './runner'

/** Rejects values that git could mistake for options. */
export function assertSafe(value: string, what: string): void {
  if (!value || value.startsWith('-') || /[\0\n]/.test(value)) {
    throw new Error(`Invalid ${what}: "${value}"`)
  }
}

export async function assertBranchName(cwd: string, name: string): Promise<void> {
  assertSafe(name, 'branch name')
  const r = await git(cwd, ['check-ref-format', '--branch', name], { allowFail: true })
  if (r.code !== 0) throw new Error(`"${name}" is not a valid branch name`)
}

export async function assertRefName(cwd: string, ref: string): Promise<void> {
  const r = await git(cwd, ['check-ref-format', ref], { allowFail: true })
  if (r.code !== 0) throw new Error(`"${ref}" is not a valid ref name`)
}

export async function resolveCommit(cwd: string, rev: string): Promise<string> {
  assertSafe(rev, 'revision')
  const r = await git(cwd, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], {
    allowFail: true
  })
  if (r.code !== 0) throw new Error(`"${rev}" does not name a commit`)
  return r.stdout.trim()
}

export async function tryResolve(cwd: string, rev: string): Promise<string | null> {
  const r = await git(cwd, ['rev-parse', '--verify', '--quiet', rev], { allowFail: true })
  return r.code === 0 ? r.stdout.trim() : null
}

export async function refExists(cwd: string, ref: string): Promise<boolean> {
  const r = await git(cwd, ['show-ref', '--verify', '--quiet', ref], { allowFail: true })
  return r.code === 0
}

export async function currentBranch(cwd: string): Promise<string | null> {
  const r = await git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFail: true })
  return r.code === 0 ? r.stdout.trim() : null
}

const gitDirCache = new Map<string, string>()

export async function gitDir(cwd: string): Promise<string> {
  const hit = gitDirCache.get(cwd)
  if (hit && existsSync(hit)) return hit
  const dir = await gitOut(cwd, ['rev-parse', '--absolute-git-dir'])
  gitDirCache.set(cwd, dir)
  return dir
}

const emptyTreeCache = new Map<string, string>()

export async function emptyTree(cwd: string): Promise<string> {
  const hit = emptyTreeCache.get(cwd)
  if (hit) return hit
  const sha = await gitOut(cwd, ['hash-object', '-t', 'tree', '--stdin'], { input: '' })
  emptyTreeCache.set(cwd, sha)
  return sha
}

/** True when tracked files have staged or unstaged modifications. */
export async function isDirty(cwd: string): Promise<boolean> {
  const out = await gitOut(cwd, ['status', '--porcelain=v1', '--untracked-files=no'])
  return out.trim().length > 0
}

export function pathInGitDir(dir: string, ...parts: string[]): string {
  return join(dir, ...parts)
}

let tmpIndexSeq = 0

/**
 * Runs `fn` with an environment that points git at a throwaway index file, so trees can be
 * built without touching the real index. The file is removed afterwards.
 */
export async function withTempIndex<T>(
  cwd: string,
  fn: (env: Record<string, string>) => Promise<T>
): Promise<T> {
  const dir = join(await gitDir(cwd), 'git-pro')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `tmp-index-${process.pid}-${Date.now()}-${tmpIndexSeq++}`)
  try {
    return await fn({ GIT_INDEX_FILE: file })
  } finally {
    rmSync(file, { force: true })
  }
}

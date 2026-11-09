import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { AppStash } from '../../shared/types'
import { gitOut } from './runner'

/**
 * Metadata for app-managed stashes, kept per repository in
 * <git-common-dir>/git-pro/stashes.json. The stash commits themselves live under
 * refs/git-pro/stashes/<id> (or refs/git-pro/stash-trash/<id>), so the metadata file is only
 * descriptive: if it is lost, stashes are still listed (with names recovered from the commits).
 */
export type StashMeta = Omit<AppStash, 'ref' | 'sha' | 'baseSubject'>

interface StoreFile {
  version: 1
  stashes: Record<string, StashMeta>
}

const commonDirCache = new Map<string, string>()

export async function commonDir(cwd: string): Promise<string> {
  const hit = commonDirCache.get(cwd)
  if (hit) return hit
  const out = await gitOut(cwd, ['rev-parse', '--git-common-dir'])
  const dir = isAbsolute(out) ? out : resolve(cwd, out)
  commonDirCache.set(cwd, dir)
  return dir
}

async function storePath(cwd: string): Promise<string> {
  return join(await commonDir(cwd), 'git-pro', 'stashes.json')
}

export async function readStore(cwd: string): Promise<StoreFile> {
  try {
    const parsed = JSON.parse(readFileSync(await storePath(cwd), 'utf8')) as StoreFile
    if (parsed && parsed.version === 1 && parsed.stashes) return parsed
  } catch {
    // missing or unreadable: start fresh
  }
  return { version: 1, stashes: {} }
}

export async function writeStore(cwd: string, store: StoreFile): Promise<void> {
  const p = await storePath(cwd)
  mkdirSync(dirname(p), { recursive: true })
  const tmp = `${p}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(store, null, 2))
  renameSync(tmp, p) // atomic replace
}

export async function updateMeta(
  cwd: string,
  id: string,
  fn: (meta: StashMeta | undefined) => StashMeta | undefined
): Promise<void> {
  const store = await readStore(cwd)
  const next = fn(store.stashes[id])
  if (next) store.stashes[id] = next
  else delete store.stashes[id]
  await writeStore(cwd, store)
}

export function newStashId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function assertStashId(id: string): void {
  if (!/^[a-z0-9]+-[a-z0-9]+$/.test(id)) throw new Error('Invalid stash id')
}

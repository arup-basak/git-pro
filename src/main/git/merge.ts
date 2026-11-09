import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import type { MergeResolution, MergeSource, MergeVersions } from '../../shared/types'
import { git } from './runner'

const OID = /^[0-9a-f]{40}([0-9a-f]{24})?$/

function safePath(cwd: string, path: string): string {
  if (!path || path.includes('\0')) throw new Error('Invalid path')
  const abs = resolve(cwd, path)
  const rel = relative(cwd, abs)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Path is outside the repository')
  return abs
}

function isBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8000).includes(0)
}

async function blob(cwd: string, spec: string): Promise<Buffer | null> {
  const r = await git(cwd, ['cat-file', 'blob', spec], { allowFail: true, quietStdout: true })
  return r.code === 0 ? r.stdoutBuf : null
}

/**
 * The versions of a conflicted file. "live" reads the index stages (1 = base, 2 = ours,
 * 3 = theirs) plus the working-tree file with conflict markers; "trees" reads a dry-run merge.
 */
export async function mergeVersions(
  cwd: string,
  path: string,
  source: MergeSource
): Promise<MergeVersions> {
  const abs = safePath(cwd, path)
  let base: Buffer | null
  let ours: Buffer | null
  let theirs: Buffer | null
  let merged: Buffer | null
  if (source.kind === 'live') {
    ;[base, ours, theirs] = await Promise.all([
      blob(cwd, `:1:${path}`),
      blob(cwd, `:2:${path}`),
      blob(cwd, `:3:${path}`)
    ])
    merged = existsSync(abs) ? readFileSync(abs) : null
  } else {
    const t = source.trees
    for (const oid of [t.base, t.ours, t.theirs, t.result])
      if (!OID.test(oid)) throw new Error('Invalid tree id')
    ;[base, ours, theirs, merged] = await Promise.all([
      blob(cwd, `${t.base}:${path}`),
      blob(cwd, `${t.ours}:${path}`),
      blob(cwd, `${t.theirs}:${path}`),
      blob(cwd, `${t.result}:${path}`)
    ])
  }
  const binary = [base, ours, theirs, merged].some((b) => b && isBinary(b))
  const text = (b: Buffer | null): string | null => (b && !binary ? b.toString('utf8') : null)
  return {
    path,
    base: text(base),
    ours: text(ours),
    theirs: text(theirs),
    merged: text(merged),
    binary
  }
}

/** Writes the resolution to the working tree and marks the path resolved in the index. */
export async function resolveConflict(
  cwd: string,
  path: string,
  res: MergeResolution
): Promise<void> {
  const abs = safePath(cwd, path)
  if ('delete' in res) {
    await git(cwd, ['rm', '--quiet', '--force', '--', path], { write: true })
    return
  }
  if ('take' in res) {
    const stage = res.take === 'ours' ? 2 : 3
    const content = await blob(cwd, `:${stage}:${path}`)
    if (content === null) {
      // That side deleted the file: resolving to it means deleting.
      await git(cwd, ['rm', '--quiet', '--force', '--', path], { write: true })
      return
    }
    writeFileSync(abs, content)
  } else {
    if (/^(<{7}|>{7})( |$)/m.test(res.content)) {
      throw new Error('The result still contains conflict markers')
    }
    writeFileSync(abs, res.content)
  }
  await git(cwd, ['add', '--', path], { write: true })
}

export async function treeDiff(
  cwd: string,
  from: string,
  to: string,
  path?: string
): Promise<string> {
  if (!OID.test(from) || !OID.test(to)) throw new Error('Invalid tree id')
  const args = ['diff', from, to, '--']
  if (path) {
    safePath(cwd, path)
    args.push(path)
  }
  return (await git(cwd, args, { quietStdout: true })).stdout
}

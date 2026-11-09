import type { ReflogEntry } from '../../shared/types'
import { FS, RS } from './parse'
import { git } from './runner'
import { assertSafe } from './util'

export async function listReflog(cwd: string, ref: string, limit: number): Promise<ReflogEntry[]> {
  assertSafe(ref, 'ref')
  const r = await git(
    cwd,
    [
      'reflog',
      'show',
      '--date=unix',
      `-n${Math.min(Math.max(limit, 1), 2000)}`,
      '--format=%H%x1f%gd%x1f%gs%x1e',
      ref,
      '--'
    ],
    { allowFail: true, quietStdout: true }
  )
  if (r.code !== 0) return []
  const out: ReflogEntry[] = []
  for (const rec of r.stdout.split(RS)) {
    const s = rec.replace(/^\n/, '')
    if (!s) continue
    const [sha, dated, message] = s.split(FS)
    const m = /@\{(\d+)\}$/.exec(dated)
    out.push({ sha, selector: `${ref}@{${out.length}}`, message, date: m ? Number(m[1]) : 0 })
  }
  return out
}

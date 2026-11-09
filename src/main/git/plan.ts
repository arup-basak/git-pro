import type { RowEdit } from '../../shared/types'
import { gitOut } from './runner'

export function hasMetadataEdit(e: RowEdit): boolean {
  return (
    e.message !== undefined ||
    e.author !== undefined ||
    e.authorDate !== undefined ||
    e.committer !== undefined ||
    e.committerDate !== undefined
  )
}

/** Refs (other than `exclude`) that still contain `oldSha`, i.e. point into pre-rewrite history. */
export async function refsContaining(
  cwd: string,
  oldShas: string[],
  exclude: string[]
): Promise<string[]> {
  if (oldShas.length === 0) return []
  const args = ['for-each-ref', '--format=%(refname)']
  for (const s of oldShas) args.push(`--contains=${s}`)
  args.push('refs/heads', 'refs/tags', 'refs/remotes')
  const out = await gitOut(cwd, args)
  const skip = new Set(exclude)
  return out
    .split('\n')
    .filter(Boolean)
    .filter((r) => !skip.has(r) && !r.endsWith('/HEAD'))
    .map((r) =>
      r.replace(/^refs\/(heads|tags|remotes)\//, (_m, k) =>
        k === 'tags' ? 'tag: ' : k === 'remotes' ? 'remote: ' : ''
      )
    )
}

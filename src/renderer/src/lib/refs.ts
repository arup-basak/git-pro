import type { RefsSnapshot } from '@shared/types'

/** Every ref name a user might type: local branches, remote branches, then tags. */
export function refNames(
  refs: RefsSnapshot | undefined,
  opts: { local?: boolean; remote?: boolean; tags?: boolean } = {}
): string[] {
  if (!refs) return []
  const { local = true, remote = true, tags = true } = opts
  return [
    ...(local ? refs.branches.map((b) => b.name) : []),
    ...(remote ? refs.remoteBranches.map((r) => r.short) : []),
    ...(tags ? refs.tags.map((t) => t.name) : [])
  ]
}

/** Local branches as dropdown options, marking the checked-out one. */
export function branchOptions(
  refs: RefsSnapshot | undefined
): Array<{ value: string; label: string; hint?: string }> {
  return (refs?.branches ?? []).map((b) => ({
    value: b.name,
    label: b.name,
    hint: b.current ? 'checked out' : undefined
  }))
}

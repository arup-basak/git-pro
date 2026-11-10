/** Folder view of a flat list of changed files. Pure, so it can be tested under Node. */

export interface TreeFile<T> {
  kind: 'file'
  /** Base name */
  name: string
  path: string
  item: T
}

export interface TreeDir<T> {
  kind: 'dir'
  /** One or more path segments: single-child folder chains are compacted ("src/main/git"). */
  name: string
  /** Full folder path without trailing slash; doubles as the collapse key. */
  path: string
  children: TreeNode<T>[]
  /** Every file below this folder, in tree order. */
  files: T[]
}

export type TreeNode<T> = TreeFile<T> | TreeDir<T>

export interface TreeRow<T> {
  node: TreeNode<T>
  depth: number
}

interface Building<T> {
  dirs: Map<string, Building<T>>
  files: TreeFile<T>[]
}

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })

/** Folders first, then files, each sorted by name; single-child folder chains are merged. */
export function buildFileTree<T>(items: readonly T[], pathOf: (t: T) => string): TreeNode<T>[] {
  const root: Building<T> = { dirs: new Map(), files: [] }
  for (const item of items) {
    const path = pathOf(item)
    const parts = path.split('/').filter(Boolean)
    const name = parts.pop() ?? path
    let at = root
    for (const p of parts) {
      let next = at.dirs.get(p)
      if (!next) {
        next = { dirs: new Map(), files: [] }
        at.dirs.set(p, next)
      }
      at = next
    }
    at.files.push({ kind: 'file', name, path, item })
  }

  const finish = (b: Building<T>, prefix: string): TreeNode<T>[] => {
    const dirs: TreeDir<T>[] = []
    for (const [segment, child] of b.dirs) {
      let name = segment
      let path = prefix ? `${prefix}/${segment}` : segment
      let node = child
      // Compact "a/" → "b/" → files into one "a/b" row.
      while (node.files.length === 0 && node.dirs.size === 1) {
        const [[s, only]] = node.dirs
        name = `${name}/${s}`
        path = `${path}/${s}`
        node = only
      }
      const children = finish(node, path)
      dirs.push({ kind: 'dir', name, path, children, files: filesOf(children) })
    }
    return [...dirs.sort(byName), ...[...b.files].sort(byName)]
  }
  return finish(root, '')
}

function filesOf<T>(nodes: TreeNode<T>[]): T[] {
  return nodes.flatMap((n) => (n.kind === 'file' ? [n.item] : n.files))
}

/** The visible rows, depth-first, skipping the contents of collapsed folders. */
export function visibleRows<T>(
  nodes: readonly TreeNode<T>[],
  collapsed: ReadonlySet<string>,
  depth = 0
): TreeRow<T>[] {
  const rows: TreeRow<T>[] = []
  for (const node of nodes) {
    rows.push({ node, depth })
    if (node.kind === 'dir' && !collapsed.has(node.path))
      rows.push(...visibleRows(node.children, collapsed, depth + 1))
  }
  return rows
}

/** Left padding of a file-list row at `depth` (folder view), in px. */
export const rowIndent = (depth: number): number => 8 + depth * 12

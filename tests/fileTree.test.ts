import { describe, expect, it } from 'vitest'
import { buildFileTree, visibleRows, type TreeNode } from '../src/renderer/src/lib/fileTree'

const tree = (paths: string[]): TreeNode<string>[] => buildFileTree(paths, (p) => p)

/** "dir/" and "file" names, indented by depth. */
const outline = (nodes: TreeNode<string>[], collapsed: Set<string> = new Set()): string[] =>
  visibleRows(nodes, collapsed).map(
    ({ node, depth }) => '  '.repeat(depth) + node.name + (node.kind === 'dir' ? '/' : '')
  )

describe('buildFileTree', () => {
  it('puts folders before files and sorts each naturally', () => {
    expect(outline(tree(['z.txt', 'b/2.txt', 'a.txt', 'b/10.txt', 'b/1.txt']))).toEqual([
      'b/',
      '  1.txt',
      '  2.txt',
      '  10.txt',
      'a.txt',
      'z.txt'
    ])
  })

  it('compacts single-child folder chains', () => {
    expect(
      outline(tree(['src/main/git/log.ts', 'src/main/git/stash.ts', 'src/renderer/App.tsx']))
    ).toEqual(['src/', '  main/git/', '    log.ts', '    stash.ts', '  renderer/', '    App.tsx'])
    expect(outline(tree(['a/b/c/only.txt']))).toEqual(['a/b/c/', '  only.txt'])
  })

  it('keeps full paths and lists every file under a folder', () => {
    const [src] = tree(['src/x/a.ts', 'src/b.ts', 'src/x/y/c.ts'])
    expect(src.kind).toBe('dir')
    if (src.kind !== 'dir') return
    expect(src.path).toBe('src')
    // Tree order: sub-folders before files at every level.
    expect(src.files).toEqual(['src/x/y/c.ts', 'src/x/a.ts', 'src/b.ts'])
    const x = src.children[0]
    expect(x).toMatchObject({ kind: 'dir', name: 'x', path: 'src/x' })
  })

  it('hides the contents of collapsed folders', () => {
    const nodes = tree(['src/main/a.ts', 'src/main/b.ts', 'src/c.ts', 'README.md'])
    expect(outline(nodes, new Set(['src/main']))).toEqual([
      'src/',
      '  main/',
      '  c.ts',
      'README.md'
    ])
    expect(outline(nodes, new Set(['src']))).toEqual(['src/', 'README.md'])
  })

  it('handles an empty list and top-level files', () => {
    expect(tree([])).toEqual([])
    expect(outline(tree(['one', 'two']))).toEqual(['one', 'two'])
  })
})

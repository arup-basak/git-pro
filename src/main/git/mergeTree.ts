import { git } from './runner'

export interface MergeTreeResult {
  tree: string
  conflicted: Set<string>
  messages: string[]
  clean: boolean
}

/**
 * 3-way merge without touching the index or working tree (`git merge-tree --write-tree`).
 * `ours`/`theirs` may be commits or trees; `base` is the merge base to use. Conflicted files
 * appear in the result tree with diff3-style markers.
 */
export async function mergeTrees(
  cwd: string,
  base: string,
  ours: string,
  theirs: string
): Promise<MergeTreeResult> {
  const r = await git(
    cwd,
    [
      '-c',
      'merge.conflictStyle=diff3',
      'merge-tree',
      '--write-tree',
      '-z',
      '--messages',
      `--merge-base=${base}`,
      ours,
      theirs
    ],
    { allowFail: true, quietStdout: true }
  )
  if (r.code !== 0 && r.code !== 1) throw new Error(r.stderr.trim() || 'git merge-tree failed')
  const tokens = r.stdout.split('\0')
  const tree = tokens[0]
  const conflicted = new Set<string>()
  let i = 1
  for (; i < tokens.length; i++) {
    const m = /^\d{6} [0-9a-f]+ \d\t(.*)$/s.exec(tokens[i])
    if (!m) break
    conflicted.add(m[1])
  }
  while (i < tokens.length && tokens[i] === '') i++
  const messages: string[] = []
  while (i < tokens.length && tokens[i] !== '') {
    const n = Number(tokens[i])
    if (!Number.isFinite(n)) break
    const msg = tokens[i + n + 2]
    if (msg) messages.push(msg.trim())
    i += n + 3
  }
  return { tree, conflicted, messages, clean: r.code === 0 }
}

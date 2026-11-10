import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyLines, buildPartialPatch, parseFilePatch } from '../src/main/git/hunks'
import { applyStash, saveStash } from '../src/main/git/stash'
import { worktreeDiff } from '../src/main/git/worktree'
import { textHash } from '../src/shared/hash'
import type { LineSelection, StashSaveRequest } from '../src/shared/types'
import { makeRepo, type TestRepo } from './helpers/tmpRepo'

let repo: TestRepo
afterEach(() => repo?.cleanup())

const write = (f: string, c: string): void => writeFileSync(join(repo.dir, f), c)
const read = (f: string): string => readFileSync(join(repo.dir, f), 'utf8')
const indexed = (f: string): Promise<string> => repo.git(['show', `:${f}`])

const LINES = Array.from({ length: 20 }, (_, i) => `line${i + 1}`)
const text = (lines: string[]): string => lines.join('\n') + '\n'

/** A committed 20-line file, then line 2 and line 18 changed: two separate hunks. */
async function twoHunks(): Promise<void> {
  repo = await makeRepo()
  await repo.commit('f.txt', text(LINES), 'init')
  const next = [...LINES]
  next[1] = 'LINE2'
  next[17] = 'LINE18'
  write('f.txt', text(next))
}

/** Builds a selection from the diff the app would show right now. */
async function sel(
  path: string,
  changes: number[],
  opts: { staged?: boolean; untracked?: boolean } = {}
): Promise<LineSelection> {
  const staged = !!opts.staged
  const untracked = !!opts.untracked
  const diff = await worktreeDiff(repo.dir, path, staged, untracked)
  return { path, staged, untracked, diffHash: textHash(diff), changes }
}

describe('buildPartialPatch', () => {
  const diff = [
    'diff --git a/f b/f',
    'index 1111111..2222222 100644',
    '--- a/f',
    '+++ b/f',
    '@@ -1,3 +1,3 @@',
    ' a',
    '-b',
    '+B',
    ' c',
    ''
  ].join('\n')

  it('keeps an unselected removal as context when staging', () => {
    const patch = buildPartialPatch(parseFilePatch(diff), new Set([1]), false)!
    expect(patch).toContain('@@ -1,3 +1,4 @@\n a\n b\n+B\n c\n')
    expect(patch).not.toContain('index ')
  })

  it('keeps an unselected addition as context when reversing', () => {
    const patch = buildPartialPatch(parseFilePatch(diff), new Set([0]), true)!
    expect(patch).toContain('@@ -1,4 +1,3 @@\n a\n-b\n B\n c\n')
  })

  it('returns null when nothing is selected', () => {
    expect(buildPartialPatch(parseFilePatch(diff), new Set(), false)).toBeNull()
  })
})

describe('line staging', () => {
  it('stages one of two hunks', async () => {
    await twoHunks()
    await applyLines(repo.dir, 'stage', await sel('f.txt', [0, 1]))
    const cached = await repo.git(['diff', '--cached'])
    expect(cached).toContain('+LINE2')
    expect(cached).not.toContain('LINE18')
    const unstaged = await repo.git(['diff'])
    expect(unstaged).toContain('+LINE18')
    expect(unstaged).not.toContain('LINE2\n')
  })

  it('stages some of the lines inside a hunk', async () => {
    repo = await makeRepo()
    await repo.commit('f.txt', text(['a', 'b', 'c', 'd']), 'init')
    write('f.txt', text(['a', 'B', 'c', 'x', 'y', 'd']))
    // Changes: 0 -b, 1 +B, 2 +x, 3 +y. Stage "+B" (keeping b) and "+y".
    await applyLines(repo.dir, 'stage', await sel('f.txt', [1, 3]))
    expect(await indexed('f.txt')).toBe(['a', 'b', 'B', 'c', 'y', 'd'].join('\n'))
    expect(read('f.txt')).toBe(text(['a', 'B', 'c', 'x', 'y', 'd']))
  })

  it('unstages one hunk of a staged file', async () => {
    await twoHunks()
    await repo.git(['add', 'f.txt'])
    await applyLines(repo.dir, 'unstage', await sel('f.txt', [2, 3], { staged: true }))
    const cached = await repo.git(['diff', '--cached'])
    expect(cached).toContain('+LINE2')
    expect(cached).not.toContain('LINE18')
    expect(read('f.txt')).toContain('LINE18')
  })

  it('discards one hunk from the working tree', async () => {
    await twoHunks()
    await applyLines(repo.dir, 'discard', await sel('f.txt', [2, 3]))
    const now = read('f.txt')
    expect(now).toContain('LINE2\n')
    expect(now).toContain('line18\n')
    expect(now).not.toContain('LINE18')
  })

  it('refuses a selection made on a diff that has since changed', async () => {
    await twoHunks()
    const stale = await sel('f.txt', [0, 1])
    write('f.txt', text(LINES))
    await expect(applyLines(repo.dir, 'stage', stale)).rejects.toThrow(/changed since/)
  })

  it('stages and discards some lines of an untracked file', async () => {
    repo = await makeRepo()
    await repo.commit('keep.txt', 'k\n', 'init')
    write('n.txt', text(['a', 'b', 'c']))
    await applyLines(repo.dir, 'stage', await sel('n.txt', [0, 2], { untracked: true }))
    expect(await indexed('n.txt')).toBe('a\nc')
    expect(read('n.txt')).toBe(text(['a', 'b', 'c']))

    write('u.txt', text(['1', '2', '3']))
    await applyLines(repo.dir, 'discard', await sel('u.txt', [1], { untracked: true }))
    expect(read('u.txt')).toBe(text(['1', '3']))
    await applyLines(repo.dir, 'discard', await sel('u.txt', [0, 1], { untracked: true }))
    expect(existsSync(join(repo.dir, 'u.txt'))).toBe(false)
  })

  it('handles a file without a newline at the end', async () => {
    repo = await makeRepo()
    await repo.commit('f.txt', 'x\ny', 'init')
    write('f.txt', 'X\ny')
    await applyLines(repo.dir, 'stage', await sel('f.txt', [0, 1]))
    expect(await repo.git(['show', ':f.txt'])).toBe('X\ny')
    expect(await repo.git(['diff'])).toBe('')
  })
})

const stashReq = (selections: LineSelection[]): StashSaveRequest => ({
  name: 'lines',
  notes: '',
  group: '',
  scope: 'lines',
  selections,
  includeUntracked: false,
  keepWorkingTree: false
})

describe('stashing lines', () => {
  it('stashes one hunk and brings it back on apply', async () => {
    await twoHunks()
    const s = await saveStash(repo.dir, stashReq([await sel('f.txt', [2, 3])]))
    expect(s.scope).toBe('lines')
    // The stashed hunk left the working tree; the other one stayed.
    expect(read('f.txt')).toContain('LINE2\n')
    expect(read('f.txt')).not.toContain('LINE18')
    // The stash has git's usual shape: HEAD, an index commit, and HEAD + the selected lines.
    expect(await repo.git(['rev-parse', `${s.sha}^1`])).toBe(await repo.git(['rev-parse', 'HEAD']))
    const stashed = await repo.git(['show', `${s.sha}:f.txt`])
    expect(stashed).toContain('LINE18')
    expect(stashed).not.toContain('LINE2\n')

    const r = await applyStash(
      repo.dir,
      { kind: 'app', id: s.id },
      { pop: false, restoreIndex: false }
    )
    expect(r.clean).toBe(true)
    expect(read('f.txt')).toContain('LINE2\n')
    expect(read('f.txt')).toContain('LINE18\n')
  })

  it('stashes lines from an untracked file', async () => {
    repo = await makeRepo()
    await repo.commit('keep.txt', 'k\n', 'init')
    write('u.txt', text(['a', 'b', 'c']))
    const s = await saveStash(repo.dir, stashReq([await sel('u.txt', [1], { untracked: true })]))
    expect(read('u.txt')).toBe(text(['a', 'c']))
    expect(await repo.git(['show', `${s.sha}:u.txt`])).toBe('b')
  })

  it('can keep the working tree as it is', async () => {
    await twoHunks()
    const before = read('f.txt')
    await saveStash(repo.dir, { ...stashReq([await sel('f.txt', [0, 1])]), keepWorkingTree: true })
    expect(read('f.txt')).toBe(before)
  })

  it('stashes lines of a file that also has staged changes, leaving the staged part alone', async () => {
    await twoHunks()
    await applyLines(repo.dir, 'stage', await sel('f.txt', [0, 1]))
    const s = await saveStash(repo.dir, stashReq([await sel('f.txt', [0, 1])]))
    // Staged LINE2 is untouched; the stashed LINE18 left the working tree.
    expect(await indexed('f.txt')).toContain('LINE2\n')
    expect(read('f.txt')).toContain('LINE2\n')
    expect(read('f.txt')).not.toContain('LINE18')
    // The stash is based on the staged state, so its own diff is just the selected lines.
    const own = await repo.git(['diff', `${s.sha}^1`, s.sha])
    expect(own).toContain('+LINE18')
    expect(own).not.toContain('LINE2')

    await repo.git(['commit', '-q', '-m', 'take LINE2'])
    const r = await applyStash(
      repo.dir,
      { kind: 'app', id: s.id },
      { pop: false, restoreIndex: false }
    )
    expect(r.clean).toBe(true)
    expect(read('f.txt')).toContain('LINE18\n')
  })
})

describe('applying a stash onto uncommitted edits', () => {
  it('merges into the working tree and stages nothing', async () => {
    await twoHunks()
    const s = await saveStash(repo.dir, stashReq([await sel('f.txt', [2, 3])]))
    // Keep editing the same file elsewhere, then bring the stashed lines back.
    write('f.txt', read('f.txt').replace('line10\n', 'LINE10\n'))
    const r = await applyStash(
      repo.dir,
      { kind: 'app', id: s.id },
      { pop: true, restoreIndex: false }
    )
    expect(r).toMatchObject({ clean: true, dropped: true })
    const now = read('f.txt')
    expect(now).toContain('LINE2\n')
    expect(now).toContain('LINE10\n')
    expect(now).toContain('LINE18\n')
    expect(await repo.git(['diff', '--cached'])).toBe('')
  })

  it('refuses when the stash would conflict with uncommitted edits', async () => {
    await twoHunks()
    const s = await saveStash(repo.dir, stashReq([await sel('f.txt', [2, 3])]))
    write('f.txt', read('f.txt').replace('line18\n', 'MINE18\n'))
    const before = read('f.txt')
    await expect(
      applyStash(repo.dir, { kind: 'app', id: s.id }, { pop: false, restoreIndex: false })
    ).rejects.toThrow(/conflict with uncommitted changes in f\.txt/)
    expect(read('f.txt')).toBe(before)
  })
})

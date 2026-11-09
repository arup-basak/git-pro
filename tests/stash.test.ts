import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { mergeVersions, resolveConflict } from '../src/main/git/merge'
import {
  adoptStash,
  applyStash,
  deleteStash,
  overview,
  previewApply,
  purgeStash,
  restoreStash,
  saveStash,
  stashFiles,
  stashToBranch,
  updateStash
} from '../src/main/git/stash'
import { getStatus } from '../src/main/git/worktree'
import type { StashSaveRequest } from '../src/shared/types'
import { makeRepo, type TestRepo } from './helpers/tmpRepo'

let repo: TestRepo
afterEach(() => repo?.cleanup())

const req = (r: Partial<StashSaveRequest>): StashSaveRequest => ({
  name: 'WIP',
  notes: '',
  group: '',
  scope: 'all',
  includeUntracked: true,
  keepWorkingTree: false,
  ...r
})

const write = (f: string, c: string): void => writeFileSync(join(repo.dir, f), c)
const read = (f: string): string => readFileSync(join(repo.dir, f), 'utf8')

async function base(): Promise<void> {
  repo = await makeRepo()
  await repo.commit('f.txt', 'one\ntwo\nthree\n', 'init')
  await repo.commit('g.txt', 'g\n', 'second')
}

describe('app stashes', () => {
  it('saves into a stable ref with metadata and leaves git’s stash stack empty', async () => {
    await base()
    write('f.txt', 'one\nTWO\nthree\n')
    write('new.txt', 'untracked\n')
    const s = await saveStash(
      repo.dir,
      req({ name: 'Refactor parser', group: 'experiments', notes: 'try B' })
    )
    expect(s.ref).toMatch(/^refs\/git-pro\/stashes\//)
    expect((await getStatus(repo.dir)).entries).toEqual([])
    const ov = await overview(repo.dir)
    expect(ov.stack).toEqual([])
    expect(ov.app).toHaveLength(1)
    expect(ov.app[0]).toMatchObject({
      name: 'Refactor parser',
      group: 'experiments',
      notes: 'try B',
      branch: 'main',
      baseSubject: 'second'
    })
    expect(ov.groups).toEqual(['experiments'])
    expect(await stashFiles(repo.dir, s.sha)).toEqual([
      { path: 'f.txt', status: 'M', untracked: false },
      { path: 'new.txt', status: 'A', untracked: true }
    ])
  })

  it('can snapshot without touching the working tree, and stash selected paths only', async () => {
    await base()
    write('f.txt', 'changed\n')
    write('g.txt', 'changed too\n')
    await saveStash(repo.dir, req({ name: 'snapshot', keepWorkingTree: true }))
    expect(read('f.txt')).toBe('changed\n')
    await saveStash(repo.dir, req({ name: 'only g', scope: 'paths', paths: ['g.txt'] }))
    expect(read('g.txt')).toBe('g\n')
    expect(read('f.txt')).toBe('changed\n')
    expect((await overview(repo.dir)).app.map((s) => s.name).sort()).toEqual(['only g', 'snapshot'])
  })

  it('previews a clean apply without modifying anything', async () => {
    await base()
    write('f.txt', 'one\nTWO\nthree\n')
    write('new.txt', 'n\n')
    const s = await saveStash(repo.dir, req({}))
    const p = await previewApply(repo.dir, s.sha)
    expect(p.clean).toBe(true)
    expect(p.files).toEqual([
      { path: 'f.txt', outcome: 'modified', untracked: false },
      { path: 'new.txt', outcome: 'untracked', untracked: true }
    ])
    expect(existsSync(join(repo.dir, 'new.txt'))).toBe(false)
    expect(read('f.txt')).toBe('one\ntwo\nthree\n')
  })

  it('previews conflicts (with a diff3 merge result) and blocked files', async () => {
    await base()
    write('f.txt', 'one\nSTASHED\nthree\n')
    write('g.txt', 'g stashed\n')
    const s = await saveStash(repo.dir, req({}))
    await repo.commit('f.txt', 'one\nCOMMITTED\nthree\n', 'conflicting change')
    write('g.txt', 'local edit\n')
    const p = await previewApply(repo.dir, s.sha)
    expect(p.clean).toBe(false)
    expect(p.files.find((f) => f.path === 'f.txt')?.outcome).toBe('conflict')
    expect(p.files.find((f) => f.path === 'g.txt')?.outcome).toBe('blocked')
    const v = await mergeVersions(repo.dir, 'f.txt', { kind: 'trees', trees: p.trees })
    expect(v.ours).toBe('one\nCOMMITTED\nthree\n')
    expect(v.theirs).toBe('one\nSTASHED\nthree\n')
    expect(v.base).toBe('one\ntwo\nthree\n')
    expect(v.merged).toContain('<<<<<<<')
    expect(v.merged).toContain('|||||||')
  })

  it('applies with conflicts, exposes all versions, and resolves them', async () => {
    await base()
    write('f.txt', 'one\nSTASHED\nthree\n')
    const s = await saveStash(repo.dir, req({}))
    await repo.commit('f.txt', 'one\nCOMMITTED\nthree\n', 'conflicting change')
    const res = await applyStash(
      repo.dir,
      { kind: 'app', id: s.id },
      { pop: true, restoreIndex: false }
    )
    expect(res.clean).toBe(false)
    expect(res.conflicted).toEqual(['f.txt'])
    expect(res.dropped).toBe(false) // never drop a stash whose apply conflicted
    const v = await mergeVersions(repo.dir, 'f.txt', { kind: 'live' })
    expect(v).toMatchObject({
      base: 'one\ntwo\nthree\n',
      ours: 'one\nCOMMITTED\nthree\n',
      theirs: 'one\nSTASHED\nthree\n'
    })
    expect(v.merged).toContain('>>>>>>>')
    await expect(resolveConflict(repo.dir, 'f.txt', { content: v.merged! })).rejects.toThrow(
      /markers/
    )
    await resolveConflict(repo.dir, 'f.txt', { content: 'one\nCOMMITTED\nSTASHED\nthree\n' })
    const st = await getStatus(repo.dir)
    expect(st.entries.filter((e) => e.conflicted)).toEqual([])
    expect(read('f.txt')).toBe('one\nCOMMITTED\nSTASHED\nthree\n')
    expect((await overview(repo.dir)).app).toHaveLength(1)
  })

  it('pops cleanly into the trash, restores, purges', async () => {
    await base()
    write('f.txt', 'x\n')
    const s = await saveStash(repo.dir, req({ name: 'keep me' }))
    const res = await applyStash(
      repo.dir,
      { kind: 'app', id: s.id },
      { pop: true, restoreIndex: true }
    )
    expect(res).toMatchObject({ clean: true, dropped: true })
    expect(read('f.txt')).toBe('x\n')
    let ov = await overview(repo.dir)
    expect(ov.app).toHaveLength(0)
    expect(ov.trash[0]).toMatchObject({ id: s.id, name: 'keep me' })
    expect(ov.trash[0].deletedAt).toBeGreaterThan(0)
    await restoreStash(repo.dir, s.id)
    ov = await overview(repo.dir)
    expect(ov.app.map((a) => a.id)).toEqual([s.id])
    await deleteStash(repo.dir, { kind: 'app', id: s.id })
    await purgeStash(repo.dir, s.id)
    ov = await overview(repo.dir)
    expect(ov.app.length + ov.trash.length).toBe(0)
  })

  it('renames, regroups and pins', async () => {
    await base()
    write('f.txt', '1\n')
    const a = await saveStash(repo.dir, req({ name: 'a' }))
    write('f.txt', '2\n')
    await saveStash(repo.dir, req({ name: 'b' }))
    await updateStash(repo.dir, a.id, { name: 'A renamed', group: 'ui', pinned: true })
    const ov = await overview(repo.dir)
    expect(ov.app[0]).toMatchObject({ id: a.id, name: 'A renamed', group: 'ui', pinned: true })
    expect(ov.groups).toEqual(['ui'])
  })

  it('lists plain git stashes separately and adopts them', async () => {
    await base()
    write('f.txt', 'plain\n')
    await repo.git(['stash', 'push', '-m', 'made on the CLI'])
    let ov = await overview(repo.dir)
    expect(ov.stack).toHaveLength(1)
    expect(ov.stack[0]).toMatchObject({ index: 0, branch: 'main' })
    await expect(
      deleteStash(repo.dir, { kind: 'stack', index: 0, sha: 'f'.repeat(40) })
    ).rejects.toThrow(/changed/)
    const adopted = await adoptStash(repo.dir, 0, ov.stack[0].sha, '', 'imported')
    expect(adopted.name).toBe('made on the CLI')
    ov = await overview(repo.dir)
    expect(ov.stack).toHaveLength(0)
    expect(ov.app[0]).toMatchObject({ name: 'made on the CLI', group: 'imported' })
  })

  it('turns a stash into a branch at its base commit', async () => {
    await base()
    write('f.txt', 'feature work\n')
    const s = await saveStash(repo.dir, req({}))
    await repo.commit('g.txt', 'moved on\n', 'later')
    await stashToBranch(repo.dir, { kind: 'app', id: s.id }, 'from-stash')
    expect(await repo.git(['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('from-stash')
    expect(await repo.git(['rev-parse', 'HEAD'])).toBe(s.baseSha)
    expect(read('f.txt')).toBe('feature work\n')
    expect((await overview(repo.dir)).app).toHaveLength(0)
  })
})

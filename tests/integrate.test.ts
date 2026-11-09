import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { mergeBranch, mergePreview, rebaseOnto, rebasePreview } from '../src/main/git/integrate'
import { abortOp, detectOp } from '../src/main/git/opstate'
import type { BranchMergeRequest, RebaseOntoRequest } from '../src/shared/types'
import { makeRepo, type TestRepo } from './helpers/tmpRepo'

let repo: TestRepo
afterEach(() => repo?.cleanup())

const read = (f: string): string => readFileSync(join(repo.dir, f), 'utf8')
const sha = (rev: string): Promise<string> => repo.git(['rev-parse', rev])
const subjects = async (rev: string, n?: number): Promise<string[]> =>
  (await repo.git(['log', '--format=%s', ...(n ? [`-n${n}`] : []), rev])).split('\n')

/** main: base → m1; feature (from base): f1 → f2. Checked out: main. */
async function diverged(): Promise<void> {
  repo = await makeRepo()
  await repo.commit('base.txt', 'base\n', 'base')
  await repo.git(['switch', '-q', '-c', 'feature'])
  await repo.commit('f.txt', 'f1\n', 'f1')
  await repo.commit('f.txt', 'f1\nf2\n', 'f2')
  await repo.git(['switch', '-q', 'main'])
  await repo.commit('m.txt', 'm1\n', 'm1')
}

const merge = (r: Partial<BranchMergeRequest>): BranchMergeRequest => ({
  source: 'feature',
  target: 'main',
  mode: 'no-ff',
  output: { mode: 'in-place' },
  checkout: false,
  ...r
})

const rebase = (r: Partial<RebaseOntoRequest>): RebaseOntoRequest => ({
  branch: 'feature',
  onto: 'main',
  output: { mode: 'new-branch', name: 'feature-rebased' },
  autostash: false,
  keepMerges: false,
  ...r
})

describe('merge preview', () => {
  it('reports clean merges, fast-forwards and conflicts', async () => {
    await diverged()
    const p = await mergePreview(repo.dir, 'feature', 'main')
    expect(p).toMatchObject({ clean: true, fastForward: false, upToDate: false, ahead: 2 })
    expect(p.targetCheckedOut).toBe(true)
    expect(p.files).toEqual([{ status: 'A', path: 'f.txt' }])

    await repo.commit('f.txt', 'main version\n', 'clash')
    const c = await mergePreview(repo.dir, 'feature', 'main')
    expect(c.clean).toBe(false)
    expect(c.conflicted).toEqual(['f.txt'])
  })
})

describe('merging a branch', () => {
  it('merges into the checked-out branch with a merge commit and a backup', async () => {
    await diverged()
    const before = await sha('main')
    const r = await mergeBranch(repo.dir, merge({}))
    expect(r.status).toBe('done')
    expect(await repo.git(['rev-list', '--parents', '-n1', 'main'])).toContain(before)
    expect(await subjects('main', 1)).toEqual(["Merge branch 'feature' into main"])
    expect(await sha(r.backupRef!)).toBe(before)
    expect(read('f.txt')).toBe('f1\nf2\n')
  })

  it('fast-forwards when possible and ff-only refuses diverged histories', async () => {
    repo = await makeRepo()
    await repo.commit('a.txt', 'a\n', 'a')
    await repo.git(['branch', 'ahead'])
    await repo.git(['switch', '-q', 'ahead'])
    await repo.commit('a.txt', 'a\nb\n', 'b')
    await repo.git(['switch', '-q', 'main'])
    const r = await mergeBranch(repo.dir, merge({ source: 'ahead', mode: 'ff-only' }))
    expect(r.status).toBe('done')
    expect(await sha('main')).toBe(await sha('ahead'))

    await diverged()
    await expect(mergeBranch(repo.dir, merge({ mode: 'ff-only' }))).rejects.toThrow(/diverged/)
  })

  it('squashes into a single commit', async () => {
    await diverged()
    const r = await mergeBranch(repo.dir, merge({ mode: 'squash', message: 'feature, squashed' }))
    expect(r.status).toBe('done')
    expect(await repo.git(['rev-list', '--parents', '-n1', 'main'])).toMatch(/^\w+ \w+$/)
    expect(await subjects('main', 1)).toEqual(['feature, squashed'])
    expect(read('f.txt')).toBe('f1\nf2\n')
  })

  it('stops on conflicts for the merge editor, and abort restores the branch', async () => {
    await diverged()
    await repo.commit('f.txt', 'main version\n', 'clash')
    const before = await sha('main')
    const r = await mergeBranch(repo.dir, merge({}))
    expect(r.status).toBe('conflict')
    expect((await detectOp(repo.dir, [])).kind).toBe('merge')
    await abortOp(repo.dir)
    expect(await sha('main')).toBe(before)
  })

  it('merges into a new branch and leaves the target alone', async () => {
    await diverged()
    const before = await sha('main')
    const r = await mergeBranch(repo.dir, merge({ output: { mode: 'new-branch', name: 'merged' } }))
    expect(r).toMatchObject({ status: 'done', branch: 'merged', backupRef: null })
    expect(await sha('main')).toBe(before)
    expect(await subjects('merged', 1)).toEqual(["Merge branch 'feature' into merged"])
  })

  it('merges into a branch that is not checked out without touching the working tree', async () => {
    await diverged()
    await repo.git(['switch', '-q', 'feature'])
    writeFileSync(join(repo.dir, 'f.txt'), 'uncommitted\n')
    const r = await mergeBranch(repo.dir, merge({ source: 'feature', target: 'main' }))
    expect(r.status).toBe('done')
    expect(await repo.git(['symbolic-ref', '--short', 'HEAD'])).toBe('feature')
    expect(read('f.txt')).toBe('uncommitted\n')
    expect(await repo.git(['show', 'main:f.txt'])).toBe('f1\nf2')
    expect(await repo.git(['show', 'main:m.txt'])).toBe('m1')
    expect((await repo.git(['rev-list', '--parents', '-n1', 'main'])).split(' ')).toHaveLength(3)
  })

  it('refuses a conflicting merge into a branch that is not checked out', async () => {
    await diverged()
    await repo.commit('f.txt', 'main version\n', 'clash')
    await repo.git(['switch', '-q', 'feature'])
    await expect(mergeBranch(repo.dir, merge({}))).rejects.toThrow(/conflicts in f\.txt/)
  })

  it('reports up-to-date when the source is already merged', async () => {
    await diverged()
    const r = await mergeBranch(repo.dir, merge({ source: 'main~1' }))
    expect(r.status).toBe('up-to-date')
  })
})

describe('rebasing onto another branch', () => {
  it('previews the commits to replay', async () => {
    await diverged()
    const p = await rebasePreview(repo.dir, 'feature', 'main')
    expect(p.commits.map((c) => c.subject)).toEqual(['f1', 'f2'])
    expect(p.upToDate).toBe(false)
  })

  it('rebases into a new branch and keeps the original', async () => {
    await diverged()
    const original = await sha('feature')
    const r = await rebaseOnto(repo.dir, rebase({}))
    expect(r.status).toBe('done')
    expect(await subjects('feature-rebased')).toEqual(['f2', 'f1', 'm1', 'base'])
    expect(await sha('feature')).toBe(original)
  })

  it('rebases in place with a backup', async () => {
    await diverged()
    const original = await sha('feature')
    const r = await rebaseOnto(repo.dir, rebase({ output: { mode: 'in-place' } }))
    expect(await subjects('feature')).toEqual(['f2', 'f1', 'm1', 'base'])
    expect(await sha(r.backupRef!)).toBe(original)
  })

  it('pauses on a conflict', async () => {
    await diverged()
    await repo.commit('f.txt', 'main version\n', 'clash')
    const r = await rebaseOnto(repo.dir, rebase({}))
    expect(r.status).toBe('conflict')
    expect((await detectOp(repo.dir, [])).kind).toBe('rebase')
    await abortOp(repo.dir)
  })

  it('refuses a dirty working tree without autostash', async () => {
    await diverged()
    writeFileSync(join(repo.dir, 'base.txt'), 'dirty\n')
    await expect(rebaseOnto(repo.dir, rebase({}))).rejects.toThrow(/uncommitted changes/)
    expect(await repo.git(['branch', '--list', 'feature-rebased'])).toBe('')
  })
})

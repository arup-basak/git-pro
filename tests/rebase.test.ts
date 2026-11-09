import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyPlan, loadRange } from '../src/main/git/history'
import { abortOp, detectOp } from '../src/main/git/opstate'
import type { HistoryAction, HistoryPlan, HistoryRange, RowEdit } from '../src/shared/types'
import { makeRepo, type TestRepo } from './helpers/tmpRepo'

let repo: TestRepo
afterEach(() => repo?.cleanup())

function plan(
  range: HistoryRange,
  order: Array<[number, HistoryAction, Partial<RowEdit>?]>,
  extra: Partial<HistoryPlan> = {}
): HistoryPlan {
  return {
    tip: range.tipBranch ?? range.tipSha,
    tipSha: range.tipSha,
    baseSha: range.baseSha,
    rows: order.map(([i, action, edit]) => ({ sha: range.rows[i].sha, action, ...edit })),
    output: { mode: 'new-branch', name: 'reworked' },
    preserveCommitterDates: false,
    resign: false,
    autostash: false,
    ...extra
  }
}

async function subjects(rev: string): Promise<string[]> {
  return (await repo.git(['log', '--format=%s', rev])).split('\n').reverse()
}

async function fourFiles(): Promise<HistoryRange> {
  repo = await makeRepo()
  await repo.commit('a.txt', 'a\n', 'A', 1_700_000_000)
  await repo.commit('b.txt', 'b\n', 'B', 1_700_003_600)
  await repo.commit('c.txt', 'c\n', 'C', 1_700_007_200)
  await repo.commit('d.txt', 'd\n', 'D', 1_700_010_800)
  return loadRange(repo.dir, 'main', { sha: null })
}

describe('structural rewrite (rebase engine)', () => {
  it('reorders commits onto a new branch', async () => {
    const range = await fourFiles()
    const res = await applyPlan(
      repo.dir,
      plan(range, [
        [0, 'pick'],
        [2, 'pick'],
        [1, 'pick'],
        [3, 'pick']
      ])
    )
    expect(res.engine).toBe('rebase')
    expect(res.status).toBe('done')
    expect(await subjects('reworked')).toEqual(['A', 'C', 'B', 'D'])
    expect(await repo.git(['diff', 'main', 'reworked'])).toBe('')
    expect(await repo.git(['rev-parse', 'main'])).toBe(range.tipSha)
  })

  it('squashes, fixes up and drops', async () => {
    const range = await fourFiles()
    await applyPlan(
      repo.dir,
      plan(range, [
        [0, 'pick'],
        [1, 'squash'],
        [2, 'drop'],
        [3, 'fixup']
      ])
    )
    expect(await subjects('reworked')).toEqual(['A'])
    const msg = await repo.git(['log', '-1', '--format=%B', 'reworked'])
    expect(msg).toContain('A')
    expect(msg).toContain('B')
    expect(msg).not.toContain('D')
    expect(await repo.git(['ls-tree', '--name-only', 'reworked'])).toBe('a.txt\nb.txt\nd.txt')
  })

  it('applies metadata edits while reordering and can preserve committer dates', async () => {
    const range = await fourFiles()
    const when = { ts: 1_600_000_000, tz: '+0200' }
    await applyPlan(
      repo.dir,
      plan(
        range,
        [
          [0, 'pick'],
          [2, 'pick', { authorDate: when, committerDate: when, message: 'C (moved)' }],
          [1, 'pick'],
          [3, 'pick']
        ],
        { preserveCommitterDates: true }
      )
    )
    const log = (await repo.git(['log', '--format=%ad|%cd|%s', '--date=raw', 'reworked'])).split(
      '\n'
    )
    expect(log).toEqual([
      '1700010800 +0000|1700010800 +0000|D',
      '1700003600 +0000|1700003600 +0000|B',
      '1600000000 +0200|1600000000 +0200|C (moved)',
      '1700000000 +0000|1700000000 +0000|A'
    ])
  })

  it('stops on a conflict, reports it, and can be aborted', async () => {
    repo = await makeRepo()
    await repo.commit('f.txt', '1\n', 'one')
    await repo.commit('f.txt', '2\n', 'two')
    await repo.commit('f.txt', '3\n', 'three')
    const range = await loadRange(repo.dir, 'main', { sha: null })
    const res = await applyPlan(
      repo.dir,
      plan(range, [
        [0, 'pick'],
        [2, 'pick'],
        [1, 'pick']
      ])
    )
    expect(res.status).toBe('conflict')
    const op = await detectOp(repo.dir, [])
    expect(op.kind).toBe('rebase')
    await abortOp(repo.dir)
    expect((await detectOp(repo.dir, [])).kind).toBe('none')
    expect(await repo.git(['rev-parse', 'reworked'])).toBe(range.tipSha)
  })

  it('refuses to run with uncommitted changes unless autostash is on', async () => {
    const range = await fourFiles()
    writeFileSync(join(repo.dir, 'a.txt'), 'dirty\n')
    await expect(
      applyPlan(
        repo.dir,
        plan(range, [
          [1, 'pick'],
          [0, 'pick'],
          [2, 'pick'],
          [3, 'pick']
        ])
      )
    ).rejects.toThrow(/uncommitted/)
    const res = await applyPlan(
      repo.dir,
      plan(
        range,
        [
          [1, 'pick'],
          [0, 'pick'],
          [2, 'pick'],
          [3, 'pick']
        ],
        { autostash: true }
      )
    )
    expect(res.status).toBe('done')
    expect(await subjects('reworked')).toEqual(['B', 'A', 'C', 'D'])
    expect(await repo.git(['status', '--porcelain'])).toBe(' M a.txt')
  })

  it('rejects squash as the first kept commit', async () => {
    const range = await fourFiles()
    await expect(
      applyPlan(
        repo.dir,
        plan(range, [
          [0, 'squash'],
          [1, 'pick'],
          [2, 'pick'],
          [3, 'pick']
        ])
      )
    ).rejects.toThrow(/oldest kept commit/)
  })
})

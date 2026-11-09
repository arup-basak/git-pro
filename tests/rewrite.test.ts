import { afterEach, describe, expect, it } from 'vitest'
import { applyPlan, loadRange } from '../src/main/git/history'
import { listBackups, restoreBackup } from '../src/main/git/backup'
import type { HistoryPlan, HistoryRange, RowEdit } from '../src/shared/types'
import { datesOf, makeRepo, type TestRepo } from './helpers/tmpRepo'

let repo: TestRepo
afterEach(() => repo?.cleanup())

function planFrom(
  range: HistoryRange,
  edits: Record<string, Partial<RowEdit>>,
  output: HistoryPlan['output'] = { mode: 'new-branch', name: 'edited' }
): HistoryPlan {
  return {
    tip: range.tipBranch ?? range.tipSha,
    tipSha: range.tipSha,
    baseSha: range.baseSha,
    rows: range.rows.map((r) => ({ sha: r.sha, action: 'pick', ...edits[r.sha] })),
    output,
    preserveCommitterDates: false,
    resign: false,
    autostash: false
  }
}

async function linear(): Promise<string[]> {
  repo = await makeRepo()
  const a = await repo.commit('a.txt', 'a\n', 'A', 1_700_000_000)
  const b = await repo.commit('b.txt', 'b\n', 'B', 1_700_003_600)
  const c = await repo.commit('c.txt', 'c\n', 'C', 1_700_007_200)
  const d = await repo.commit('d.txt', 'd\n', 'D', 1_700_010_800)
  return [a, b, c, d]
}

describe('metadata rewrite (commit-tree engine)', () => {
  it('retimes a middle commit onto a new branch without touching the original', async () => {
    const [a, , , d] = await linear()
    const range = await loadRange(repo.dir, 'main', { sha: null })
    expect(range.rows.map((r) => r.subject)).toEqual(['A', 'B', 'C', 'D'])
    const b = range.rows[1].sha
    const when = { ts: 1_600_000_000, tz: '+0530' }
    const res = await applyPlan(
      repo.dir,
      planFrom(range, { [b]: { authorDate: when, committerDate: when } })
    )
    expect(res.engine).toBe('metadata')
    expect(res.status).toBe('done')
    expect(res.branch).toBe('edited')
    expect(res.mapping).toHaveLength(3) // B, C, D rewritten

    expect(await repo.git(['rev-parse', 'main'])).toBe(d)
    expect(await repo.git(['diff', 'main', 'edited'])).toBe('')
    expect(await repo.git(['rev-parse', 'edited~3'])).toBe(a)
    expect(await datesOf(repo, 'edited')).toEqual([
      '1700010800 +0000|1700010800 +0000|D',
      '1700007200 +0000|1700007200 +0000|C',
      '1600000000 +0530|1600000000 +0530|B',
      '1700000000 +0000|1700000000 +0000|A'
    ])
    expect(res.staleRefs).toContain('main')
  })

  it('reproduces identical SHAs for an edit that changes nothing (byte-exact messages)', async () => {
    repo = await makeRepo()
    await repo.commit('a.txt', 'a\n', 'A')
    await repo.git([
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'Ünïcode subject',
      '-m',
      'Body line  \n\n\nwith gaps'
    ])
    const range = await loadRange(repo.dir, 'main', { sha: null })
    const second = range.rows[1]
    await expect(
      applyPlan(
        repo.dir,
        planFrom(range, {
          [second.sha]: {
            authorDate: second.author.date,
            committerDate: second.committer.date,
            author: { name: second.author.name, email: second.author.email }
          }
        })
      )
    ).rejects.toThrow(/did not change/)
  })

  it('rewrites in place with a backup that can be restored', async () => {
    const [, , c, d] = await linear()
    const range = await loadRange(repo.dir, 'main', { sha: null })
    const res = await applyPlan(
      repo.dir,
      planFrom(
        range,
        {
          [c]: {
            author: { name: 'Someone Else', email: 'else@example.com' },
            message: 'C reworded\n\nwith body'
          }
        },
        { mode: 'in-place' }
      )
    )
    expect(res.branch).toBe('main')
    expect(res.backupRef).toMatch(/^refs\/git-pro\/backups\/.*-rewrite\/main$/)
    expect(await repo.git(['log', '-1', '--format=%an <%ae>|%B', 'main~1'])).toBe(
      'Someone Else <else@example.com>|C reworded\n\nwith body\n'
    )
    expect(await repo.git(['status', '--porcelain'])).toBe('')

    const backups = await listBackups(repo.dir)
    expect(backups[0]).toMatchObject({ name: 'main', sha: d, reason: 'rewrite' })
    await restoreBackup(repo.dir, backups[0].ref, 'reset-original')
    expect(await repo.git(['rev-parse', 'main'])).toBe(d)
  })

  it('respects a base commit and keeps commits below it', async () => {
    const [a, b, c] = await linear()
    const range = await loadRange(repo.dir, 'main', { sha: b })
    expect(range.rows.map((r) => r.subject)).toEqual(['C', 'D'])
    const res = await applyPlan(
      repo.dir,
      planFrom(range, { [c]: { authorDate: { ts: 1_650_000_000, tz: '-0700' } } })
    )
    expect(await repo.git(['rev-parse', 'edited~2'])).toBe(b)
    expect(await repo.git(['rev-parse', 'edited~3'])).toBe(a)
    expect(res.mapping).toHaveLength(2)
    expect((await datesOf(repo, 'edited'))[1]).toBe('1650000000 -0700|1700007200 +0000|C')
  })

  it('loads the last N commits', async () => {
    await linear()
    const range = await loadRange(repo.dir, 'main', { count: 2 })
    expect(range.rows.map((r) => r.subject)).toEqual(['C', 'D'])
    const all = await loadRange(repo.dir, 'main', { count: 50 })
    expect(all.baseSha).toBeNull()
    expect(all.rows).toHaveLength(4)
  })

  it('preserves merge commits', async () => {
    repo = await makeRepo()
    const a = await repo.commit('a.txt', 'a\n', 'A')
    await repo.git(['switch', '-q', '-c', 'feature'])
    await repo.commit('f.txt', 'f\n', 'F')
    await repo.git(['switch', '-q', 'main'])
    await repo.commit('m.txt', 'm\n', 'M1')
    await repo.git(['merge', '-q', '--no-ff', '-m', 'Merge feature', 'feature'], {
      GIT_AUTHOR_DATE: '@1700500000 +0000',
      GIT_COMMITTER_DATE: '@1700500000 +0000'
    })
    await repo.commit('e.txt', 'e\n', 'E')
    const range = await loadRange(repo.dir, 'main', { sha: null })
    expect(range.rows.some((r) => r.isMerge)).toBe(true)
    await applyPlan(
      repo.dir,
      planFrom(range, { [a]: { authorDate: { ts: 1_500_000_000, tz: '+0100' } } })
    )
    expect(await repo.git(['diff', 'main', 'edited'])).toBe('')
    expect(await repo.git(['rev-list', '--merges', '--count', 'edited'])).toBe('1')
    expect(await repo.git(['rev-list', '--count', 'edited'])).toBe('5')
    expect(await repo.git(['log', '-1', '--format=%ad', '--date=raw', `edited~1^2~1`])).toBe(
      '1500000000 +0100'
    )
  })

  it('refuses to apply when the tip moved', async () => {
    await linear()
    const range = await loadRange(repo.dir, 'main', { sha: null })
    await repo.commit('e.txt', 'e\n', 'E')
    await expect(
      applyPlan(repo.dir, planFrom(range, { [range.rows[0].sha]: { message: 'x' } }))
    ).rejects.toThrow(/moved/)
  })

  it('refuses an existing output branch name', async () => {
    await linear()
    await repo.git(['branch', 'edited'])
    const range = await loadRange(repo.dir, 'main', { sha: null })
    await expect(
      applyPlan(repo.dir, planFrom(range, { [range.rows[0].sha]: { message: 'x' } }))
    ).rejects.toThrow(/already exists/)
  })
})

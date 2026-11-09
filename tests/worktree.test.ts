import { renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listLog, refsSnapshot, commitDetail } from '../src/main/git/log'
import { createTag } from '../src/main/git/tags'
import { commit, discard, getStatus, stage, unstage } from '../src/main/git/worktree'
import type { CommitRequest } from '../src/shared/types'
import { makeRepo, type TestRepo } from './helpers/tmpRepo'

let repo: TestRepo
afterEach(() => repo?.cleanup())

const req = (r: Partial<CommitRequest>): CommitRequest => ({
  message: 'msg',
  amend: false,
  signoff: false,
  noVerify: false,
  allowEmpty: false,
  ...r
})

describe('working tree and commits', () => {
  it('commits with custom author, author date and committer date', async () => {
    repo = await makeRepo()
    writeFileSync(join(repo.dir, 'x.txt'), 'x\n')
    await stage(repo.dir, ['x.txt'])
    const sha = await commit(
      repo.dir,
      req({
        message: 'Custom dated\n\nbody',
        author: { name: 'Ada', email: 'ada@example.com' },
        authorDate: { ts: 1_234_567_890, tz: '-0330' },
        committerDate: { ts: 1_234_570_000, tz: '+0900' }
      })
    )
    expect(await repo.git(['log', '-1', '--format=%an|%ae|%ad|%cd|%B', '--date=raw', sha])).toBe(
      'Ada|ada@example.com|1234567890 -0330|1234570000 +0900|Custom dated\n\nbody\n'
    )
  })

  it('amends with a new date', async () => {
    repo = await makeRepo()
    await repo.commit('a.txt', 'a\n', 'A')
    await commit(
      repo.dir,
      req({ message: 'A amended', amend: true, authorDate: { ts: 1_111_111_111, tz: '+0000' } })
    )
    expect(await repo.git(['log', '--format=%ad|%s', '--date=raw'])).toBe(
      '1111111111 +0000|A amended'
    )
  })

  it('reports status for modified, staged, untracked and renamed files', async () => {
    repo = await makeRepo()
    await repo.commit('a.txt', 'a\n', 'A')
    await repo.commit('b.txt', 'b\n', 'B')
    writeFileSync(join(repo.dir, 'a.txt'), 'changed\n')
    writeFileSync(join(repo.dir, 'new file.txt'), 'n\n')
    renameSync(join(repo.dir, 'b.txt'), join(repo.dir, 'b2.txt'))
    await stage(repo.dir, ['b.txt', 'b2.txt'])
    const s = await getStatus(repo.dir)
    expect(s.branch).toBe('main')
    const byPath = Object.fromEntries(s.entries.map((e) => [e.path, e]))
    expect(byPath['a.txt']).toMatchObject({ index: '.', worktree: 'M' })
    expect(byPath['new file.txt']).toMatchObject({ untracked: true })
    expect(byPath['b2.txt']).toMatchObject({ index: 'R', origPath: 'b.txt' })
    await unstage(repo.dir, ['b.txt', 'b2.txt'])
    await discard(repo.dir, ['a.txt'], ['new file.txt'])
    const after = await getStatus(repo.dir)
    expect(after.entries.map((e) => e.path).sort()).toEqual(['b.txt', 'b2.txt'])
  })

  it('creates annotated tags with a custom tagger date and lists refs', async () => {
    repo = await makeRepo()
    const a = await repo.commit('a.txt', 'a\n', 'A')
    await createTag(repo.dir, 'v1.0', a, {
      message: 'Release',
      date: { ts: 1_500_000_000, tz: '+0100' }
    })
    expect(await repo.git(['for-each-ref', '--format=%(taggerdate:raw)', 'refs/tags/v1.0'])).toBe(
      '1500000000 +0100'
    )
    const refs = await refsSnapshot(repo.dir)
    expect(refs.currentBranch).toBe('main')
    expect(refs.tags[0]).toMatchObject({ name: 'v1.0', sha: a, annotated: true })
    const log = await listLog(repo.dir, { limit: 10 })
    expect(log[0].refs.map((r) => `${r.kind}:${r.name}`)).toEqual([
      'head:HEAD',
      'branch:main',
      'tag:v1.0'
    ])
    const detail = await commitDetail(repo.dir, a)
    expect(detail.files).toEqual([{ status: 'A', path: 'a.txt', additions: 1, deletions: 0 }])
  })

  it('returns an empty log for a repository without commits', async () => {
    repo = await makeRepo()
    expect(await listLog(repo.dir, { limit: 10 })).toEqual([])
    expect((await getStatus(repo.dir)).head).toBeNull()
  })
})

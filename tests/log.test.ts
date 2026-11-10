import { afterEach, describe, expect, it } from 'vitest'
import { listLog } from '../src/main/git/log'
import { makeRepo, type TestRepo } from './helpers/tmpRepo'

let repo: TestRepo
afterEach(() => repo?.cleanup())

describe('commit graph scope', () => {
  it('walks all refs, only local branches, or only remote-tracking branches', async () => {
    repo = await makeRepo()
    const base = await repo.commit('a.txt', 'a\n', 'base')
    await repo.git(['update-ref', 'refs/remotes/origin/main', base])

    // A commit only a remote-tracking branch knows about.
    await repo.git(['checkout', '-q', '-b', 'tmp'])
    const remoteOnly = await repo.commit('r.txt', 'r\n', 'remote only')
    await repo.git(['update-ref', 'refs/remotes/origin/feature', remoteOnly])
    // A commit reachable only from a tag.
    await repo.git(['checkout', '-q', base])
    const tagged = await repo.commit('t.txt', 't\n', 'tagged only')
    await repo.git(['tag', 'v1', tagged])
    await repo.git(['checkout', '-q', 'main'])
    await repo.git(['branch', '-q', '-D', 'tmp'])

    await repo.commit('l.txt', 'l\n', 'local only')

    const subjects = async (scope?: 'all' | 'local' | 'remote'): Promise<string[]> =>
      (await listLog(repo.dir, { limit: 50, scope })).map((c) => c.subject).sort()

    expect(await subjects()).toEqual(['base', 'local only', 'remote only', 'tagged only'])
    expect(await subjects('all')).toEqual(await subjects())
    expect(await subjects('local')).toEqual(['base', 'local only'])
    expect(await subjects('remote')).toEqual(['base', 'remote only'])
  })

  it('includes a detached HEAD in the local view but not the remote one', async () => {
    repo = await makeRepo()
    const base = await repo.commit('a.txt', 'a\n', 'base')
    await repo.git(['checkout', '-q', base])
    await repo.commit('d.txt', 'd\n', 'detached')
    expect((await listLog(repo.dir, { limit: 10, scope: 'local' })).map((c) => c.subject)).toEqual([
      'detached',
      'base'
    ])
    expect(await listLog(repo.dir, { limit: 10, scope: 'remote' })).toEqual([])
  })
})

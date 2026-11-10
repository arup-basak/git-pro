import { afterEach, describe, expect, it } from 'vitest'
import {
  createLocalBranches,
  parsePorcelainPush,
  publishBranches,
  setUpstreams,
  trackingReport
} from '../src/main/git/tracking'
import { refsSnapshot } from '../src/main/git/log'
import { splitRemoteRef, trackingOverview } from '../src/shared/tracking'
import type { BranchInfo, RemoteBranchInfo } from '../src/shared/types'
import { makeRepo, type TestRepo } from './helpers/tmpRepo'

const branch = (name: string, extra: Partial<BranchInfo> = {}): BranchInfo => ({
  name,
  sha: 'a'.repeat(40),
  current: false,
  subject: '',
  date: 0,
  ...extra
})
const remoteBranch = (remote: string, name: string): RemoteBranchInfo => ({
  remote,
  name,
  short: `${remote}/${name}`,
  sha: 'b'.repeat(40),
  subject: '',
  date: 0
})

describe('trackingOverview', () => {
  const remotes = [
    { name: 'upstream', fetchUrl: '', pushUrl: '' },
    { name: 'origin', fetchUrl: '', pushUrl: '' }
  ]

  it('classifies every local branch and finds remote-only branches', () => {
    const ov = trackingOverview({
      remotes,
      branches: [
        branch('main', { upstream: 'origin/main', ahead: 0, behind: 0 }),
        branch('merged', { upstream: 'origin/merged', gone: true }),
        branch('shared'),
        branch('local-only')
      ],
      remoteBranches: [
        remoteBranch('origin', 'main'),
        remoteBranch('upstream', 'main'),
        remoteBranch('upstream', 'shared'),
        remoteBranch('origin', 'shared'),
        remoteBranch('origin', 'theirs')
      ]
    })
    expect(ov.defaultRemote).toBe('origin')
    expect(ov.byBranch.get('main')).toEqual({ kind: 'tracking', upstream: 'origin/main' })
    expect(ov.byBranch.get('merged')).toEqual({ kind: 'gone', upstream: 'origin/merged' })
    // origin is preferred over other remotes with the same branch name.
    expect(ov.byBranch.get('shared')).toEqual({ kind: 'unlinked', candidate: 'origin/shared' })
    expect(ov.byBranch.get('local-only')).toEqual({ kind: 'unpublished' })
    expect(ov.issues).toBe(3)
    // upstream/main shares a name with local main, so it can't become a new local branch.
    expect(ov.remoteOnly.map((r) => r.short)).toEqual(['origin/theirs'])
    expect(ov.trackedBy.get('origin/main')).toBe('main')
  })

  it('does not count unpublished branches as issues when there is no remote', () => {
    const ov = trackingOverview({ remotes: [], branches: [branch('main')], remoteBranches: [] })
    expect(ov.defaultRemote).toBeNull()
    expect(ov.byBranch.get('main')).toEqual({ kind: 'unpublished' })
    expect(ov.issues).toBe(0)
  })

  it('splits remote refs using the longest matching remote name', () => {
    const rs = [{ name: 'team' }, { name: 'team/a' }]
    expect(splitRemoteRef('team/a/feature/x', rs)).toEqual({ remote: 'team/a', name: 'feature/x' })
    expect(splitRemoteRef('team/b', rs)).toEqual({ remote: 'team', name: 'b' })
    expect(splitRemoteRef('nowhere/b', rs)).toBeNull()
  })
})

describe('parsePorcelainPush', () => {
  it('reports each destination', () => {
    const out = [
      'To ../remote.git',
      '*\trefs/heads/a:refs/heads/a\t[new branch]',
      '!\trefs/heads/b:refs/heads/feature/b\t[rejected] (fetch first)',
      '=\trefs/heads/c:refs/heads/c\t[up to date]',
      ' \trefs/heads/d:refs/heads/d\t1111111..2222222',
      "branch 'a' set up to track 'origin/a'.",
      'Done'
    ].join('\n')
    const r = parsePorcelainPush(out)
    expect(r.get('a')).toEqual({ ok: true, status: 'new branch' })
    expect(r.get('feature/b')).toEqual({ ok: false, status: 'rejected (fetch first)' })
    expect(r.get('c')).toEqual({ ok: true, status: 'up to date' })
    expect(r.get('d')).toEqual({ ok: true, status: 'updated 1111111..2222222' })
  })
})

describe('branch tracking against a real remote', () => {
  let local: TestRepo
  let remote: TestRepo
  afterEach(() => {
    local?.cleanup()
    remote?.cleanup()
  })

  async function setup(): Promise<void> {
    remote = await makeRepo({ bare: true })
    local = await makeRepo()
    await local.commit('a.txt', 'a\n', 'A')
    await local.git(['remote', 'add', 'origin', remote.dir])
  }

  const upstreamOf = async (b: string): Promise<string> =>
    (await refsSnapshot(local.dir)).branches.find((x) => x.name === b)?.upstream ?? ''

  it('publishes several branches in one push and tracks them', async () => {
    await setup()
    await local.git(['branch', 'feature/one'])
    await local.git(['branch', 'two'])
    const r = await publishBranches(local.dir, 'origin', [
      { branch: 'main', dest: 'main' },
      { branch: 'feature/one', dest: 'feature/one' },
      { branch: 'two', dest: 'renamed' }
    ])
    expect(r.outcomes.every((o) => o.ok)).toBe(true)
    expect(r.outcomes.map((o) => o.status)).toEqual(['new branch', 'new branch', 'new branch'])
    expect(await upstreamOf('main')).toBe('origin/main')
    expect(await upstreamOf('feature/one')).toBe('origin/feature/one')
    expect(await upstreamOf('two')).toBe('origin/renamed')
    expect(await remote.git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'])).toBe(
      ['feature/one', 'main', 'renamed'].join('\n')
    )
    const report = await trackingReport(local.dir)
    expect(report.unpublished).toEqual([])
  })

  it('reports a rejected branch without tracking it, and publishes the rest', async () => {
    await setup()
    await publishBranches(local.dir, 'origin', [{ branch: 'main', dest: 'main' }])
    // Someone else moves the remote "taken" branch; ours is unrelated history.
    const other = await makeRepo()
    try {
      await other.commit('x.txt', 'x\n', 'theirs')
      await other.git(['push', '-q', remote.dir, 'main:refs/heads/taken'])
    } finally {
      other.cleanup()
    }
    await local.git(['branch', 'taken'])
    await local.git(['branch', 'fresh'])
    const r = await publishBranches(local.dir, 'origin', [
      { branch: 'taken', dest: 'taken' },
      { branch: 'fresh', dest: 'fresh' }
    ])
    expect(r.outcomes.find((o) => o.branch === 'taken')).toMatchObject({ ok: false })
    expect(r.outcomes.find((o) => o.branch === 'taken')?.status).toMatch(/rejected/)
    expect(r.outcomes.find((o) => o.branch === 'fresh')).toMatchObject({ ok: true })
    expect(await upstreamOf('taken')).toBe('')
    expect(await upstreamOf('fresh')).toBe('origin/fresh')
  })

  it('refuses two branches published to the same destination', async () => {
    await setup()
    await local.git(['branch', 'b'])
    await expect(
      publishBranches(local.dir, 'origin', [
        { branch: 'main', dest: 'x' },
        { branch: 'b', dest: 'x' }
      ])
    ).rejects.toThrow(/Two branches/)
  })

  it('reports unlinked, gone and remote-only branches, then fixes them', async () => {
    await setup()
    await local.git(['branch', 'linkme'])
    await local.git(['branch', 'doomed'])
    await local.git(['branch', 'theirs'])
    await publishBranches(local.dir, 'origin', [
      { branch: 'main', dest: 'main' },
      { branch: 'doomed', dest: 'doomed' }
    ])
    // linkme and theirs exist on the remote without local tracking.
    await local.git(['push', '-q', 'origin', 'linkme', 'theirs'])
    await local.git(['branch', '-D', 'theirs'])
    await local.commit('b.txt', 'b\n', 'B on main')
    await local.git(['branch', '-f', 'linkme', 'main'])
    // The remote deletes doomed (e.g. a merged pull request), and we prune.
    await remote.git(['branch', '-D', 'doomed'])
    await local.git(['fetch', '-q', '--prune', 'origin'])

    const report = await trackingReport(local.dir)
    expect(report.defaultRemote).toBe('origin')
    expect(report.unpublished.map((b) => b.name)).toEqual([])
    expect(report.unlinked).toEqual([
      expect.objectContaining({ candidate: 'origin/linkme', ahead: 1, behind: 0 })
    ])
    expect(report.gone.map((g) => [g.branch.name, g.upstream])).toEqual([
      ['doomed', 'origin/doomed']
    ])
    expect(report.remoteOnly.map((r) => r.short)).toEqual(['origin/theirs'])

    const linked = await setUpstreams(local.dir, [
      { branch: 'linkme', upstream: 'origin/linkme' },
      { branch: 'doomed', upstream: null },
      { branch: 'main', upstream: 'origin/missing' }
    ])
    expect(linked.done).toEqual(['linkme', 'doomed'])
    expect(linked.failed).toEqual([
      { name: 'main', error: expect.stringMatching(/origin\/missing does not exist/) }
    ])
    expect(await upstreamOf('linkme')).toBe('origin/linkme')
    expect(await upstreamOf('doomed')).toBe('')

    const created = await createLocalBranches(local.dir, [
      { remoteBranch: 'origin/theirs', name: 'theirs' },
      { remoteBranch: 'origin/main', name: 'main' }
    ])
    expect(created.done).toEqual(['theirs'])
    expect(created.failed[0]).toMatchObject({ name: 'main' })
    expect(await upstreamOf('theirs')).toBe('origin/theirs')
    // Nothing was checked out.
    expect(await local.git(['symbolic-ref', '--short', 'HEAD'])).toBe('main')

    const after = await trackingReport(local.dir)
    expect(after.unlinked).toEqual([])
    expect(after.remoteOnly).toEqual([])
    // doomed no longer tracks anything and has no remote counterpart.
    expect(after.unpublished.map((b) => b.name)).toEqual(['doomed'])
  })

  it('publishes a branch again after its upstream was deleted', async () => {
    await setup()
    await local.git(['branch', 'pr'])
    await publishBranches(local.dir, 'origin', [{ branch: 'pr', dest: 'pr' }])
    await remote.git(['branch', '-D', 'pr'])
    await local.git(['fetch', '-q', '--prune', 'origin'])
    expect((await trackingReport(local.dir)).gone.map((g) => g.branch.name)).toEqual(['pr'])
    const r = await publishBranches(local.dir, 'origin', [{ branch: 'pr', dest: 'pr' }])
    expect(r.outcomes[0]).toMatchObject({ ok: true, status: 'new branch' })
    expect((await trackingReport(local.dir)).gone).toEqual([])
  })
})

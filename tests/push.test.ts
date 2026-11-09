import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyPlan, loadRange } from '../src/main/git/history'
import { push } from '../src/main/git/remotes'
import { gitOut } from '../src/main/git/runner'
import type { PushSpec } from '../src/shared/types'
import { makeRepo, type TestRepo } from './helpers/tmpRepo'

let local: TestRepo
let remote: TestRepo
afterEach(() => {
  local?.cleanup()
  remote?.cleanup()
})

const spec = (s: Partial<PushSpec>): PushSpec => ({
  remote: 'origin',
  sourceKind: 'branch',
  source: 'main',
  dest: 'main',
  force: 'none',
  setUpstream: false,
  followTags: false,
  dryRun: false,
  ...s
})

async function setup(): Promise<string[]> {
  remote = await makeRepo({ bare: true })
  local = await makeRepo()
  const shas = [
    await local.commit('a.txt', 'a\n', 'A', 1_700_000_000),
    await local.commit('b.txt', 'b\n', 'B', 1_700_003_600),
    await local.commit('c.txt', 'c\n', 'C', 1_700_007_200)
  ]
  await local.git(['remote', 'add', 'origin', remote.dir])
  return shas
}

describe('push', () => {
  it('pushes any commit to a new remote branch', async () => {
    const [, b] = await setup()
    const res = await push(
      local.dir,
      spec({ sourceKind: 'commit', source: b.slice(0, 10), dest: 'feature/from-b' })
    )
    expect(res.ok).toBe(true)
    expect(await remote.git(['rev-parse', 'refs/heads/feature/from-b'])).toBe(b)
  })

  it('pushes a branch under another name and sets upstream', async () => {
    await setup()
    const res = await push(local.dir, spec({ dest: 'other', setUpstream: true }))
    expect(res.ok).toBe(true)
    expect(await local.git(['rev-parse', '--abbrev-ref', 'main@{upstream}'])).toBe('origin/other')
  })

  it('rejects --force-with-lease when the remote moved since our last fetch', async () => {
    await setup()
    expect((await push(local.dir, spec({}))).ok).toBe(true)
    // Someone else pushes to main.
    const other = mkdtempSync(join(tmpdir(), 'gitpro-other-'))
    await gitOut(other, ['clone', '-q', remote.dir, '.'])
    await gitOut(other, ['commit', '-q', '--allow-empty', '-m', 'theirs'])
    await gitOut(other, ['push', '-q', 'origin', 'main'])
    // We rewrite our main and try to force-push with a lease.
    await local.git(['commit', '-q', '--amend', '-m', 'C amended'])
    const leased = await push(local.dir, spec({ force: 'lease' }))
    expect(leased.ok).toBe(false)
    expect(leased.summary).toMatch(/rejected|stale/)
    // After fetching, the lease matches and the push goes through.
    await local.git(['fetch', '-q', 'origin'])
    expect((await push(local.dir, spec({ force: 'lease' }))).ok).toBe(true)
    expect(await remote.git(['log', '-1', '--format=%s', 'main'])).toBe('C amended')
  })

  it('retimes a commit and pushes the result to a separate remote branch', async () => {
    const [, b] = await setup()
    const range = await loadRange(local.dir, 'main', { sha: null })
    const when = { ts: 1_650_000_000, tz: '+0530' }
    await applyPlan(local.dir, {
      tip: 'main',
      tipSha: range.tipSha,
      baseSha: null,
      rows: range.rows.map((r) => ({
        sha: r.sha,
        action: 'pick',
        ...(r.sha === b ? { authorDate: when, committerDate: when } : {})
      })),
      output: { mode: 'new-branch', name: 'main-retimed' },
      preserveCommitterDates: false,
      resign: false,
      autostash: false
    })
    const res = await push(local.dir, spec({ source: 'main-retimed', dest: 'main-retimed' }))
    expect(res.ok).toBe(true)
    expect(await remote.git(['log', '--format=%ad|%cd|%s', '--date=raw', 'main-retimed'])).toBe(
      '1700007200 +0000|1700007200 +0000|C\n1650000000 +0530|1650000000 +0530|B\n1700000000 +0000|1700000000 +0000|A'
    )
  })
})

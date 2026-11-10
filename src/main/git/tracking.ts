import { trackingOverview } from '../../shared/tracking'
import type {
  BatchResult,
  LocalTrackingBranch,
  PublishItem,
  PublishOutcome,
  PublishResult,
  TrackingReport,
  UpstreamChange
} from '../../shared/types'
import { refsSnapshot } from './log'
import { assertRemote } from './remotes'
import { git, gitOut } from './runner'
import { assertBranchName, assertRefName, assertSafe, refExists } from './util'

async function aheadBehind(cwd: string, local: string, other: string): Promise<[number, number]> {
  const out = await gitOut(cwd, ['rev-list', '--left-right', '--count', `${local}...${other}`])
  const [ahead, behind] = out.split(/\s+/).map(Number)
  return [ahead || 0, behind || 0]
}

export async function trackingReport(cwd: string): Promise<TrackingReport> {
  const snap = await refsSnapshot(cwd)
  const ov = trackingOverview(snap)
  const report: TrackingReport = {
    defaultRemote: ov.defaultRemote,
    unpublished: [],
    unlinked: [],
    gone: [],
    remoteOnly: ov.remoteOnly
  }
  const counts: Array<Promise<void>> = []
  for (const branch of snap.branches) {
    const t = ov.byBranch.get(branch.name)
    if (t?.kind === 'unpublished') report.unpublished.push(branch)
    else if (t?.kind === 'gone') report.gone.push({ branch, upstream: t.upstream })
    else if (t?.kind === 'unlinked') {
      const entry = { branch, candidate: t.candidate, ahead: 0, behind: 0 }
      report.unlinked.push(entry)
      counts.push(
        aheadBehind(cwd, `refs/heads/${branch.name}`, `refs/remotes/${t.candidate}`).then(
          ([ahead, behind]) => {
            entry.ahead = ahead
            entry.behind = behind
          }
        )
      )
    }
  }
  await Promise.all(counts)
  return report
}

const FLAG_LABEL: Record<string, string> = {
  ' ': 'updated',
  '+': 'forced',
  '-': 'deleted',
  '*': 'new branch',
  '=': 'up to date',
  '!': 'rejected'
}

/** Per-destination results from `git push --porcelain` output. */
export function parsePorcelainPush(stdout: string): Map<string, { ok: boolean; status: string }> {
  const out = new Map<string, { ok: boolean; status: string }>()
  for (const line of stdout.split('\n')) {
    const m = /^([ +\-*=!])\t([^\t]+)(?:\t(.*))?$/.exec(line)
    if (!m) continue
    const [, flag, refs, summary = ''] = m
    const dst = refs.slice(refs.indexOf(':') + 1).replace(/^refs\/heads\//, '')
    const status = summary.startsWith('[')
      ? summary.replace(/[[\]]/g, '')
      : `${FLAG_LABEL[flag]}${summary ? ` ${summary}` : ''}`
    out.set(dst, { ok: flag !== '!', status })
  }
  return out
}

/**
 * Pushes local branches to new (or existing) branches on `remote` and makes each one track what
 * it was pushed to. Never forces: a destination that moved is reported as rejected. One `git
 * push` carries every branch, so a batch costs a single connection.
 */
export async function publishBranches(
  cwd: string,
  remote: string,
  items: PublishItem[],
  onProgress?: (line: string) => void
): Promise<PublishResult> {
  if (!items.length) throw new Error('Nothing to publish')
  await assertRemote(cwd, remote)
  const dests = new Set<string>()
  for (const it of items) {
    await assertBranchName(cwd, it.branch)
    if (!(await refExists(cwd, `refs/heads/${it.branch}`))) {
      throw new Error(`Local branch "${it.branch}" does not exist`)
    }
    assertSafe(it.dest, 'remote branch name')
    await assertRefName(cwd, `refs/heads/${it.dest}`)
    if (dests.has(it.dest))
      throw new Error(`Two branches would be published to ${remote}/${it.dest}`)
    dests.add(it.dest)
  }
  const args = [
    'push',
    '--progress',
    '--porcelain',
    '--set-upstream',
    remote,
    ...items.map((i) => `refs/heads/${i.branch}:refs/heads/${i.dest}`)
  ]
  const r = await git(cwd, args, { write: true, allowFail: true, onProgress })
  const reported = parsePorcelainPush(r.stdout)
  const errors = r.stderr
    .split('\n')
    .filter((l) => /^(error|fatal):/.test(l))
    .join('\n')
  if (reported.size === 0 && r.code !== 0) {
    throw new Error(errors || r.stderr.trim() || 'Push failed')
  }
  const outcomes: PublishOutcome[] = items.map((it) => {
    const hit = reported.get(it.dest)
    return { ...it, ok: hit?.ok ?? false, status: hit?.status ?? (errors || 'not pushed') }
  })
  return {
    remote,
    outcomes,
    output: [r.stdout.trim(), r.stderr.trim()].filter(Boolean).join('\n')
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Sets (to an existing remote-tracking branch) or removes the upstream of each branch. */
export async function setUpstreams(cwd: string, changes: UpstreamChange[]): Promise<BatchResult> {
  const res: BatchResult = { done: [], failed: [] }
  for (const c of changes) {
    try {
      await assertBranchName(cwd, c.branch)
      if (c.upstream === null) {
        await git(cwd, ['branch', '--unset-upstream', c.branch], { write: true })
      } else {
        assertSafe(c.upstream, 'upstream')
        const ref = `refs/remotes/${c.upstream}`
        if (!(await refExists(cwd, ref))) {
          throw new Error(`${c.upstream} does not exist (fetch the remote first)`)
        }
        await git(cwd, ['branch', `--set-upstream-to=${ref}`, c.branch], { write: true })
      }
      res.done.push(c.branch)
    } catch (e) {
      res.failed.push({ name: c.branch, error: message(e) })
    }
  }
  return res
}

/** Creates local branches that track remote branches. Nothing is checked out. */
export async function createLocalBranches(
  cwd: string,
  items: LocalTrackingBranch[]
): Promise<BatchResult> {
  const res: BatchResult = { done: [], failed: [] }
  for (const it of items) {
    try {
      await assertBranchName(cwd, it.name)
      assertSafe(it.remoteBranch, 'remote branch')
      const ref = `refs/remotes/${it.remoteBranch}`
      if (!(await refExists(cwd, ref))) throw new Error(`${it.remoteBranch} does not exist`)
      if (await refExists(cwd, `refs/heads/${it.name}`)) {
        throw new Error(`A local branch named "${it.name}" already exists`)
      }
      await git(cwd, ['branch', '--track', it.name, ref], { write: true })
      res.done.push(it.name)
    } catch (e) {
      res.failed.push({ name: it.name, error: message(e) })
    }
  }
  return res
}

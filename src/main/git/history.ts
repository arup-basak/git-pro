import type { HistoryPlan, HistoryRange, HistoryRow, RewriteResult } from '../../shared/types'
import { readRawCommits } from './log'
import { subjectOf } from './parse'
import { rebaseRewrite } from './rebase'
import { metadataRewrite } from './rewrite'
import { git, gitOut } from './runner'
import { assertSafe, refExists, resolveCommit, tryResolve } from './util'

export { hasMetadataEdit } from './plan'

export const MAX_RANGE = 2000

export async function loadRange(
  cwd: string,
  tip: string,
  base: { sha: string | null } | { count: number }
): Promise<HistoryRange> {
  assertSafe(tip, 'tip')
  const tipSha = await resolveCommit(cwd, tip)
  const tipBranch = (await refExists(cwd, `refs/heads/${tip}`)) ? tip : null
  let baseSha: string | null
  if ('count' in base) {
    const n = Math.max(1, Math.floor(base.count))
    baseSha = await tryResolve(cwd, `${tipSha}~${n}^{commit}`)
  } else if (base.sha) {
    baseSha = await resolveCommit(cwd, base.sha)
    const anc = await git(cwd, ['merge-base', '--is-ancestor', baseSha, tipSha], {
      allowFail: true
    })
    if (anc.code !== 0) throw new Error('The base commit is not an ancestor of the tip')
  } else {
    baseSha = null
  }
  const revs = await gitOut(
    cwd,
    [
      'rev-list',
      '--topo-order',
      '--reverse',
      '--parents',
      tipSha,
      ...(baseSha ? [`^${baseSha}`] : [])
    ],
    { quietStdout: true }
  )
  const lines = revs.split('\n').filter(Boolean)
  if (lines.length > MAX_RANGE) {
    throw new Error(`The range has ${lines.length} commits; narrow it to at most ${MAX_RANGE}.`)
  }
  const order = lines.map((l) => l.split(' '))
  const raws = await readRawCommits(
    cwd,
    order.map((o) => o[0])
  )
  const rows: HistoryRow[] = order.map(([sha, ...parents]) => {
    const raw = raws.get(sha)!
    const message = raw.message.toString('utf8')
    return {
      sha,
      parents,
      subject: subjectOf(message),
      message,
      author: raw.author,
      committer: raw.committer,
      signed: raw.signed,
      isMerge: parents.length > 1
    }
  })
  return { tipSha, tipBranch, baseSha, rows, truncated: false }
}

/** True when the plan keeps every commit, in its original order (so no rebase is needed). */
export function isMetadataOnly(range: HistoryRange, plan: HistoryPlan): boolean {
  if (plan.rows.length !== range.rows.length) return false
  return plan.rows.every((r, i) => r.action === 'pick' && r.sha === range.rows[i].sha)
}

export async function applyPlan(
  cwd: string,
  plan: HistoryPlan,
  onProgress?: (line: string) => void
): Promise<RewriteResult> {
  const range = await loadRange(cwd, plan.tip, { sha: plan.baseSha })
  if (range.tipSha !== plan.tipSha) {
    throw new Error(
      `${plan.tip} moved since the editor was opened. Reload the range and try again.`
    )
  }
  const inRange = new Set(range.rows.map((r) => r.sha))
  const seen = new Set<string>()
  for (const r of plan.rows) {
    if (!inRange.has(r.sha) || seen.has(r.sha))
      throw new Error(`Plan row ${r.sha} is not valid for this range`)
    seen.add(r.sha)
  }
  if (seen.size !== inRange.size) throw new Error('The plan must list every commit in the range')
  if (plan.output.mode === 'in-place' && !range.tipBranch) {
    throw new Error('In-place rewrite needs the tip to be a local branch')
  }
  if (isMetadataOnly(range, plan)) return metadataRewrite(cwd, range, plan)
  return rebaseRewrite(cwd, range, plan, onProgress)
}

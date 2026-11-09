import { toGitDateArg } from '../../shared/dates'
import type { HistoryPlan, HistoryRange, RewriteResult, RowEdit } from '../../shared/types'
import { createBackup } from './backup'
import { hasMetadataEdit, refsContaining } from './plan'
import { readRawCommits } from './log'
import { git, gitOut } from './runner'
import { assertPerson } from './worktree'
import { assertBranchName, refExists } from './util'

/** Normalizes an edited message the way `git commit --cleanup=whitespace` would. */
export function normalizeMessage(msg: string): string {
  const lines = msg
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
  while (lines.length && lines[0] === '') lines.shift()
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  const collapsed: string[] = []
  for (const l of lines) {
    if (l === '' && collapsed[collapsed.length - 1] === '') continue
    collapsed.push(l)
  }
  if (collapsed.length === 0) throw new Error('Commit message cannot be empty')
  return collapsed.join('\n') + '\n'
}

/**
 * Rewrites commit metadata (author/committer identity and dates, message) for every edited
 * commit in the range by re-creating commits with `git commit-tree` on the original trees.
 * Descendants are re-parented. Trees are never touched, so this cannot conflict and leaves the
 * working tree alone.
 */
export async function metadataRewrite(
  cwd: string,
  range: HistoryRange,
  plan: HistoryPlan
): Promise<RewriteResult> {
  const edits = new Map<string, RowEdit>()
  for (const r of plan.rows) if (hasMetadataEdit(r)) edits.set(r.sha, r)
  if (edits.size === 0) throw new Error('Nothing to change: no commit was edited')

  for (const e of edits.values()) {
    if (e.author) assertPerson(e.author)
    if (e.committer) assertPerson(e.committer)
    if (e.authorDate) toGitDateArg(e.authorDate)
    if (e.committerDate) toGitDateArg(e.committerDate)
  }

  // Validate the output target before creating any objects.
  if (plan.output.mode === 'new-branch') {
    await assertBranchName(cwd, plan.output.name)
    if (await refExists(cwd, `refs/heads/${plan.output.name}`)) {
      throw new Error(`Branch "${plan.output.name}" already exists`)
    }
  }

  const raws = await readRawCommits(
    cwd,
    range.rows.map((r) => r.sha)
  )
  const map = new Map<string, string>()
  const rewrittenRoots: string[] = []

  for (const row of range.rows) {
    const raw = raws.get(row.sha)!
    const parents = row.parents.map((p) => map.get(p) ?? p)
    const parentsChanged = parents.some((p, i) => p !== row.parents[i])
    const edit = edits.get(row.sha)
    if (!edit && !parentsChanged) continue
    if (!parentsChanged) rewrittenRoots.push(row.sha)

    const author = edit?.author ?? raw.author
    const authorDate = edit?.authorDate ?? raw.author.date
    const committer = edit?.committer ?? raw.committer
    const committerDate = edit?.committerDate ?? raw.committer.date
    const message =
      edit?.message !== undefined
        ? Buffer.from(normalizeMessage(edit.message), 'utf8')
        : raw.message

    const args: string[] = []
    if (edit?.message === undefined && raw.encoding)
      args.push('-c', `i18n.commitEncoding=${raw.encoding}`)
    args.push('commit-tree', raw.tree)
    for (const p of parents) args.push('-p', p)
    args.push(plan.resign ? '-S' : '--no-gpg-sign', '-F', '-')

    const newSha = await gitOut(cwd, args, {
      input: message,
      env: {
        GIT_AUTHOR_NAME: author.name,
        GIT_AUTHOR_EMAIL: author.email,
        GIT_AUTHOR_DATE: toGitDateArg(authorDate),
        GIT_COMMITTER_NAME: committer.name,
        GIT_COMMITTER_EMAIL: committer.email,
        GIT_COMMITTER_DATE: toGitDateArg(committerDate)
      }
    })
    map.set(row.sha, newSha)
  }

  const oldTip = range.tipSha
  const newTip = map.get(oldTip) ?? oldTip
  const mapping = [...map.entries()].map(([o, n]) => ({ old: o, new: n }))
  if (newTip === oldTip) {
    throw new Error('The edits did not change any commit reachable from the tip')
  }

  let branch: string
  let backupRef: string | null = null
  if (plan.output.mode === 'new-branch') {
    branch = plan.output.name
    await git(cwd, ['branch', branch, newTip], { write: true })
  } else {
    branch = range.tipBranch!
    backupRef = await createBackup(cwd, branch, oldTip, 'rewrite')
    // Compare-and-swap: fails if the branch moved after we read it.
    await git(
      cwd,
      [
        'update-ref',
        '-m',
        'git-pro: rewrite commit metadata',
        `refs/heads/${branch}`,
        newTip,
        oldTip
      ],
      { write: true }
    )
  }

  const changed = mapping.filter((m) => m.old !== m.new)
  const staleRefs = await refsContaining(cwd, rewrittenRoots, [`refs/heads/${branch}`])
  return {
    engine: 'metadata',
    status: 'done',
    branch,
    oldTip,
    newTip,
    mapping: changed,
    backupRef,
    staleRefs,
    message: `Rewrote ${changed.length} commit${changed.length === 1 ? '' : 's'} on ${branch}`
  }
}

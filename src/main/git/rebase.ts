import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { toGitDateArg } from '../../shared/dates'
import type { HistoryPlan, HistoryRange, RewriteResult, RowEdit } from '../../shared/types'
import { createBackup } from './backup'
import { detectOp } from './opstate'
import { hasMetadataEdit, refsContaining } from './plan'
import { normalizeMessage } from './rewrite'
import { git, gitOut, shQuote } from './runner'
import { assertBranchName, currentBranch, gitDir, isDirty, refExists } from './util'
import { assertPerson } from './worktree'

interface Group {
  pick: RowEdit
  members: RowEdit[]
}

function cleanupOldRuns(root: string): void {
  try {
    const week = 7 * 24 * 3600 * 1000
    for (const name of readdirSync(root)) {
      const p = join(root, name)
      if (name.startsWith('rebase-') && Date.now() - statSync(p).mtimeMs > week) {
        rmSync(p, { recursive: true, force: true })
      }
    }
  } catch {
    // nothing to clean
  }
}

/** Builds the sequencer todo plus helper scripts that apply metadata edits after each group. */
export function buildTodo(
  dir: string,
  groups: Group[],
  dropped: RowEdit[],
  original: Map<string, { committerDate: string }>,
  plan: Pick<HistoryPlan, 'preserveCommitterDates' | 'resign'>
): string {
  const todo: string[] = []
  groups.forEach((g, i) => {
    const e = g.pick
    const needsAmend = hasMetadataEdit(e) || plan.preserveCommitterDates || plan.resign
    const mark = join(dir, `mark-${i}`)
    if (needsAmend) {
      writeFileSync(
        join(dir, `pre-${i}.sh`),
        `( git rev-parse -q --verify HEAD || echo none ) > ${shQuote(mark)}\n`
      )
      todo.push(`exec sh ${shQuote(join(dir, `pre-${i}.sh`))}`)
    }
    todo.push(`pick ${e.sha}`)
    for (const m of g.members) todo.push(`${m.action === 'fixup' ? 'fixup' : 'squash'} ${m.sha}`)
    if (!needsAmend) return

    const lines = [
      'set -e',
      `before="$(cat ${shQuote(mark)})"`,
      'now="$(git rev-parse -q --verify HEAD || echo none)"'
    ]
    // If the pick was skipped or became empty and was dropped, HEAD did not move: do nothing.
    lines.push('[ "$before" = "$now" ] && exit 0')
    const committerDate = e.committerDate
      ? toGitDateArg(e.committerDate)
      : plan.preserveCommitterDates
        ? original.get(e.sha)!.committerDate
        : null
    if (committerDate) lines.push(`export GIT_COMMITTER_DATE=${shQuote(committerDate)}`)
    if (e.committer) {
      lines.push(`export GIT_COMMITTER_NAME=${shQuote(e.committer.name)}`)
      lines.push(`export GIT_COMMITTER_EMAIL=${shQuote(e.committer.email)}`)
    }
    const args = ['git', 'commit', '--amend', '--allow-empty', '--no-verify', '--quiet']
    if (plan.resign) args.push('-S')
    if (e.message !== undefined) {
      const msgFile = join(dir, `msg-${i}.txt`)
      writeFileSync(msgFile, normalizeMessage(e.message))
      args.push('--cleanup=verbatim', '-F', shQuote(msgFile))
    } else {
      args.push('--no-edit')
    }
    if (e.authorDate) args.push(`--date=${shQuote(toGitDateArg(e.authorDate))}`)
    if (e.author) args.push(`--author=${shQuote(`${e.author.name} <${e.author.email}>`)}`)
    lines.push(args.join(' '))
    writeFileSync(join(dir, `post-${i}.sh`), lines.join('\n') + '\n')
    todo.push(`exec sh ${shQuote(join(dir, `post-${i}.sh`))}`)
  })
  for (const d of dropped) todo.push(`drop ${d.sha}`)
  return todo.join('\n') + '\n'
}

/**
 * Structural rewrite (reorder / drop / squash / fixup, plus metadata edits) using
 * `git rebase -i` with a generated todo list. May stop on conflicts; the caller surfaces the
 * in-progress rebase so the user can continue, skip or abort.
 */
export async function rebaseRewrite(
  cwd: string,
  range: HistoryRange,
  plan: HistoryPlan,
  onProgress?: (line: string) => void
): Promise<RewriteResult> {
  if (range.rows.some((r) => r.isMerge)) {
    throw new Error(
      'This range contains merge commits. Reordering, dropping or squashing across merges is not supported. You can still edit dates, authors and messages.'
    )
  }
  const firstKept = plan.rows.find((r) => r.action !== 'drop')
  if (!firstKept) throw new Error('You cannot drop every commit in the range')
  if (firstKept.action !== 'pick') {
    throw new Error('The oldest kept commit must be "pick": squash/fixup need a commit before them')
  }
  for (const r of plan.rows) {
    if (r.author) assertPerson(r.author)
    if (r.committer) assertPerson(r.committer)
    if (r.authorDate) toGitDateArg(r.authorDate)
    if (r.committerDate) toGitDateArg(r.committerDate)
  }
  const op = await detectOp(cwd, [])
  if (op.kind !== 'none') throw new Error(`Finish or abort the ${op.kind} in progress first`)
  if (!plan.autostash && (await isDirty(cwd))) {
    throw new Error(
      'You have uncommitted changes. Commit or stash them first, or enable autostash.'
    )
  }

  let branch: string
  let backupRef: string | null = null
  if (plan.output.mode === 'new-branch') {
    branch = plan.output.name
    await assertBranchName(cwd, branch)
    if (await refExists(cwd, `refs/heads/${branch}`))
      throw new Error(`Branch "${branch}" already exists`)
    await git(cwd, ['branch', branch, range.tipSha], { write: true })
  } else {
    branch = range.tipBranch!
    backupRef = await createBackup(cwd, branch, range.tipSha, 'rebase')
  }

  const groups: Group[] = []
  const dropped: RowEdit[] = []
  for (const r of plan.rows) {
    if (r.action === 'drop') dropped.push(r)
    else if (r.action === 'pick') groups.push({ pick: r, members: [] })
    else groups[groups.length - 1].members.push(r)
  }
  const original = new Map(
    range.rows.map((r) => [r.sha, { committerDate: toGitDateArg(r.committer.date) }])
  )
  const root = join(await gitDir(cwd), 'git-pro')
  cleanupOldRuns(root)
  const dir = join(root, `rebase-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  const todoPath = join(dir, 'todo')
  writeFileSync(todoPath, buildTodo(dir, groups, dropped, original, plan))

  const args = [
    'rebase',
    '--interactive',
    '--empty=drop',
    '--no-autosquash',
    '--no-update-refs',
    plan.autostash ? '--autostash' : '--no-autostash',
    range.baseSha ?? '--root',
    branch
  ]
  const r = await git(cwd, args, {
    write: true,
    allowFail: true,
    onProgress,
    env: { GIT_SEQUENCE_EDITOR: `cp ${shQuote(todoPath)}`, GIT_EDITOR: 'true' }
  })

  if (r.code !== 0) {
    const after = await detectOp(cwd, [])
    if (after.kind === 'rebase') {
      return {
        engine: 'rebase',
        status: 'conflict',
        branch,
        oldTip: range.tipSha,
        newTip: null,
        mapping: [],
        backupRef,
        staleRefs: [],
        message:
          'The rebase stopped (usually a conflict). Resolve the files, stage them, then Continue, or Abort to undo.\n' +
          r.stderr.trim()
      }
    }
    // The rebase never started: undo the branch we created so the user can retry.
    if (plan.output.mode === 'new-branch' && (await currentBranch(cwd)) !== branch) {
      await git(cwd, ['branch', '-D', branch], { write: true, allowFail: true })
    }
    throw new Error(r.stderr.trim() || 'git rebase failed')
  }
  rmSync(dir, { recursive: true, force: true })

  const newTip = await gitOut(cwd, ['rev-parse', `refs/heads/${branch}`])
  const newList = (
    await gitOut(cwd, [
      'rev-list',
      '--reverse',
      range.baseSha ? `${range.baseSha}..${newTip}` : newTip
    ])
  )
    .split('\n')
    .filter(Boolean)
  const mapping =
    newList.length === groups.length
      ? groups.map((g, i) => ({ old: g.pick.sha, new: newList[i] })).filter((m) => m.old !== m.new)
      : []
  const firstChanged = mapping[0]?.old ?? plan.rows[0].sha
  const staleRefs = await refsContaining(cwd, [firstChanged], [`refs/heads/${branch}`])
  return {
    engine: 'rebase',
    status: 'done',
    branch,
    oldTip: range.tipSha,
    newTip,
    mapping,
    backupRef,
    staleRefs,
    message: `Rebased ${branch}: ${range.rows.length} → ${newList.length} commits`
  }
}

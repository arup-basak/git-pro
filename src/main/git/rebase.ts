import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { toGitDateArg } from '../../shared/dates'
import type { HistoryPlan, HistoryRange, OpState, RewriteResult, RowEdit } from '../../shared/types'
import { createBackup } from './backup'
import { NON_INTERACTIVE_EDITOR, abortOp, continueOp, detectOp, skipOp } from './opstate'
import { hasMetadataEdit, refsContaining } from './plan'
import { normalizeMessage } from './rewrite'
import { git, gitOut, shQuote } from './runner'
import { assertBranchName, currentBranch, gitDir, isDirty, refExists } from './util'
import { assertPerson, getStatus } from './worktree'

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
    todo.push(`${e.action === 'edit' ? 'edit' : 'pick'} ${e.sha}`)
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
  if (firstKept.action !== 'pick' && firstKept.action !== 'edit') {
    throw new Error(
      'The oldest kept commit must be "pick" or "edit": squash/fixup need a commit before them'
    )
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
    else if (r.action === 'pick' || r.action === 'edit') groups.push({ pick: r, members: [] })
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
  const run: RunRecord = {
    dir,
    branch,
    oldTip: range.tipSha,
    baseSha: range.baseSha,
    picks: groups.map((g) => g.pick.sha),
    firstRow: plan.rows[0].sha,
    rowCount: range.rows.length,
    backupRef
  }
  writeFileSync(join(dir, 'run.json'), JSON.stringify(run))
  writeFileSync(join(root, ACTIVE_RUN), dir)

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

  // git exits 0 when it pauses at an `edit` line, so always look at the repository state.
  const after = (await getStatus(cwd)).op
  if (after.kind === 'rebase') return stoppedResult(run, after, r.stderr)
  if (r.code !== 0) {
    clearActiveRun(root, dir)
    // The rebase never started: undo the branch we created so the user can retry.
    if (plan.output.mode === 'new-branch' && (await currentBranch(cwd)) !== branch) {
      await git(cwd, ['branch', '-D', branch], { write: true, allowFail: true })
    }
    throw new Error(r.stderr.trim() || 'git rebase failed')
  }
  return finishRun(cwd, run)
}

/* ---------------- runs that pause (edit stops, conflicts) ---------------- */

/** What is needed to report a History-editor rebase once it finishes (possibly much later). */
interface RunRecord {
  dir: string
  branch: string
  oldTip: string
  baseSha: string | null
  /** SHAs of the group heads (pick/edit), oldest first. */
  picks: string[]
  firstRow: string
  rowCount: number
  backupRef: string | null
}

/** File in <git-dir>/git-pro naming the run directory of the rebase in progress. */
const ACTIVE_RUN = 'active-rebase'

function clearActiveRun(root: string, dir: string): void {
  rmSync(dir, { recursive: true, force: true })
  try {
    if (readFileSync(join(root, ACTIVE_RUN), 'utf8') === dir) rmSync(join(root, ACTIVE_RUN))
  } catch {
    // no pointer
  }
}

/** The History-editor run behind the rebase in progress, if this rebase is one. */
async function activeRun(cwd: string): Promise<RunRecord | null> {
  const dir = await gitDir(cwd)
  const root = join(dir, 'git-pro')
  try {
    const runDir = readFileSync(join(root, ACTIVE_RUN), 'utf8')
    const run = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')) as RunRecord
    const head = readFileSync(join(dir, 'rebase-merge', 'head-name'), 'utf8').trim()
    if (head === `refs/heads/${run.branch}`) return run
    clearActiveRun(root, runDir) // left over from a rebase finished or aborted elsewhere
  } catch {
    // none
  }
  return null
}

function stoppedResult(run: RunRecord, op: OpState, stderr: string): RewriteResult {
  const editing = op.rebaseStop === 'edit'
  return {
    engine: 'rebase',
    status: editing ? 'paused' : 'conflict',
    branch: run.branch,
    oldTip: run.oldTip,
    newTip: null,
    mapping: [],
    backupRef: run.backupRef,
    staleRefs: [],
    message: editing
      ? `Stopped at ${op.stoppedSha?.slice(0, 8) ?? 'the commit'} to edit it. Change files, stage them, then Continue to amend the commit.`
      : 'The rebase stopped (usually a conflict). Resolve the files, stage them, then Continue, or Abort to undo.\n' +
        stderr.trim()
  }
}

/** Reports a completed run: the new tip, old → new mapping and refs left on the old history. */
async function finishRun(cwd: string, run: RunRecord): Promise<RewriteResult> {
  clearActiveRun(join(await gitDir(cwd), 'git-pro'), run.dir)
  const newTip = await gitOut(cwd, ['rev-parse', `refs/heads/${run.branch}`])
  const newList = (
    await gitOut(cwd, ['rev-list', '--reverse', run.baseSha ? `${run.baseSha}..${newTip}` : newTip])
  )
    .split('\n')
    .filter(Boolean)
  const mapping =
    newList.length === run.picks.length
      ? run.picks.map((old, i) => ({ old, new: newList[i] })).filter((m) => m.old !== m.new)
      : []
  const firstChanged = mapping[0]?.old ?? run.firstRow
  const staleRefs = await refsContaining(cwd, [firstChanged], [`refs/heads/${run.branch}`])
  return {
    engine: 'rebase',
    status: 'done',
    branch: run.branch,
    oldTip: run.oldTip,
    newTip,
    mapping,
    backupRef: run.backupRef,
    staleRefs,
    message: `Rebased ${run.branch}: ${run.rowCount} → ${newList.length} commits`
  }
}

function rebaseStep(dir: string): string | null {
  try {
    return readFileSync(join(dir, 'rebase-merge', 'msgnum'), 'utf8').trim()
  } catch {
    return null
  }
}

/**
 * Continue (or skip) the operation in progress. For a rebase started by the History editor,
 * returns the finished rewrite once the last step completes; otherwise null.
 */
export async function stepOperation(
  cwd: string,
  action: 'continue' | 'skip'
): Promise<RewriteResult | null> {
  const op = await detectOp(cwd, [])
  if (op.kind !== 'rebase') {
    if (action === 'continue') await continueOp(cwd)
    else await skipOp(cwd)
    return null
  }
  const status = await getStatus(cwd)
  if (
    action === 'continue' &&
    (status.op.rebaseStop === 'edit' || status.op.rebaseStop === 'break') &&
    status.entries.some((e) => !e.untracked && e.worktree !== '.')
  ) {
    throw new Error(
      'You have unstaged changes. Stage what belongs in this commit, stash or discard the rest, then Continue.'
    )
  }
  const run = await activeRun(cwd)
  const dir = await gitDir(cwd)
  const before = rebaseStep(dir)
  const r = await git(cwd, ['rebase', action === 'continue' ? '--continue' : '--skip'], {
    write: true,
    allowFail: true,
    env: NON_INTERACTIVE_EDITOR
  })
  const after = (await getStatus(cwd)).op
  if (after.kind === 'rebase') {
    // Still on the same step: git refused (unresolved conflicts, unstaged changes…).
    if (r.code !== 0 && rebaseStep(dir) === before) {
      throw new Error(r.stderr.trim() || r.stdout.trim() || `git rebase --${action} failed`)
    }
    return null
  }
  if (r.code !== 0) throw new Error(r.stderr.trim() || `git rebase --${action} failed`)
  return run ? finishRun(cwd, run) : null
}

/** Aborts the operation in progress and forgets its History-editor run, if any. */
export async function abortOperation(cwd: string): Promise<void> {
  const run = (await detectOp(cwd, [])).kind === 'rebase' ? await activeRun(cwd) : null
  await abortOp(cwd)
  if (run) clearActiveRun(join(await gitDir(cwd), 'git-pro'), run.dir)
}

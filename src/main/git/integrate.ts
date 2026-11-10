import type {
  BranchMergeRequest,
  IntegrateOutput,
  IntegrateResult,
  MergeMode,
  MergePreview,
  RebaseOntoRequest,
  RebasePreview
} from '../../shared/types'
import { createBackup } from './backup'
import { mergeTrees } from './mergeTree'
import { NON_INTERACTIVE_EDITOR, detectOp } from './opstate'
import { FS } from './parse'
import { git, gitOut } from './runner'
import {
  assertBranchName,
  assertSafe,
  currentBranch,
  isDirty,
  refExists,
  resolveCommit
} from './util'
import { getStatus } from './worktree'

/** True when `a` is an ancestor of (or equal to) `b`. */
export async function isAncestor(cwd: string, a: string, b: string): Promise<boolean> {
  const r = await git(cwd, ['merge-base', '--is-ancestor', a, b], { allowFail: true })
  if (r.code > 1) throw new Error(r.stderr.trim() || 'git merge-base failed')
  return r.code === 0
}

async function mergeBase(cwd: string, a: string, b: string): Promise<string> {
  const r = await git(cwd, ['merge-base', a, b], { allowFail: true })
  if (r.code !== 0) throw new Error('These histories have no commit in common')
  return r.stdout.trim()
}

async function assertNoOperation(cwd: string): Promise<void> {
  const op = await detectOp(cwd, [])
  if (op.kind !== 'none') throw new Error(`Finish or abort the ${op.kind} in progress first`)
}

/** Validates a new-branch output name. */
async function assertNewBranch(cwd: string, output: IntegrateOutput): Promise<void> {
  if (output.mode !== 'new-branch') return
  await assertBranchName(cwd, output.name)
  if (await refExists(cwd, `refs/heads/${output.name}`)) {
    throw new Error(`Branch "${output.name}" already exists`)
  }
}

/** git's default merge message for a source ref. */
async function defaultMergeMessage(cwd: string, source: string, target: string): Promise<string> {
  if (await refExists(cwd, `refs/heads/${source}`)) return `Merge branch '${source}' into ${target}`
  if (await refExists(cwd, `refs/remotes/${source}`)) {
    return `Merge remote-tracking branch '${source}' into ${target}`
  }
  if (await refExists(cwd, `refs/tags/${source}`)) return `Merge tag '${source}' into ${target}`
  return `Merge commit '${source.slice(0, 12)}' into ${target}`
}

async function squashMessage(cwd: string, source: string, range: string): Promise<string> {
  const subjects = await gitOut(cwd, ['log', '--format=* %s', '--reverse', range])
  return `Squashed '${source}'\n\n${subjects}`
}

/* ---------------- merge ---------------- */

export async function mergePreview(
  cwd: string,
  source: string,
  target: string
): Promise<MergePreview> {
  assertSafe(source, 'source')
  await assertBranchName(cwd, target)
  const sourceSha = await resolveCommit(cwd, source)
  const targetSha = await resolveCommit(cwd, `refs/heads/${target}`)
  const base = await mergeBase(cwd, targetSha, sourceSha)
  const [upToDate, fastForward] = await Promise.all([
    isAncestor(cwd, sourceSha, targetSha),
    isAncestor(cwd, targetSha, sourceSha)
  ])
  const ahead = Number(await gitOut(cwd, ['rev-list', '--count', `${targetSha}..${sourceSha}`]))
  const merged = await mergeTrees(cwd, base, targetSha, sourceSha)
  const ns = (
    await gitOut(cwd, [
      'diff-tree',
      '-r',
      '-z',
      '--name-status',
      '--no-renames',
      targetSha,
      merged.tree
    ])
  ).split('\0')
  const files: MergePreview['files'] = []
  for (let i = 0; i + 1 < ns.length; i += 2) {
    if (ns[i] && ns[i + 1]) files.push({ status: ns[i], path: ns[i + 1] })
  }
  const tree = (rev: string): Promise<string> => gitOut(cwd, ['rev-parse', `${rev}^{tree}`])
  return {
    source,
    target,
    sourceSha,
    targetSha,
    upToDate,
    fastForward,
    ahead,
    clean: merged.clean,
    conflicted: [...merged.conflicted].sort(),
    files,
    targetCheckedOut: (await currentBranch(cwd)) === target,
    trees: {
      base: await tree(base),
      ours: await tree(targetSha),
      theirs: await tree(sourceSha),
      result: merged.tree
    }
  }
}

const MODE_FLAG: Record<MergeMode, string> = {
  ff: '--ff',
  'no-ff': '--no-ff',
  'ff-only': '--ff-only',
  squash: '--squash'
}

/**
 * Merges `source` into `target` (or into a new branch made from `target`).
 *
 * - On the checked-out branch (or with `checkout`), this is `git merge`; conflicts stop the
 *   merge for the merge editor, as usual.
 * - On a branch that is not checked out, the merge is done without touching the working tree
 *   (merge-tree + commit-tree), and refused if it would conflict.
 *
 * An in-place merge records a backup of the target first.
 */
export async function mergeBranch(cwd: string, req: BranchMergeRequest): Promise<IntegrateResult> {
  assertSafe(req.source, 'source')
  await assertBranchName(cwd, req.target)
  if (!MODE_FLAG[req.mode]) throw new Error('Unknown merge mode')
  await assertNoOperation(cwd)
  await assertNewBranch(cwd, req.output)
  const sourceSha = await resolveCommit(cwd, req.source)
  const targetSha = await resolveCommit(cwd, `refs/heads/${req.target}`)
  const branch = req.output.mode === 'new-branch' ? req.output.name : req.target
  const newBranch = req.output.mode === 'new-branch'

  if (await isAncestor(cwd, sourceSha, targetSha)) {
    if (newBranch) await git(cwd, ['branch', branch, targetSha], { write: true })
    return {
      status: 'up-to-date',
      branch,
      oldTip: targetSha,
      newTip: targetSha,
      backupRef: null,
      message: `${req.target} already contains ${req.source}`
    }
  }
  const canFastForward = await isAncestor(cwd, targetSha, sourceSha)
  if (req.mode === 'ff-only' && !canFastForward) {
    throw new Error(
      `${req.target} cannot be fast-forwarded to ${req.source}: the histories have diverged`
    )
  }
  const message =
    req.message?.trim() ||
    (req.mode === 'squash'
      ? await squashMessage(cwd, req.source, `${targetSha}..${sourceSha}`)
      : await defaultMergeMessage(cwd, req.source, branch))

  const current = await currentBranch(cwd)
  if (current === branch || req.checkout) {
    return mergeInWorktree(cwd, req, { branch, targetSha, message, current })
  }
  return mergeWithoutCheckout(cwd, req, { branch, targetSha, sourceSha, message, canFastForward })
}

async function mergeInWorktree(
  cwd: string,
  req: BranchMergeRequest,
  ctx: { branch: string; targetSha: string; message: string; current: string | null }
): Promise<IntegrateResult> {
  const { branch, targetSha, message } = ctx
  let backupRef: string | null = null
  if (req.output.mode === 'new-branch') {
    await git(cwd, ['switch', '-c', branch, targetSha], { write: true })
  } else {
    if (ctx.current !== branch) await git(cwd, ['switch', branch], { write: true })
    backupRef = await createBackup(cwd, branch, targetSha, 'merge')
  }
  const r = await git(cwd, ['merge', MODE_FLAG[req.mode], '-m', message, req.source], {
    write: true,
    allowFail: true,
    env: NON_INTERACTIVE_EDITOR
  })
  const status = await getStatus(cwd)
  const conflicted = status.entries.filter((e) => e.conflicted).map((e) => e.path)
  if (r.code !== 0) {
    if (conflicted.length) {
      return {
        status: 'conflict',
        branch,
        oldTip: targetSha,
        newTip: null,
        backupRef,
        message:
          `Merging ${req.source} into ${branch} stopped on ${conflicted.length} conflicted file${conflicted.length === 1 ? '' : 's'}. ` +
          (req.mode === 'squash'
            ? 'Resolve them, then commit the squashed result.'
            : 'Resolve them, then Continue, or Abort.')
      }
    }
    if (backupRef) await git(cwd, ['update-ref', '-d', backupRef], { write: true })
    throw new Error(r.stderr.trim() || r.stdout.trim() || 'git merge failed')
  }
  if (req.mode === 'squash') {
    // --squash stages the result; record it as one commit.
    await git(cwd, ['commit', '--no-verify', '-F', '-'], {
      write: true,
      input: message,
      env: NON_INTERACTIVE_EDITOR
    })
  }
  const newTip = await gitOut(cwd, ['rev-parse', `refs/heads/${branch}`])
  return {
    status: 'done',
    branch,
    oldTip: targetSha,
    newTip,
    backupRef,
    message: `Merged ${req.source} into ${branch}`
  }
}

async function mergeWithoutCheckout(
  cwd: string,
  req: BranchMergeRequest,
  ctx: {
    branch: string
    targetSha: string
    sourceSha: string
    message: string
    canFastForward: boolean
  }
): Promise<IntegrateResult> {
  const { branch, targetSha, sourceSha, message, canFastForward } = ctx
  let newTip: string
  if (canFastForward && (req.mode === 'ff' || req.mode === 'ff-only')) {
    newTip = sourceSha
  } else {
    const base = await mergeBase(cwd, targetSha, sourceSha)
    const merged = await mergeTrees(cwd, base, targetSha, sourceSha)
    if (!merged.clean) {
      throw new Error(
        `Merging ${req.source} into ${branch} conflicts in ${[...merged.conflicted].join(', ')}. Check the branch out to merge there and resolve the conflicts.`
      )
    }
    const parents = req.mode === 'squash' ? ['-p', targetSha] : ['-p', targetSha, '-p', sourceSha]
    newTip = await gitOut(cwd, ['commit-tree', merged.tree, ...parents, '-F', '-'], {
      input: message
    })
  }
  let backupRef: string | null = null
  if (req.output.mode === 'new-branch') {
    await git(cwd, ['branch', branch, newTip], { write: true })
  } else {
    backupRef = await createBackup(cwd, branch, targetSha, 'merge')
    // Compare-and-swap: refuse if the branch moved since we read it.
    await git(
      cwd,
      [
        'update-ref',
        '-m',
        `git-pro: merge ${req.source}`,
        `refs/heads/${branch}`,
        newTip,
        targetSha
      ],
      { write: true }
    )
  }
  return {
    status: 'done',
    branch,
    oldTip: targetSha,
    newTip,
    backupRef,
    message: `Merged ${req.source} into ${branch} (working tree untouched)`
  }
}

/* ---------------- rebase onto ---------------- */

export async function rebasePreview(
  cwd: string,
  branch: string,
  onto: string
): Promise<RebasePreview> {
  await assertBranchName(cwd, branch)
  assertSafe(onto, 'new base')
  const branchSha = await resolveCommit(cwd, `refs/heads/${branch}`)
  const ontoSha = await resolveCommit(cwd, onto)
  const range = `${ontoSha}..${branchSha}`
  const out = await gitOut(cwd, [
    'log',
    '--no-merges',
    '--reverse',
    '-n',
    '1000',
    `--format=%H${FS}%s`,
    range
  ])
  const merges = Number(await gitOut(cwd, ['rev-list', '--merges', '--count', range]))
  return {
    branch,
    onto,
    branchSha,
    ontoSha,
    commits: out
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [sha, subject] = l.split(FS)
        return { sha, subject }
      }),
    upToDate: await isAncestor(cwd, ontoSha, branchSha),
    hasMerges: merges > 0,
    checkedOut: (await currentBranch(cwd)) === branch
  }
}

/**
 * Replays `branch`'s own commits on top of `onto`. By default the result goes to a new branch
 * and the original is left alone; in place, a backup is recorded first. The rebased branch is
 * checked out afterwards (git rebase does that). Conflicts stop the rebase for the merge editor.
 */
export async function rebaseOnto(cwd: string, req: RebaseOntoRequest): Promise<IntegrateResult> {
  await assertBranchName(cwd, req.branch)
  assertSafe(req.onto, 'new base')
  await assertNoOperation(cwd)
  await assertNewBranch(cwd, req.output)
  const branchSha = await resolveCommit(cwd, `refs/heads/${req.branch}`)
  const ontoSha = await resolveCommit(cwd, req.onto)
  const target = req.output.mode === 'new-branch' ? req.output.name : req.branch

  if (await isAncestor(cwd, ontoSha, branchSha)) {
    if (req.output.mode === 'new-branch')
      await git(cwd, ['branch', target, branchSha], { write: true })
    return {
      status: 'up-to-date',
      branch: target,
      oldTip: branchSha,
      newTip: branchSha,
      backupRef: null,
      message: `${req.branch} is already based on ${req.onto}`
    }
  }
  if (!req.autostash && (await isDirty(cwd))) {
    throw new Error(
      'You have uncommitted changes. Commit or stash them first, or enable autostash.'
    )
  }

  let backupRef: string | null = null
  if (req.output.mode === 'new-branch') {
    await git(cwd, ['branch', target, branchSha], { write: true })
  } else {
    backupRef = await createBackup(cwd, target, branchSha, 'rebase')
  }
  const r = await git(
    cwd,
    [
      'rebase',
      '--empty=drop',
      '--no-update-refs',
      req.autostash ? '--autostash' : '--no-autostash',
      ...(req.keepMerges ? ['--rebase-merges'] : []),
      ontoSha,
      target
    ],
    { write: true, allowFail: true, env: NON_INTERACTIVE_EDITOR }
  )
  if (r.code !== 0) {
    const after = await detectOp(cwd, [])
    if (after.kind === 'rebase') {
      return {
        status: 'conflict',
        branch: target,
        oldTip: branchSha,
        newTip: null,
        backupRef,
        message: `Rebasing ${target} onto ${req.onto} stopped on a conflict. Resolve the files, then Continue, or Abort to undo.`
      }
    }
    if (req.output.mode === 'new-branch' && (await currentBranch(cwd)) !== target) {
      await git(cwd, ['branch', '-D', target], { write: true, allowFail: true })
    }
    if (backupRef) await git(cwd, ['update-ref', '-d', backupRef], { write: true, allowFail: true })
    throw new Error(r.stderr.trim() || 'git rebase failed')
  }
  const newTip = await gitOut(cwd, ['rev-parse', `refs/heads/${target}`])
  return {
    status: 'done',
    branch: target,
    oldTip: branchSha,
    newTip,
    backupRef,
    message: `Rebased ${target} onto ${req.onto}`
  }
}

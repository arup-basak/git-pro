import type { MenuCommand } from './menu'

/** A git timestamp exactly as git stores it: unix seconds plus a "+hhmm"/"-hhmm" offset. */
export interface GitDate {
  ts: number
  tz: string
}

export interface Person {
  name: string
  email: string
}

export interface Identity extends Person {
  date: GitDate
}

export type RefKind = 'head' | 'branch' | 'remote' | 'tag'

export interface RefLabel {
  kind: RefKind
  /** Short name, e.g. "main", "origin/main", "v1.0". For kind "head" this is "HEAD". */
  name: string
  /** True for the branch HEAD currently points at. */
  current?: boolean
}

export interface CommitSummary {
  sha: string
  parents: string[]
  author: Identity
  committer: Identity
  refs: RefLabel[]
  subject: string
}

export interface FileChange {
  path: string
  oldPath?: string
  /** A, M, D, R, C, T, U … */
  status: string
  additions: number | null
  deletions: number | null
}

export interface CommitDetail extends CommitSummary {
  message: string
  tree: string
  signed: boolean
  files: FileChange[]
}

export interface StatusEntry {
  path: string
  origPath?: string
  /** Index (staged) status letter, "." when unchanged. */
  index: string
  /** Worktree (unstaged) status letter, "." when unchanged. */
  worktree: string
  conflicted: boolean
  untracked: boolean
}

export type OpKind = 'none' | 'rebase' | 'merge' | 'cherry-pick' | 'revert' | 'bisect'

export interface OpState {
  kind: OpKind
  conflicted: string[]
  /** Human readable progress, e.g. "rebasing feature (3/7)". */
  detail?: string
}

export interface RepoStatus {
  branch: string | null
  head: string | null
  upstream?: string
  ahead: number
  behind: number
  entries: StatusEntry[]
  op: OpState
}

export interface BranchInfo {
  name: string
  sha: string
  upstream?: string
  ahead?: number
  behind?: number
  gone?: boolean
  current: boolean
  subject: string
  date: number
}

export interface RemoteBranchInfo {
  remote: string
  /** Branch name on the remote, e.g. "main". */
  name: string
  /** "origin/main" */
  short: string
  sha: string
  subject: string
  date: number
}

export interface TagInfo {
  name: string
  /** SHA of the commit the tag points at (peeled). */
  sha: string
  annotated: boolean
  subject: string
}

export interface RemoteInfo {
  name: string
  fetchUrl: string
  pushUrl: string
}

export interface RefsSnapshot {
  head: string | null
  currentBranch: string | null
  branches: BranchInfo[]
  remoteBranches: RemoteBranchInfo[]
  tags: TagInfo[]
  remotes: RemoteInfo[]
}

export type StashScope = 'all' | 'staged' | 'paths' | 'lines'

/**
 * Some changed lines of one file's working-tree diff, chosen in the diff view. `changes` are
 * ordinals of the `+`/`-` lines in that diff (0 = the first changed line). `diffHash` is
 * `textHash()` of the diff text the selection was made on; a stale selection is refused.
 */
export interface LineSelection {
  path: string
  /** The diff is the staged one (index vs HEAD) rather than working tree vs index. */
  staged: boolean
  untracked: boolean
  diffHash: string
  changes: number[]
}

export type LineAction = 'stage' | 'unstage' | 'discard'

/** A stash created and managed by Git Pro (stable ref + metadata, never shifts index). */
export interface AppStash {
  id: string
  ref: string
  sha: string
  name: string
  notes: string
  /** Free-form group label; '' = ungrouped. */
  group: string
  pinned: boolean
  /** Branch checked out when the stash was made (null = detached). */
  branch: string | null
  /** HEAD at the time of stashing (the stash commit's first parent). */
  baseSha: string
  baseSubject: string
  createdAt: number
  scope: StashScope
  includeUntracked: boolean
  /** Set when the stash is in the trash. */
  deletedAt?: number
}

/** An entry on git's own `refs/stash` stack (made outside the app or with plain git). */
export interface StackStash {
  index: number
  ref: string
  sha: string
  message: string
  branch: string | null
  baseSha: string
  date: number
}

export interface StashOverview {
  app: AppStash[]
  trash: AppStash[]
  stack: StackStash[]
  groups: string[]
}

export interface StashFile {
  path: string
  status: string
  untracked: boolean
}

export interface StashSaveRequest {
  name: string
  notes: string
  group: string
  scope: StashScope
  paths?: string[]
  /** For scope 'lines': the selected lines (unstaged changes only). */
  selections?: LineSelection[]
  includeUntracked: boolean
  /** Record the stash but leave the working tree as it is (a snapshot). */
  keepWorkingTree: boolean
}

export type StashTarget =
  { kind: 'app'; id: string } | { kind: 'stack'; index: number; sha: string }

export type PreviewOutcome =
  'modified' | 'added' | 'deleted' | 'conflict' | 'blocked' | 'untracked' | 'untracked-blocked'

export interface PreviewFile {
  path: string
  outcome: PreviewOutcome
  untracked: boolean
}

export interface MergeTrees {
  base: string
  ours: string
  theirs: string
  result: string
}

export interface StashApplyPreview {
  stashSha: string
  clean: boolean
  files: PreviewFile[]
  trees: MergeTrees
  messages: string[]
  /**
   * The stash touches files with unstaged edits, so it is merged into the working tree (on
   * top of those edits) instead of through the index; nothing gets staged.
   */
  onWorktree: boolean
}

export interface StashApplyResult {
  clean: boolean
  conflicted: string[]
  dropped: boolean
  output: string
}

export type MergeSource = { kind: 'live' } | { kind: 'trees'; trees: MergeTrees }

export interface MergeVersions {
  path: string
  base: string | null
  ours: string | null
  theirs: string | null
  /** Current content with conflict markers (worktree file for live merges, merge result for previews). */
  merged: string | null
  binary: boolean
}

export type MergeResolution = { content: string } | { take: 'ours' | 'theirs' } | { delete: true }

export interface ReflogEntry {
  sha: string
  selector: string
  message: string
  date: number
}

export interface BackupInfo {
  ref: string
  /** The branch (or "HEAD") that was backed up. */
  name: string
  sha: string
  createdAt: number
  reason: string
  subject: string
}

export interface RepoInfo {
  id: string
  path: string
  name: string
}

export interface CommitRequest {
  message: string
  amend: boolean
  author?: Person
  authorDate?: GitDate
  committer?: Person
  committerDate?: GitDate
  signoff: boolean
  noVerify: boolean
  allowEmpty: boolean
}

export type ForceMode = 'none' | 'lease' | 'force'

export interface PushSpec {
  remote: string
  /** "branch": a local branch name; "commit": any commit-ish (SHA, tag, …). */
  sourceKind: 'branch' | 'commit'
  source: string
  /** Branch name on the remote (without refs/heads/). */
  dest: string
  force: ForceMode
  /** Expected SHA of the remote branch for --force-with-lease; "" means "must not exist". Filled by main. */
  leaseExpect?: string
  setUpstream: boolean
  followTags: boolean
  dryRun: boolean
}

export interface PushResult {
  ok: boolean
  summary: string
  output: string
}

export type ResetMode = 'soft' | 'mixed' | 'hard' | 'keep'

export type HistoryAction = 'pick' | 'drop' | 'squash' | 'fixup'

export interface HistoryRow {
  sha: string
  parents: string[]
  subject: string
  message: string
  author: Identity
  committer: Identity
  signed: boolean
  isMerge: boolean
}

export interface HistoryRange {
  tipSha: string
  /** Local branch name if `tip` named one. */
  tipBranch: string | null
  /** Exclusive base commit; null means the range goes back to the root commit. */
  baseSha: string | null
  /** Oldest → newest. */
  rows: HistoryRow[]
  truncated: boolean
}

export interface RowEdit {
  sha: string
  action: HistoryAction
  message?: string
  author?: Person
  authorDate?: GitDate
  committer?: Person
  committerDate?: GitDate
}

export type HistoryOutput = { mode: 'new-branch'; name: string } | { mode: 'in-place' }

export interface HistoryPlan {
  /** Branch name or SHA the range ends at. */
  tip: string
  /** The tip SHA the plan was built against (guards against the branch moving meanwhile). */
  tipSha: string
  baseSha: string | null
  /** Oldest → newest, in the desired final order. Must contain every commit of the range exactly once. */
  rows: RowEdit[]
  output: HistoryOutput
  /** Structural engine only: keep each commit's original committer date instead of "now". */
  preserveCommitterDates: boolean
  resign: boolean
  /** Structural engine only: stash local changes around the rebase. */
  autostash: boolean
}

export interface RewriteResult {
  engine: 'metadata' | 'rebase'
  status: 'done' | 'conflict'
  branch: string
  oldTip: string
  newTip: string | null
  mapping: { old: string; new: string }[]
  backupRef: string | null
  /** Other refs that still point into the old (pre-rewrite) history. */
  staleRefs: string[]
  message: string
}

export interface CommandLogEntry {
  id: number
  repo: string
  args: string[]
  startedAt: number
  durationMs: number
  code: number | null
  stdout: string
  stderr: string
}

export type AppEvent =
  | { type: 'repo-changed'; repoId: string; scope: 'refs' | 'worktree' }
  | { type: 'command'; entry: CommandLogEntry }
  | { type: 'progress'; repoId: string; line: string }
  | { type: 'menu'; command: MenuCommand; arg?: string }

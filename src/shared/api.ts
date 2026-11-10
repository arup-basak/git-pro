import type {
  AppEvent,
  BackupInfo,
  CommitDetail,
  CommitRequest,
  CommitSummary,
  HistoryPlan,
  HistoryRange,
  Person,
  PushResult,
  PushSpec,
  RefsSnapshot,
  ReflogEntry,
  RepoInfo,
  RepoStatus,
  ResetMode,
  RewriteResult,
  StashOverview,
  StashSaveRequest,
  StashFile,
  StashApplyPreview,
  StashTarget,
  StashApplyResult,
  AppStash,
  MergeSource,
  MergeVersions,
  MergeResolution,
  GitDate,
  LineAction,
  LineSelection,
  BranchMergeRequest,
  IntegrateResult,
  MergePreview,
  RebaseOntoRequest,
  RebasePreview,
  BlameResult,
  BisectState,
  WorktreeInfo,
  WorktreeAddRequest,
  IgnoreRequest,
  SigningConfig,
  SigningKey,
  ConfigScope,
  TrackingReport,
  PublishItem,
  PublishResult,
  UpstreamChange,
  LocalTrackingBranch,
  BatchResult,
  TerminalInfo
} from './types'
import type { MenuState } from './menu'

/**
 * Which refs the commit graph walks when no single ref is given: everything, only local
 * branches (plus HEAD), or only remote-tracking branches.
 */
export type LogScope = 'all' | 'local' | 'remote'

export interface LogQuery {
  /** Ref to walk from; omitted means the refs chosen by `scope`. */
  ref?: string
  /** Defaults to 'all'. Ignored with `ref` or `path`. */
  scope?: LogScope
  limit: number
  skip?: number
  search?: string
  searchMode?: 'message' | 'author' | 'sha'
  /** Only commits that touch this file. */
  path?: string
  /** Follow the file across renames (only with `path`). */
  follow?: boolean
}

/**
 * The complete main-process API. Every method that takes `repoId` only accepts repos the user
 * opened through a dialog (or the recent list built from those).
 */
export interface GitProApi {
  /** Renderer → main: current UI state for the application menu. */
  'app.menuState'(state: MenuState): Promise<void>
  /** Whether the window is in native fullscreen (macOS hides the traffic lights then). */
  'app.isFullScreen'(): Promise<boolean>

  'repo.pick'(): Promise<RepoInfo | null>
  'repo.openRecent'(path: string): Promise<RepoInfo>
  'repo.recent'(): Promise<string[]>
  'repo.forget'(path: string): Promise<void>
  'repo.init'(): Promise<RepoInfo | null>
  'repo.clone'(url: string): Promise<RepoInfo | null>
  'repo.reveal'(repoId: string, relPath?: string): Promise<void>
  'repo.openFile'(repoId: string, relPath: string): Promise<void>
  'repo.identity'(repoId: string): Promise<Person>

  /** In-app terminal: the user's login shell, started in the repository. */
  'terminal.create'(repoId: string, cols: number, rows: number): Promise<TerminalInfo>
  'terminal.write'(id: string, data: string): Promise<void>
  'terminal.resize'(id: string, cols: number, rows: number): Promise<void>
  'terminal.kill'(id: string): Promise<void>

  'log.list'(repoId: string, q: LogQuery): Promise<CommitSummary[]>
  'commit.detail'(repoId: string, sha: string): Promise<CommitDetail>
  'commit.diff'(repoId: string, sha: string, paths?: string[]): Promise<string>
  'refs.snapshot'(repoId: string): Promise<RefsSnapshot>

  'status.get'(repoId: string): Promise<RepoStatus>
  'worktree.diff'(
    repoId: string,
    path: string,
    staged: boolean,
    untracked: boolean
  ): Promise<string>
  'worktree.stage'(repoId: string, paths: string[]): Promise<void>
  'worktree.unstage'(repoId: string, paths: string[]): Promise<void>
  'worktree.discard'(repoId: string, tracked: string[], untracked: string[]): Promise<void>
  /** Stage, unstage or discard only the selected lines of one file. */
  'worktree.applyLines'(repoId: string, action: LineAction, sel: LineSelection): Promise<void>
  'worktree.commit'(repoId: string, req: CommitRequest): Promise<string>

  'branch.create'(
    repoId: string,
    name: string,
    startPoint: string,
    checkout: boolean
  ): Promise<void>
  'branch.checkout'(repoId: string, name: string): Promise<void>
  'branch.checkoutRemote'(repoId: string, remoteShort: string, localName: string): Promise<void>
  'branch.rename'(repoId: string, oldName: string, newName: string): Promise<void>
  'branch.delete'(repoId: string, name: string, force: boolean): Promise<string | null>
  'branch.setUpstream'(repoId: string, name: string, upstream: string | null): Promise<void>
  /** Points a branch that is not checked out at another commit; returns the backup ref. */
  'branch.move'(repoId: string, name: string, sha: string): Promise<string>
  'branch.mergePreview'(repoId: string, source: string, target: string): Promise<MergePreview>
  'branch.merge'(repoId: string, req: BranchMergeRequest): Promise<IntegrateResult>
  'branch.rebasePreview'(repoId: string, branch: string, onto: string): Promise<RebasePreview>
  'branch.rebaseOnto'(repoId: string, req: RebaseOntoRequest): Promise<IntegrateResult>

  /** Branches without a working connection to a remote, and remote branches with no local one. */
  'tracking.report'(repoId: string): Promise<TrackingReport>
  /** Pushes each branch to `<remote>/<dest>` and tracks it, in one `git push`. */
  'tracking.publish'(repoId: string, remote: string, items: PublishItem[]): Promise<PublishResult>
  /** Sets or removes upstreams, branch by branch. */
  'tracking.setUpstreams'(repoId: string, changes: UpstreamChange[]): Promise<BatchResult>
  /** Creates local branches tracking remote branches, without checking them out. */
  'tracking.createLocal'(repoId: string, items: LocalTrackingBranch[]): Promise<BatchResult>

  'remote.fetch'(repoId: string, remote: string | null, prune: boolean): Promise<void>
  'remote.pull'(repoId: string, mode: 'ff-only' | 'merge' | 'rebase'): Promise<void>
  'remote.push'(repoId: string, spec: PushSpec): Promise<PushResult>
  'remote.deleteBranch'(repoId: string, remote: string, name: string): Promise<void>
  'remote.add'(repoId: string, name: string, url: string): Promise<void>
  'remote.remove'(repoId: string, name: string): Promise<void>
  'remote.setUrl'(repoId: string, name: string, url: string): Promise<void>

  'commit.checkout'(repoId: string, sha: string): Promise<void>
  'commit.cherryPick'(repoId: string, sha: string): Promise<void>
  /** Cherry-pick onto a branch that is not checked out, without touching the working tree. */
  'commit.cherryPickTo'(
    repoId: string,
    sha: string,
    branch: string
  ): Promise<{ branch: string; newTip: string; backupRef: string }>
  'commit.revert'(repoId: string, sha: string): Promise<void>
  'commit.reset'(repoId: string, sha: string, mode: ResetMode): Promise<string | null>

  /** Returns the finished rewrite when this completes a History-editor rebase. */
  'op.continue'(repoId: string): Promise<RewriteResult | null>
  'op.abort'(repoId: string): Promise<void>
  'op.skip'(repoId: string): Promise<void>

  'history.range'(
    repoId: string,
    tip: string,
    base: { sha: string | null } | { count: number }
  ): Promise<HistoryRange>
  'history.apply'(repoId: string, plan: HistoryPlan): Promise<RewriteResult>

  'stash.list'(repoId: string): Promise<StashOverview>
  'stash.save'(repoId: string, req: StashSaveRequest): Promise<AppStash>
  'stash.files'(repoId: string, sha: string): Promise<StashFile[]>
  'stash.diff'(repoId: string, sha: string, path?: string): Promise<string>
  'stash.preview'(repoId: string, sha: string): Promise<StashApplyPreview>
  'stash.apply'(
    repoId: string,
    target: StashTarget,
    opts: { pop: boolean; restoreIndex: boolean }
  ): Promise<StashApplyResult>
  'stash.update'(
    repoId: string,
    id: string,
    patch: Partial<Pick<AppStash, 'name' | 'notes' | 'group' | 'pinned'>>
  ): Promise<void>
  'stash.delete'(repoId: string, target: StashTarget): Promise<void>
  'stash.restore'(repoId: string, id: string): Promise<void>
  'stash.purge'(repoId: string, id: string): Promise<void>
  'stash.adopt'(
    repoId: string,
    index: number,
    sha: string,
    name: string,
    group: string
  ): Promise<AppStash>
  'stash.toBranch'(repoId: string, target: StashTarget, branch: string): Promise<void>

  'merge.versions'(repoId: string, path: string, source: MergeSource): Promise<MergeVersions>
  'merge.resolve'(repoId: string, path: string, resolution: MergeResolution): Promise<void>
  'tree.diff'(repoId: string, from: string, to: string, path?: string): Promise<string>

  'tag.create'(
    repoId: string,
    name: string,
    target: string,
    annotation: { message: string; date?: GitDate } | null
  ): Promise<void>
  'tag.delete'(repoId: string, name: string): Promise<void>
  'tag.push'(repoId: string, remote: string, name: string): Promise<void>
  'tag.deleteRemote'(repoId: string, remote: string, name: string): Promise<void>

  'reflog.list'(repoId: string, ref: string, limit: number): Promise<ReflogEntry[]>

  /** Blame a file at a revision (null = the working tree). */
  'file.blame'(repoId: string, path: string, rev: string | null): Promise<BlameResult>
  /** Adds a pattern to .gitignore or .git/info/exclude (and optionally untracks files). */
  'file.ignore'(repoId: string, req: IgnoreRequest): Promise<{ file: string; added: boolean }>

  'bisect.state'(repoId: string): Promise<BisectState>
  'bisect.start'(repoId: string, bad: string, good: string): Promise<BisectState>
  'bisect.mark'(
    repoId: string,
    verdict: 'good' | 'bad' | 'skip',
    rev?: string
  ): Promise<BisectState>
  'bisect.reset'(repoId: string): Promise<void>

  'worktrees.list'(repoId: string): Promise<WorktreeInfo[]>
  /** Asks where to put the worktree, then creates it. Null when the user cancels. */
  'worktrees.add'(repoId: string, req: WorktreeAddRequest): Promise<WorktreeInfo | null>
  'worktrees.remove'(repoId: string, path: string, force: boolean): Promise<void>
  'worktrees.prune'(repoId: string): Promise<void>
  /** Opens a worktree of this repository as a repository of its own. */
  'worktrees.open'(repoId: string, path: string): Promise<RepoInfo>

  'signing.get'(repoId: string): Promise<SigningConfig>
  'signing.keys'(repoId: string): Promise<SigningKey[]>
  'signing.set'(repoId: string, scope: ConfigScope, config: SigningConfig): Promise<void>
  /** Signs a throwaway commit object to check the setup works. */
  'signing.test'(repoId: string): Promise<{ ok: boolean; message: string }>

  'backup.list'(repoId: string): Promise<BackupInfo[]>
  'backup.restore'(
    repoId: string,
    ref: string,
    mode: 'new-branch' | 'reset-original',
    newName?: string
  ): Promise<void>
  'backup.delete'(repoId: string, ref: string): Promise<void>
}

export type ApiMethod = keyof GitProApi

export type InvokeEnvelope<T> =
  { ok: true; value: T } | { ok: false; error: { message: string; detail?: string } }

export interface GitProBridge {
  invoke<K extends ApiMethod>(
    method: K,
    ...args: Parameters<GitProApi[K]>
  ): ReturnType<GitProApi[K]>
  on(listener: (event: AppEvent) => void): () => void
  /** `process.platform` of the app, known synchronously so the first paint lays out correctly. */
  platform: string
}

export const INVOKE_CHANNEL = 'gitpro:invoke'
export const EVENT_CHANNEL = 'gitpro:event'

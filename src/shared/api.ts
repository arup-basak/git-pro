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
  LineSelection
} from './types'
import type { MenuState } from './menu'

export interface LogQuery {
  /** Ref to walk from; omitted means all branches, remotes and tags. */
  ref?: string
  limit: number
  skip?: number
  search?: string
  searchMode?: 'message' | 'author' | 'sha'
}

/**
 * The complete main-process API. Every method that takes `repoId` only accepts repos the user
 * opened through a dialog (or the recent list built from those).
 */
export interface GitProApi {
  /** Renderer → main: current UI state for the application menu. */
  'app.menuState'(state: MenuState): Promise<void>

  'repo.pick'(): Promise<RepoInfo | null>
  'repo.openRecent'(path: string): Promise<RepoInfo>
  'repo.recent'(): Promise<string[]>
  'repo.forget'(path: string): Promise<void>
  'repo.init'(): Promise<RepoInfo | null>
  'repo.clone'(url: string): Promise<RepoInfo | null>
  'repo.reveal'(repoId: string, relPath?: string): Promise<void>
  'repo.openFile'(repoId: string, relPath: string): Promise<void>
  'repo.identity'(repoId: string): Promise<Person>

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

  'remote.fetch'(repoId: string, remote: string | null, prune: boolean): Promise<void>
  'remote.pull'(repoId: string, mode: 'ff-only' | 'merge' | 'rebase'): Promise<void>
  'remote.push'(repoId: string, spec: PushSpec): Promise<PushResult>
  'remote.deleteBranch'(repoId: string, remote: string, name: string): Promise<void>
  'remote.add'(repoId: string, name: string, url: string): Promise<void>
  'remote.remove'(repoId: string, name: string): Promise<void>
  'remote.setUrl'(repoId: string, name: string, url: string): Promise<void>

  'commit.checkout'(repoId: string, sha: string): Promise<void>
  'commit.cherryPick'(repoId: string, sha: string): Promise<void>
  'commit.revert'(repoId: string, sha: string): Promise<void>
  'commit.reset'(repoId: string, sha: string, mode: ResetMode): Promise<string | null>

  'op.continue'(repoId: string): Promise<void>
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
}

export const INVOKE_CHANNEL = 'gitpro:invoke'
export const EVENT_CHANNEL = 'gitpro:event'

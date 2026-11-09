import type {
  CommandLogEntry,
  HistoryAction,
  LineSelection,
  MergeSource,
  PushSpec,
  RepoInfo,
  RewriteResult,
  StashTarget
} from '@shared/types'
import { create } from 'zustand'

export type View = 'graph' | 'changes' | 'stashes' | 'history' | 'merge' | 'reflog' | 'backups'

export interface MergeRequest {
  source: MergeSource
  paths: string[]
  path: string
  title: string
  /** View to return to when the editor closes. */
  back: View
}

/** What the New stash dialog opens with: everything, the staged part, files, or lines. */
export interface StashDialogRequest {
  paths?: string[]
  staged?: boolean
  selections?: LineSelection[]
}

/** Opens the Merge or Rebase-onto dialog, optionally prefilled. */
export type IntegrateRequest =
  | { kind: 'merge'; source?: string; target?: string }
  | { kind: 'rebase'; branch?: string; onto?: string }

export interface HistoryRequest {
  tip: string
  /** Exclusive base; null = from the root commit. */
  base: { sha: string | null } | { count: number }
  /** Commit to highlight when the editor opens. */
  focus?: string
  /** Actions to preselect, by SHA (e.g. `edit` for "Edit contents of this commit…"). */
  preset?: Record<string, HistoryAction>
  nonce: number
}

interface UiState {
  repo: RepoInfo | null
  view: View
  selectedSha: string | null
  /** Branch filter for the graph; null = all refs. */
  graphRef: string | null
  history: HistoryRequest | null
  push: Partial<PushSpec> | null
  integrate: IntegrateRequest | null
  /** A finished history rewrite to report (from the History editor or a final Continue). */
  rewriteResult: RewriteResult | null
  logOpen: boolean
  stashSel: StashTarget | null
  stashDialog: StashDialogRequest | null
  merge: MergeRequest | null
  settingsOpen: boolean
  shortcutsOpen: boolean
  commands: CommandLogEntry[]
  progress: string | null
  setRepo(repo: RepoInfo | null): void
  setView(view: View): void
  select(sha: string | null): void
  setGraphRef(ref: string | null): void
  openHistory(req: Omit<HistoryRequest, 'nonce'>): void
  openPush(prefill: Partial<PushSpec>): void
  closePush(): void
  showRewriteResult(r: RewriteResult | null): void
  openIntegrate(req: IntegrateRequest): void
  closeIntegrate(): void
  toggleLog(open?: boolean): void
  selectStash(t: StashTarget | null): void
  openStashDialog(opts: StashDialogRequest): void
  closeStashDialog(): void
  openMerge(req: Omit<MergeRequest, 'back'>): void
  closeMerge(): void
  setSettingsOpen(open: boolean): void
  setShortcutsOpen(open: boolean): void
  addCommand(entry: CommandLogEntry): void
  clearCommands(): void
  setProgress(line: string | null): void
}

export const useUi = create<UiState>((set) => ({
  repo: null,
  view: 'graph',
  selectedSha: null,
  graphRef: null,
  history: null,
  push: null,
  integrate: null,
  rewriteResult: null,
  logOpen: false,
  stashSel: null,
  stashDialog: null,
  merge: null,
  settingsOpen: false,
  shortcutsOpen: false,
  commands: [],
  progress: null,
  setRepo: (repo) =>
    set({
      repo,
      selectedSha: null,
      graphRef: null,
      history: null,
      stashSel: null,
      merge: null,
      integrate: null,
      rewriteResult: null,
      push: null,
      view: 'graph'
    }),
  setView: (view) => set({ view }),
  select: (selectedSha) => set({ selectedSha }),
  setGraphRef: (graphRef) => set({ graphRef }),
  openHistory: (req) => set({ history: { ...req, nonce: Date.now() }, view: 'history' }),
  openPush: (push) => set({ push }),
  closePush: () => set({ push: null }),
  showRewriteResult: (rewriteResult) => set({ rewriteResult }),
  openIntegrate: (integrate) => set({ integrate }),
  closeIntegrate: () => set({ integrate: null }),
  toggleLog: (open) => set((s) => ({ logOpen: open ?? !s.logOpen })),
  selectStash: (stashSel) => set({ stashSel }),
  openStashDialog: (stashDialog) => set({ stashDialog }),
  closeStashDialog: () => set({ stashDialog: null }),
  openMerge: (req) =>
    set((s) => ({
      merge: { ...req, back: s.view === 'merge' ? (s.merge?.back ?? 'changes') : s.view },
      view: 'merge'
    })),
  closeMerge: () => set((s) => ({ view: s.merge?.back ?? 'changes', merge: null })),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  addCommand: (entry) => set((s) => ({ commands: [...s.commands.slice(-499), entry] })),
  clearCommands: () => set({ commands: [] }),
  setProgress: (progress) => set({ progress })
}))

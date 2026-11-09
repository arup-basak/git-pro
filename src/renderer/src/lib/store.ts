import type { CommandLogEntry, MergeSource, PushSpec, RepoInfo, StashTarget } from '@shared/types'
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

export interface HistoryRequest {
  tip: string
  /** Exclusive base; null = from the root commit. */
  base: { sha: string | null } | { count: number }
  /** Commit to highlight when the editor opens. */
  focus?: string
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
  logOpen: boolean
  stashSel: StashTarget | null
  stashDialog: { paths?: string[]; staged?: boolean } | null
  merge: MergeRequest | null
  commands: CommandLogEntry[]
  progress: string | null
  setRepo(repo: RepoInfo | null): void
  setView(view: View): void
  select(sha: string | null): void
  setGraphRef(ref: string | null): void
  openHistory(req: Omit<HistoryRequest, 'nonce'>): void
  openPush(prefill: Partial<PushSpec>): void
  closePush(): void
  toggleLog(open?: boolean): void
  selectStash(t: StashTarget | null): void
  openStashDialog(opts: { paths?: string[]; staged?: boolean }): void
  closeStashDialog(): void
  openMerge(req: Omit<MergeRequest, 'back'>): void
  closeMerge(): void
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
  logOpen: false,
  stashSel: null,
  stashDialog: null,
  merge: null,
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
      view: 'graph'
    }),
  setView: (view) => set({ view }),
  select: (selectedSha) => set({ selectedSha }),
  setGraphRef: (graphRef) => set({ graphRef }),
  openHistory: (req) => set({ history: { ...req, nonce: Date.now() }, view: 'history' }),
  openPush: (push) => set({ push }),
  closePush: () => set({ push: null }),
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
  addCommand: (entry) => set((s) => ({ commands: [...s.commands.slice(-499), entry] })),
  clearCommands: () => set({ commands: [] }),
  setProgress: (progress) => set({ progress })
}))

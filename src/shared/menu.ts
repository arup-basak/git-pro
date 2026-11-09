import type { OpKind } from './types'

/** Every command the application menu can send to the renderer. */
export type MenuCommand =
  | 'app.settings'
  | 'app.shortcuts'
  | 'repo.init'
  | 'repo.open'
  | 'repo.clone'
  | 'repo.openRecent'
  | 'repo.clearRecent'
  | 'repo.close'
  | 'repo.reveal'
  | 'repo.refresh'
  | 'find'
  | 'view.graph'
  | 'view.changes'
  | 'view.stashes'
  | 'view.history'
  | 'view.reflog'
  | 'view.backups'
  | 'view.log'
  | 'view.syntax'
  | 'view.wordDiff'
  | 'view.wrap'
  | 'view.splitDiff'
  | 'view.theme'
  | 'remote.fetchAll'
  | 'remote.fetch'
  | 'remote.pull'
  | 'remote.pullMerge'
  | 'remote.pullRebase'
  | 'remote.push'
  | 'remote.add'
  | 'history.edit'
  | 'op.resolve'
  | 'op.continue'
  | 'op.skip'
  | 'op.abort'
  | 'branch.new'
  | 'branch.checkout'
  | 'branch.rename'
  | 'branch.upstream'
  | 'branch.push'
  | 'branch.show'
  | 'changes.commit'
  | 'changes.amend'
  | 'changes.stageAll'
  | 'changes.unstageAll'
  | 'changes.discardAll'
  | 'stash.new'
  | 'stash.staged'
  | 'stash.apply'
  | 'stash.pop'
  | 'stash.preview'
  | 'commit.edit'
  | 'commit.push'
  | 'commit.branch'
  | 'commit.tag'
  | 'commit.checkout'
  | 'commit.cherryPick'
  | 'commit.revert'
  | 'commit.reset'
  | 'commit.copySha'

/** What the renderer reports so the menu can enable, check and label items. */
export interface MenuState {
  repo: { name: string; path: string } | null
  recent: string[]
  branches: string[]
  currentBranch: string | null
  remotes: string[]
  hasHead: boolean
  hasUpstream: boolean
  changes: number
  staged: number
  op: { kind: OpKind; conflicted: number }
  view: string
  logOpen: boolean
  selectedCommit: { sha: string; subject: string } | null
  selectedStash: { label: string } | null
  syntax: boolean
  wordDiff: boolean
  wrap: boolean
  splitDiff: boolean
  theme: string
}

export const EMPTY_MENU_STATE: MenuState = {
  repo: null,
  recent: [],
  branches: [],
  currentBranch: null,
  remotes: [],
  hasHead: false,
  hasUpstream: false,
  changes: 0,
  staged: 0,
  op: { kind: 'none', conflicted: 0 },
  view: 'graph',
  logOpen: false,
  selectedCommit: null,
  selectedStash: null,
  syntax: true,
  wordDiff: true,
  wrap: true,
  splitDiff: false,
  theme: 'github-dark-default'
}

/** Electron accelerators. Shared so the Keyboard Shortcuts sheet always matches the menu. */
export const ACCELERATORS: Partial<Record<MenuCommand, string>> = {
  'app.settings': 'CmdOrCtrl+,',
  'app.shortcuts': 'CmdOrCtrl+/',
  'repo.init': 'CmdOrCtrl+N',
  'repo.open': 'CmdOrCtrl+O',
  'repo.clone': 'CmdOrCtrl+Shift+O',
  'repo.close': 'CmdOrCtrl+Shift+W',
  'repo.reveal': 'CmdOrCtrl+Shift+F',
  'repo.refresh': 'CmdOrCtrl+R',
  find: 'CmdOrCtrl+F',
  'view.graph': 'CmdOrCtrl+1',
  'view.changes': 'CmdOrCtrl+2',
  'view.stashes': 'CmdOrCtrl+3',
  'view.history': 'CmdOrCtrl+4',
  'view.reflog': 'CmdOrCtrl+5',
  'view.backups': 'CmdOrCtrl+6',
  'view.log': 'CmdOrCtrl+L',
  'remote.fetchAll': 'CmdOrCtrl+Shift+T',
  'remote.pull': 'CmdOrCtrl+Shift+P',
  'remote.push': 'CmdOrCtrl+P',
  'history.edit': 'CmdOrCtrl+Shift+E',
  'op.resolve': 'CmdOrCtrl+Shift+M',
  'branch.new': 'CmdOrCtrl+Shift+N',
  'branch.rename': 'CmdOrCtrl+Shift+R',
  'changes.commit': 'CmdOrCtrl+K',
  'changes.stageAll': 'CmdOrCtrl+Shift+A',
  'stash.new': 'CmdOrCtrl+Shift+S',
  'commit.edit': 'CmdOrCtrl+E',
  'commit.copySha': 'CmdOrCtrl+Shift+C'
}

/** Shortcuts not attached to a menu item (handled inside views). */
export const LOCAL_SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: 'CmdOrCtrl+Enter', label: 'Commit (in the commit message box)' },
  { keys: 'Up / Down', label: 'Move the selection in the commit graph' },
  { keys: 'Enter / Esc', label: 'Apply / cancel a typed date' },
  { keys: 'Tab', label: 'Insert two spaces in the merge editor' }
]

/** "CmdOrCtrl+Shift+P" → "⇧⌘P" on macOS, "Ctrl+Shift+P" elsewhere. */
export function prettyAccelerator(accel: string, mac: boolean): string {
  const parts = accel.split('+')
  const key = parts.pop()!
  if (!mac) return [...parts.map((p) => (p === 'CmdOrCtrl' ? 'Ctrl' : p)), key].join('+')
  const order: Array<[string, string]> = [
    ['Ctrl', '⌃'],
    ['Alt', '⌥'],
    ['Shift', '⇧'],
    ['CmdOrCtrl', '⌘']
  ]
  const mods = order
    .filter(([m]) => parts.includes(m))
    .map(([, s]) => s)
    .join('')
  const k = key === 'Enter' ? '↵' : key === 'Up / Down' ? '↑ / ↓' : key
  return mods + k
}

/** Grouping for the Keyboard Shortcuts sheet; every entry of ACCELERATORS must appear here. */
export const SHORTCUT_GROUPS: Array<{ title: string; items: Array<[MenuCommand, string]> }> = [
  {
    title: 'Repository',
    items: [
      ['repo.open', 'Open repository'],
      ['repo.clone', 'Clone repository'],
      ['repo.init', 'New repository'],
      ['repo.close', 'Close repository'],
      ['repo.reveal', 'Reveal in Finder'],
      ['repo.refresh', 'Refresh']
    ]
  },
  {
    title: 'Navigate',
    items: [
      ['view.graph', 'Commit graph'],
      ['view.changes', 'Changes'],
      ['view.stashes', 'Stashes'],
      ['view.history', 'History editor'],
      ['view.reflog', 'Reflog'],
      ['view.backups', 'Backups'],
      ['find', 'Find commits'],
      ['view.log', 'Command log']
    ]
  },
  {
    title: 'Remote',
    items: [
      ['remote.fetchAll', 'Fetch all remotes'],
      ['remote.pull', 'Pull (fast-forward only)'],
      ['remote.push', 'Push…']
    ]
  },
  {
    title: 'History & commits',
    items: [
      ['history.edit', 'Edit history'],
      ['commit.edit', 'Edit selected commit'],
      ['commit.copySha', 'Copy selected commit SHA'],
      ['op.resolve', 'Resolve conflicts']
    ]
  },
  {
    title: 'Branches, changes & stashes',
    items: [
      ['branch.new', 'New branch'],
      ['branch.rename', 'Rename current branch'],
      ['changes.commit', 'Write a commit'],
      ['changes.stageAll', 'Stage all'],
      ['stash.new', 'New stash']
    ]
  },
  {
    title: 'App',
    items: [
      ['app.settings', 'Settings (code display)'],
      ['app.shortcuts', 'Keyboard shortcuts']
    ]
  }
]

import type { MenuItemConstructorOptions } from 'electron'
import { ACCELERATORS, type MenuCommand, type MenuState } from '../shared/menu'
import { SYNTAX_THEMES } from '../shared/themes'

export interface MenuEnv {
  mac: boolean
  dev: boolean
  send: (command: MenuCommand, arg?: string) => void
  openDocs: () => void
  clearRecent: () => void
}

type Item = MenuItemConstructorOptions

const SEP: Item = { type: 'separator' }

const OP_LABEL: Record<string, string> = {
  rebase: 'Rebase',
  merge: 'Merge',
  'cherry-pick': 'Cherry-pick',
  revert: 'Revert',
  bisect: 'Bisect'
}

function quote(s: string, max = 32): string {
  return `“${s.length > max ? s.slice(0, max - 1) + '…' : s}”`
}

function homeRelative(path: string): string {
  return path.replace(/^\/(Users|home)\/[^/]+/, '~')
}

/**
 * Builds the application menu from the renderer-reported state. Pure (no Electron runtime),
 * so it is unit-tested: enablement rules, dynamic lists and accelerator uniqueness.
 */
export function buildMenuTemplate(s: MenuState, env: MenuEnv): Item[] {
  const { mac, send } = env
  const cmd = (
    command: MenuCommand,
    label: string,
    opts: { enabled?: boolean; arg?: string; type?: 'checkbox' | 'radio'; checked?: boolean } = {}
  ): Item => ({
    id: opts.arg !== undefined ? `${command}:${opts.arg}` : command,
    label,
    type: opts.type,
    checked: opts.checked,
    enabled: opts.enabled ?? true,
    accelerator: opts.arg === undefined ? ACCELERATORS[command] : undefined,
    click: () => send(command, opts.arg)
  })

  const repo = !!s.repo
  const head = repo && s.hasHead
  const busy = s.op.kind !== 'none'
  const branch = s.currentBranch
  const hasRemotes = repo && s.remotes.length > 0
  const opName = OP_LABEL[s.op.kind] ?? 'Operation'
  const sel = repo ? s.selectedCommit : null
  const stash = repo ? s.selectedStash : null

  const appMenu: Item = {
    label: 'Git Pro',
    submenu: [
      { role: 'about', label: 'About Git Pro' },
      SEP,
      cmd('app.settings', 'Settings…'),
      SEP,
      { role: 'services' },
      SEP,
      { role: 'hide', label: 'Hide Git Pro' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      SEP,
      { role: 'quit', label: 'Quit Git Pro' }
    ]
  }

  const file: Item = {
    label: 'File',
    submenu: [
      cmd('repo.init', 'New Repository…'),
      cmd('repo.open', 'Open Repository…'),
      cmd('repo.clone', 'Clone Repository…'),
      {
        label: 'Open Recent',
        id: 'repo.recent',
        enabled: s.recent.length > 0,
        submenu: [
          ...s.recent.slice(0, 15).map((p) =>
            cmd('repo.openRecent', `${p.split('/').pop()}  —  ${homeRelative(p)}`, {
              arg: p,
              enabled: p !== s.repo?.path
            })
          ),
          SEP,
          {
            id: 'repo.clearRecent',
            label: 'Clear Menu',
            enabled: s.recent.length > 0,
            click: env.clearRecent
          }
        ]
      },
      SEP,
      cmd('repo.reveal', mac ? 'Reveal in Finder' : 'Show in File Manager', { enabled: repo }),
      cmd('repo.close', 'Close Repository', { enabled: repo }),
      SEP,
      ...(mac
        ? [{ role: 'close', label: 'Close Window' } as Item]
        : [cmd('app.settings', 'Settings…'), SEP, { role: 'quit', label: 'Exit' } as Item])
    ]
  }

  const edit: Item = {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      SEP,
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      ...(mac ? [{ role: 'pasteAndMatchStyle' } as Item] : []),
      { role: 'delete' },
      { role: 'selectAll' },
      SEP,
      cmd('find', 'Find Commits…', { enabled: repo })
    ]
  }

  const views: Array<[MenuCommand, string, string]> = [
    ['view.graph', 'Commit Graph', 'graph'],
    ['view.changes', s.changes ? `Changes (${s.changes})` : 'Changes', 'changes'],
    ['view.stashes', 'Stashes', 'stashes'],
    ['view.history', 'History Editor', 'history'],
    ['view.reflog', 'Reflog', 'reflog'],
    ['view.backups', 'Backups', 'backups']
  ]
  const view: Item = {
    label: 'View',
    submenu: [
      ...views.map(([c, label, v]) =>
        cmd(c, label, { enabled: repo, type: 'radio', checked: repo && s.view === v })
      ),
      SEP,
      cmd('view.log', 'Command Log', { enabled: repo, type: 'checkbox', checked: s.logOpen }),
      cmd('repo.refresh', 'Refresh', { enabled: repo }),
      SEP,
      cmd('view.syntax', 'Syntax Highlighting', { type: 'checkbox', checked: s.syntax }),
      cmd('view.wordDiff', 'Highlight Changed Words', { type: 'checkbox', checked: s.wordDiff }),
      cmd('view.wrap', 'Wrap Long Lines in Diffs', { type: 'checkbox', checked: s.wrap }),
      cmd('view.splitDiff', 'Side-by-Side Diffs', { type: 'checkbox', checked: s.splitDiff }),
      {
        label: 'Syntax Theme',
        id: 'view.themes',
        enabled: s.syntax,
        submenu: SYNTAX_THEMES.map((t) =>
          cmd('view.theme', t.label, { arg: t.id, type: 'radio', checked: s.theme === t.id })
        )
      },
      SEP,
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      SEP,
      { role: 'togglefullscreen' },
      SEP,
      // Plain ⌘R refreshes the repository; reloading the UI moves to ⌥⌘R.
      { role: 'reload', label: 'Reload Window', accelerator: 'CmdOrCtrl+Alt+R' },
      ...(env.dev ? [{ role: 'toggleDevTools' } as Item] : [])
    ]
  }

  const pullEnabled = repo && s.hasUpstream && !busy
  const repository: Item = {
    label: 'Repository',
    submenu: [
      cmd('remote.fetchAll', 'Fetch All Remotes', { enabled: hasRemotes }),
      ...(s.remotes.length > 1
        ? [
            {
              label: 'Fetch',
              id: 'remote.fetchMenu',
              enabled: hasRemotes,
              submenu: s.remotes.map((r) => cmd('remote.fetch', r, { arg: r }))
            } as Item
          ]
        : []),
      cmd('remote.pull', 'Pull (Fast-forward Only)', { enabled: pullEnabled }),
      cmd('remote.pullMerge', 'Pull (Merge)', { enabled: pullEnabled }),
      cmd('remote.pullRebase', 'Pull (Rebase)', { enabled: pullEnabled }),
      cmd('remote.push', 'Push…', { enabled: hasRemotes }),
      SEP,
      cmd('history.edit', 'Edit History…', { enabled: head && !busy }),
      SEP,
      cmd('op.resolve', 'Resolve Conflicts…', { enabled: repo && s.op.conflicted > 0 }),
      cmd('op.continue', busy ? `Continue ${opName}` : 'Continue', {
        enabled: busy && s.op.kind !== 'bisect' && s.op.conflicted === 0
      }),
      cmd('op.skip', 'Skip Current Commit', {
        enabled: ['rebase', 'cherry-pick', 'revert'].includes(s.op.kind)
      }),
      cmd('op.abort', busy ? `Abort ${opName}…` : 'Abort…', { enabled: busy }),
      SEP,
      cmd('remote.add', 'Add Remote…', { enabled: repo })
    ]
  }

  const branchMenu: Item = {
    label: 'Branch',
    submenu: [
      cmd('branch.new', 'New Branch…', { enabled: head }),
      {
        label: 'Check Out',
        id: 'branch.checkoutMenu',
        enabled: repo && s.branches.length > 0,
        submenu: s.branches
          .slice(0, 40)
          .map((b) => cmd('branch.checkout', b, { arg: b, type: 'radio', checked: b === branch }))
      },
      SEP,
      cmd('branch.merge', branch ? `Merge into ${quote(branch)}…` : 'Merge…', {
        enabled: head && !!branch && !busy
      }),
      cmd('branch.rebase', branch ? `Rebase ${quote(branch)} onto…` : 'Rebase onto…', {
        enabled: head && !!branch && !busy
      }),
      SEP,
      cmd('branch.rename', branch ? `Rename ${quote(branch)}…` : 'Rename Branch…', {
        enabled: repo && !!branch
      }),
      cmd('branch.upstream', branch ? `Set Upstream of ${quote(branch)}…` : 'Set Upstream…', {
        enabled: repo && !!branch
      }),
      cmd('branch.push', branch ? `Push ${quote(branch)}…` : 'Push Branch…', {
        enabled: hasRemotes && !!branch
      }),
      cmd('branch.show', branch ? `Show ${quote(branch)} in Graph` : 'Show in Graph', {
        enabled: repo && !!branch
      })
    ]
  }

  const changes: Item = {
    label: 'Changes',
    submenu: [
      cmd('changes.commit', 'Commit…', { enabled: repo }),
      cmd('changes.amend', 'Amend Last Commit…', { enabled: head && !busy }),
      SEP,
      cmd('changes.stageAll', 'Stage All', { enabled: repo && s.changes > s.staged }),
      cmd('changes.unstageAll', 'Unstage All', { enabled: repo && s.staged > 0 }),
      cmd('changes.discardAll', 'Discard All Changes…', { enabled: repo && s.changes > 0 })
    ]
  }

  const commit: Item = {
    label: 'Commit',
    submenu: [
      {
        id: 'commit.selected',
        label: sel ? `${sel.sha.slice(0, 8)}  ${quote(sel.subject, 40)}` : 'No commit selected',
        enabled: false
      },
      SEP,
      cmd('commit.edit', 'Edit Date / Author / Message…', { enabled: !!sel && !busy }),
      cmd('commit.push', 'Push Commit to Remote Branch…', { enabled: !!sel && hasRemotes }),
      SEP,
      cmd('commit.branch', 'New Branch from Commit…', { enabled: !!sel }),
      cmd('commit.tag', 'Tag Commit…', { enabled: !!sel }),
      cmd('commit.checkout', 'Check Out Commit (Detached)…', { enabled: !!sel && !busy }),
      SEP,
      cmd('commit.cherryPick', `Cherry-pick onto ${branch ? quote(branch) : 'HEAD'}`, {
        enabled: !!sel && !busy
      }),
      cmd('commit.revert', 'Revert Commit…', { enabled: !!sel && !busy }),
      cmd('commit.reset', `Reset ${branch ? quote(branch) : 'HEAD'} to Commit…`, {
        enabled: !!sel && !busy
      }),
      SEP,
      cmd('commit.copySha', 'Copy SHA', { enabled: !!sel })
    ]
  }

  const stashMenu: Item = {
    label: 'Stash',
    submenu: [
      cmd('stash.new', 'New Stash…', { enabled: repo && s.changes > 0 }),
      cmd('stash.staged', 'Stash Staged Changes…', { enabled: repo && s.staged > 0 }),
      SEP,
      {
        id: 'stash.selected',
        label: stash ? quote(stash.label, 40) : 'No stash selected',
        enabled: false
      },
      cmd('stash.preview', 'Preview Applying…', { enabled: !!stash }),
      cmd('stash.apply', 'Apply', { enabled: !!stash }),
      cmd('stash.pop', 'Apply and Remove', { enabled: !!stash })
    ]
  }

  const windowMenu: Item = mac
    ? { role: 'windowMenu' }
    : { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] }

  const help: Item = {
    role: 'help',
    submenu: [
      { id: 'help.docs', label: 'Git Pro Documentation', click: env.openDocs },
      cmd('app.shortcuts', 'Keyboard Shortcuts'),
      ...(mac ? [] : [SEP, { role: 'about', label: 'About Git Pro' } as Item])
    ]
  }

  return [
    ...(mac ? [appMenu] : []),
    file,
    edit,
    view,
    repository,
    branchMenu,
    changes,
    commit,
    stashMenu,
    windowMenu,
    help
  ]
}

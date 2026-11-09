import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { buildMenuTemplate, type MenuEnv } from '../src/main/menuTemplate'
import {
  ACCELERATORS,
  EMPTY_MENU_STATE,
  SHORTCUT_GROUPS,
  prettyAccelerator,
  type MenuState
} from '../src/shared/menu'

type Item = MenuItemConstructorOptions

/** Electron's built-in accelerators for the roles we use. */
const ROLE_ACCELERATORS: Record<string, string> = {
  undo: 'CmdOrCtrl+Z',
  redo: 'CmdOrCtrl+Shift+Z',
  cut: 'CmdOrCtrl+X',
  copy: 'CmdOrCtrl+C',
  paste: 'CmdOrCtrl+V',
  pasteAndMatchStyle: 'CmdOrCtrl+Alt+Shift+V',
  selectAll: 'CmdOrCtrl+A',
  close: 'CmdOrCtrl+W',
  quit: 'CmdOrCtrl+Q',
  hide: 'CmdOrCtrl+H',
  hideOthers: 'CmdOrCtrl+Alt+H',
  minimize: 'CmdOrCtrl+M',
  resetZoom: 'CmdOrCtrl+0',
  zoomIn: 'CmdOrCtrl+Plus',
  zoomOut: 'CmdOrCtrl+-',
  togglefullscreen: 'Ctrl+CmdOrCtrl+F',
  toggleDevTools: 'CmdOrCtrl+Alt+I',
  reload: 'CmdOrCtrl+R'
}

function env(send = vi.fn()): MenuEnv {
  return { mac: true, dev: true, send, openDocs: vi.fn(), clearRecent: vi.fn() }
}

function flatten(items: Item[]): Item[] {
  return items.flatMap((i) => [
    i,
    ...(Array.isArray(i.submenu) ? flatten(i.submenu as Item[]) : [])
  ])
}

function byId(items: Item[], id: string): Item {
  const hit = flatten(items).find((i) => i.id === id)
  if (!hit) throw new Error(`no menu item ${id}`)
  return hit
}

const withRepo: MenuState = {
  ...EMPTY_MENU_STATE,
  repo: { name: 'demo', path: '/Users/me/demo' },
  recent: ['/Users/me/demo', '/Users/me/other'],
  branches: ['feature/x', 'main'],
  currentBranch: 'main',
  remotes: ['origin', 'upstream'],
  hasHead: true,
  hasUpstream: true,
  changes: 3,
  staged: 1
}

describe('application menu', () => {
  it.each([true, false])('has no duplicate shortcuts (mac=%s)', (mac) => {
    for (const state of [EMPTY_MENU_STATE, withRepo]) {
      const items = flatten(buildMenuTemplate(state, { ...env(), mac }))
      const seen = new Map<string, string>()
      for (const i of items) {
        const accel =
          (i.accelerator as string | undefined) ?? (i.role ? ROLE_ACCELERATORS[i.role] : undefined)
        if (!accel) continue
        const label = String(i.label ?? i.role)
        expect(
          seen.get(accel),
          `${accel} used by "${seen.get(accel)}" and "${label}"`
        ).toBeUndefined()
        seen.set(accel, label)
      }
    }
  })

  it('disables repository commands until a repository is open', () => {
    const m = buildMenuTemplate(EMPTY_MENU_STATE, env())
    expect(byId(m, 'repo.open').enabled).toBe(true)
    expect(byId(m, 'repo.clone').enabled).toBe(true)
    for (const id of [
      'remote.push',
      'remote.fetchAll',
      'view.graph',
      'commit.edit',
      'stash.new',
      'branch.new',
      'find'
    ]) {
      expect(byId(m, id).enabled, id).toBe(false)
    }
    const open = buildMenuTemplate(withRepo, env())
    for (const id of [
      'remote.push',
      'remote.fetchAll',
      'remote.pull',
      'view.graph',
      'stash.new',
      'branch.new',
      'find'
    ]) {
      expect(byId(open, id).enabled, id).toBe(true)
    }
    expect(byId(open, 'commit.edit').enabled).toBe(false) // nothing selected yet
  })

  it('reflects the selected commit, stash and in-progress operation', () => {
    const conflicted = buildMenuTemplate(
      {
        ...withRepo,
        selectedCommit: { sha: 'abcdef1234567890', subject: 'Fix the thing' },
        selectedStash: { label: 'WIP parser' },
        op: { kind: 'rebase', conflicted: 2 }
      },
      env()
    )
    expect(byId(conflicted, 'commit.selected').label).toContain('abcdef12')
    expect(byId(conflicted, 'commit.copySha').enabled).toBe(true)
    expect(byId(conflicted, 'commit.edit').enabled).toBe(false) // not while rebasing
    expect(byId(conflicted, 'stash.apply').enabled).toBe(true)
    expect(byId(conflicted, 'op.resolve').enabled).toBe(true)
    expect(byId(conflicted, 'op.continue')).toMatchObject({
      label: 'Continue Rebase',
      enabled: false
    })
    expect(byId(conflicted, 'op.abort')).toMatchObject({ label: 'Abort Rebase…', enabled: true })
    expect(byId(conflicted, 'remote.pull').enabled).toBe(false)

    const resolved = buildMenuTemplate(
      { ...withRepo, op: { kind: 'rebase', conflicted: 0 } },
      env()
    )
    expect(byId(resolved, 'op.continue').enabled).toBe(true)
    expect(byId(resolved, 'op.resolve').enabled).toBe(false)
  })

  it('lists recent repositories, branches, remotes and themes, and routes clicks', () => {
    const send = vi.fn()
    const m = buildMenuTemplate({ ...withRepo, theme: 'nord' }, env(send))
    expect(byId(m, 'repo.openRecent:/Users/me/demo').enabled).toBe(false) // already open
    expect(byId(m, 'repo.openRecent:/Users/me/other').label).toBe('other  —  ~/other')
    expect(byId(m, 'branch.checkout:main')).toMatchObject({ type: 'radio', checked: true })
    expect(byId(m, 'branch.checkout:feature/x').checked).toBe(false)
    expect(byId(m, 'remote.fetch:upstream').label).toBe('upstream')
    expect(byId(m, 'view.theme:nord').checked).toBe(true)
    expect(byId(m, 'branch.rename').label).toBe('Rename “main”…')
    ;(byId(m, 'branch.checkout:feature/x').click as () => void)()
    ;(byId(m, 'remote.push').click as () => void)()
    expect(send.mock.calls).toEqual([
      ['branch.checkout', 'feature/x'],
      ['remote.push', undefined]
    ])
  })

  it('documents every shortcut and wires every shortcut to a menu item', () => {
    const documented = new Set(SHORTCUT_GROUPS.flatMap((g) => g.items.map(([c]) => c)))
    const ids = new Set(flatten(buildMenuTemplate(withRepo, env())).map((i) => i.id))
    for (const cmd of Object.keys(ACCELERATORS)) {
      expect(documented.has(cmd as never), `${cmd} missing from SHORTCUT_GROUPS`).toBe(true)
      expect(ids.has(cmd), `${cmd} has no menu item`).toBe(true)
    }
  })

  it('formats accelerators for each platform', () => {
    expect(prettyAccelerator('CmdOrCtrl+Shift+P', true)).toBe('⇧⌘P')
    expect(prettyAccelerator('CmdOrCtrl+Enter', true)).toBe('⌘↵')
    expect(prettyAccelerator('CmdOrCtrl+Shift+P', false)).toBe('Ctrl+Shift+P')
  })
})

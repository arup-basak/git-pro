import { app, BrowserWindow, Menu, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { EMPTY_MENU_STATE, type MenuCommand, type MenuState } from '../shared/menu'
import { EVENT_CHANNEL } from '../shared/api'
import type { AppEvent } from '../shared/types'
import { buildMenuTemplate } from './menuTemplate'
import { clearRecent } from './store'

let state: MenuState = EMPTY_MENU_STATE
let lastJson = ''

function targetWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

function send(command: MenuCommand, arg?: string): void {
  const win = targetWindow()
  if (!win) return
  const event: AppEvent = { type: 'menu', command, arg }
  win.webContents.send(EVENT_CHANNEL, event)
}

function docsPath(): string | null {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'README.md')]
    : [join(app.getAppPath(), 'README.md'), join(process.cwd(), 'README.md')]
  return candidates.find((p) => existsSync(p)) ?? null
}

function render(): void {
  const template = buildMenuTemplate(state, {
    mac: process.platform === 'darwin',
    dev: !app.isPackaged,
    send,
    openDocs: () => {
      const p = docsPath()
      if (p) void shell.openPath(p)
    },
    clearRecent: () => {
      clearRecent()
      state = { ...state, recent: [] }
      render()
      send('repo.clearRecent')
    }
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** Installs the menu (initially for "no repository open"). */
export function installMenu(): void {
  render()
}

/** Called by the renderer whenever something the menu depends on changes. */
export function updateMenuState(next: MenuState): void {
  const json = JSON.stringify(next)
  if (json === lastJson) return
  lastJson = json
  state = next
  render()
  const win = targetWindow()
  if (win) {
    win.setTitle(next.repo ? `${next.repo.name} — Git Pro` : 'Git Pro')
    if (process.platform === 'darwin') win.setRepresentedFilename(next.repo?.path ?? '')
  }
}

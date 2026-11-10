import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import icon from '../../resources/icon.png?asset'
import { execFile } from 'node:child_process'
import { EVENT_CHANNEL } from '../shared/api'
import type { AppEvent } from '../shared/types'
import { registerIpc, stopWatchers } from './ipc'
import { installMenu } from './menu'
import { loadShellPath } from './shellPath'
import { addRecent } from './store'
import { killAllTerminals } from './terminal'

const rendererUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined

/**
 * Toolbar height in the renderer (Tailwind `h-11`). On macOS the native title bar is hidden and
 * the traffic lights are centred in this row instead.
 */
const TITLEBAR_HEIGHT = 44
const TRAFFIC_LIGHT_SIZE = 14

function createWindow(): void {
  const mac = process.platform === 'darwin'
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    title: 'Git Pro',
    backgroundColor: '#0b0d10',
    ...(mac
      ? {
          titleBarStyle: 'hidden' as const,
          trafficLightPosition: { x: 16, y: (TITLEBAR_HEIGHT - TRAFFIC_LIGHT_SIZE) / 2 }
        }
      : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())
  // The window title is driven by the open repository (see menu.ts), not the page <title>.
  win.on('page-title-updated', (e) => e.preventDefault())

  // Fullscreen hides the traffic lights, so the renderer drops the space it keeps for them.
  const sendFullscreen = (fullscreen: boolean): void => {
    const event: AppEvent = { type: 'window', fullscreen }
    if (!win.isDestroyed()) win.webContents.send(EVENT_CHANNEL, event)
  }
  win.on('enter-full-screen', () => sendFullscreen(true))
  win.on('leave-full-screen', () => sendFullscreen(false))

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (rendererUrl && url.startsWith(rendererUrl)) return
    e.preventDefault()
  })

  if (rendererUrl) void win.loadURL(rendererUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

loadShellPath()

function setAboutPanel(): void {
  execFile('git', ['--version'], (err, out) => {
    app.setAboutPanelOptions({
      applicationName: 'Git Pro',
      applicationVersion: app.getVersion(),
      version: err ? 'git not found' : out.trim(),
      credits: 'Full manual control over Git commits, history, stashes and pushes.'
    })
  })
}

// Test hooks: isolate settings and pre-seed a recent repository (native folder dialogs can't be automated).
if (process.env.GITPRO_USER_DATA) app.setPath('userData', process.env.GITPRO_USER_DATA)

app.whenReady().then(() => {
  app.setAppUserModelId('com.gitpro.app')
  registerIpc(rendererUrl)
  installMenu()
  setAboutPanel()
  if (process.env.GITPRO_SEED_REPO) addRecent(process.env.GITPRO_SEED_REPO)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// ⌘Q skips window-all-closed; make sure no shell outlives the app.
app.on('will-quit', killAllTerminals)

app.on('window-all-closed', () => {
  stopWatchers()
  if (process.platform !== 'darwin') app.quit()
})

import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { realpathSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { EVENT_CHANNEL, INVOKE_CHANNEL, type GitProApi, type InvokeEnvelope } from '../shared/api'
import type { AppEvent, RepoInfo } from '../shared/types'
import * as backup from './git/backup'
import * as branches from './git/branches'
import * as commits from './git/commits'
import * as history from './git/history'
import * as hunks from './git/hunks'
import * as integrate from './git/integrate'
import * as log from './git/log'
import * as merge from './git/merge'
import * as op from './git/opstate'
import * as reflog from './git/reflog'
import * as remotes from './git/remotes'
import { GitError, git, setCommandLogSink } from './git/runner'
import * as stash from './git/stash'
import * as tags from './git/tags'
import { assertSafe, gitDir } from './git/util'
import * as wt from './git/worktree'
import { addRecent, loadSettings, removeRecent } from './store'
import { updateMenuState } from './menu'
import { RepoWatcher } from './watcher'

/** Repos the user explicitly opened (dialog / recent list). Renderer calls may only target these. */
const openRepos = new Map<string, RepoWatcher>()

function broadcast(event: AppEvent): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(EVENT_CHANNEL, event)
  }
}

function repo(repoId: string): string {
  if (!openRepos.has(repoId)) throw new Error('This repository is not open')
  return repoId
}

function progress(repoId: string): (line: string) => void {
  return (line) => broadcast({ type: 'progress', repoId, line })
}

function insideRepo(repoId: string, rel: string): string {
  const abs = resolve(repoId, rel)
  const r = relative(repoId, abs)
  if (r.startsWith('..') || isAbsolute(r)) throw new Error('Path is outside the repository')
  return abs
}

async function openRepo(dir: string): Promise<RepoInfo> {
  const r = await git(dir, ['rev-parse', '--show-toplevel'], { allowFail: true })
  if (r.code !== 0) throw new Error(`${dir} is not inside a Git repository`)
  const top = realpathSync(r.stdout.trim())
  if (!openRepos.has(top)) {
    const watcher = new RepoWatcher(top, await gitDir(top), (scope) =>
      broadcast({ type: 'repo-changed', repoId: top, scope })
    )
    watcher.start()
    openRepos.set(top, watcher)
  }
  addRecent(top)
  return { id: top, path: top, name: basename(top) }
}

function focusedWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

async function pickDirectory(title: string, create = false): Promise<string | null> {
  const win = focusedWindow()
  const opts: Electron.OpenDialogOptions = {
    title,
    properties: ['openDirectory', ...(create ? (['createDirectory'] as const) : [])]
  }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  return res.canceled || !res.filePaths[0] ? null : res.filePaths[0]
}

type Handlers = {
  [K in keyof GitProApi]: (...args: Parameters<GitProApi[K]>) => ReturnType<GitProApi[K]>
}

const handlers: Handlers = {
  'app.menuState': async (state) => updateMenuState(state),
  'repo.pick': async () => {
    const dir = await pickDirectory('Open Git repository')
    return dir ? openRepo(dir) : null
  },
  'repo.openRecent': async (path) => {
    if (!loadSettings().recent.includes(path)) throw new Error('Not a recent repository')
    return openRepo(path)
  },
  'repo.recent': async () => loadSettings().recent,
  'repo.forget': async (path) => {
    removeRecent(path)
    openRepos.get(path)?.stop()
    openRepos.delete(path)
  },
  'repo.init': async () => {
    const dir = await pickDirectory('Choose a folder to initialise', true)
    if (!dir) return null
    await git(dir, ['init'], { write: true })
    return openRepo(dir)
  },
  'repo.clone': async (url) => {
    assertSafe(url.trim(), 'URL')
    const parent = await pickDirectory('Clone into folder…', true)
    if (!parent) return null
    const name =
      basename(
        url
          .trim()
          .replace(/\/+$/, '')
          .replace(/\.git$/, '')
      ) || 'repo'
    const dest = join(parent, name)
    await git(parent, ['clone', '--progress', url.trim(), dest], {
      write: true,
      onProgress: progress('')
    })
    return openRepo(dest)
  },
  'repo.reveal': async (repoId, relPath) => {
    const base = repo(repoId)
    if (relPath) shell.showItemInFolder(insideRepo(base, relPath))
    else await shell.openPath(base)
  },
  'repo.openFile': async (repoId, relPath) => {
    const err = await shell.openPath(insideRepo(repo(repoId), relPath))
    if (err) throw new Error(err)
  },
  'repo.identity': async (repoId) => wt.identity(repo(repoId)),

  'log.list': async (repoId, q) => log.listLog(repo(repoId), q),
  'commit.detail': async (repoId, sha) => log.commitDetail(repo(repoId), sha),
  'commit.diff': async (repoId, sha, paths) => log.commitDiff(repo(repoId), sha, paths),
  'refs.snapshot': async (repoId) => log.refsSnapshot(repo(repoId)),

  'status.get': async (repoId) => wt.getStatus(repo(repoId)),
  'worktree.diff': async (repoId, path, staged, untracked) =>
    wt.worktreeDiff(repo(repoId), path, staged, untracked),
  'worktree.stage': async (repoId, paths) => wt.stage(repo(repoId), paths),
  'worktree.unstage': async (repoId, paths) => wt.unstage(repo(repoId), paths),
  'worktree.discard': async (repoId, tracked, untracked) =>
    wt.discard(repo(repoId), tracked, untracked),
  'worktree.applyLines': async (repoId, action, sel) => hunks.applyLines(repo(repoId), action, sel),
  'worktree.commit': async (repoId, req) => wt.commit(repo(repoId), req),

  'branch.create': async (repoId, name, start, checkout) =>
    branches.createBranch(repo(repoId), name, start, checkout),
  'branch.checkout': async (repoId, name) => branches.checkoutBranch(repo(repoId), name),
  'branch.checkoutRemote': async (repoId, remoteShort, localName) =>
    branches.checkoutRemoteBranch(repo(repoId), remoteShort, localName),
  'branch.rename': async (repoId, o, n) => branches.renameBranch(repo(repoId), o, n),
  'branch.delete': async (repoId, name, force) => branches.deleteBranch(repo(repoId), name, force),
  'branch.setUpstream': async (repoId, name, upstream) =>
    branches.setUpstream(repo(repoId), name, upstream),
  'branch.mergePreview': async (repoId, source, target) =>
    integrate.mergePreview(repo(repoId), source, target),
  'branch.merge': async (repoId, req) => integrate.mergeBranch(repo(repoId), req),
  'branch.rebasePreview': async (repoId, branch, onto) =>
    integrate.rebasePreview(repo(repoId), branch, onto),
  'branch.rebaseOnto': async (repoId, req) => integrate.rebaseOnto(repo(repoId), req),

  'remote.fetch': async (repoId, remote, prune) =>
    remotes.fetch(repo(repoId), remote, prune, progress(repoId)),
  'remote.pull': async (repoId, mode) => remotes.pull(repo(repoId), mode, progress(repoId)),
  'remote.push': async (repoId, spec) => remotes.push(repo(repoId), spec, progress(repoId)),
  'remote.deleteBranch': async (repoId, remote, name) =>
    remotes.deleteRemoteBranch(repo(repoId), remote, name),
  'remote.add': async (repoId, name, url) => remotes.addRemote(repo(repoId), name, url),
  'remote.remove': async (repoId, name) => remotes.removeRemote(repo(repoId), name),
  'remote.setUrl': async (repoId, name, url) => remotes.setRemoteUrl(repo(repoId), name, url),

  'commit.checkout': async (repoId, sha) => commits.checkoutDetached(repo(repoId), sha),
  'commit.cherryPick': async (repoId, sha) => commits.cherryPick(repo(repoId), sha),
  'commit.revert': async (repoId, sha) => commits.revert(repo(repoId), sha),
  'commit.reset': async (repoId, sha, mode) => commits.reset(repo(repoId), sha, mode),

  'op.continue': async (repoId) => op.continueOp(repo(repoId)),
  'op.abort': async (repoId) => op.abortOp(repo(repoId)),
  'op.skip': async (repoId) => op.skipOp(repo(repoId)),

  'history.range': async (repoId, tip, base) => history.loadRange(repo(repoId), tip, base),
  'history.apply': async (repoId, plan) => history.applyPlan(repo(repoId), plan, progress(repoId)),

  'stash.list': async (repoId) => stash.overview(repo(repoId)),
  'stash.save': async (repoId, req) => stash.saveStash(repo(repoId), req),
  'stash.files': async (repoId, sha) => stash.stashFiles(repo(repoId), sha),
  'stash.diff': async (repoId, sha, path) => stash.stashDiff(repo(repoId), sha, path),
  'stash.preview': async (repoId, sha) => stash.previewApply(repo(repoId), sha),
  'stash.apply': async (repoId, target, opts) => stash.applyStash(repo(repoId), target, opts),
  'stash.update': async (repoId, id, patch) => stash.updateStash(repo(repoId), id, patch),
  'stash.delete': async (repoId, target) => stash.deleteStash(repo(repoId), target),
  'stash.restore': async (repoId, id) => stash.restoreStash(repo(repoId), id),
  'stash.purge': async (repoId, id) => stash.purgeStash(repo(repoId), id),
  'stash.adopt': async (repoId, index, sha, name, group) =>
    stash.adoptStash(repo(repoId), index, sha, name, group),
  'stash.toBranch': async (repoId, target, branch) =>
    stash.stashToBranch(repo(repoId), target, branch),

  'merge.versions': async (repoId, path, source) => merge.mergeVersions(repo(repoId), path, source),
  'merge.resolve': async (repoId, path, res) => merge.resolveConflict(repo(repoId), path, res),
  'tree.diff': async (repoId, from, to, path) => merge.treeDiff(repo(repoId), from, to, path),

  'tag.create': async (repoId, name, target, annotation) =>
    tags.createTag(repo(repoId), name, target, annotation),
  'tag.delete': async (repoId, name) => tags.deleteTag(repo(repoId), name),
  'tag.push': async (repoId, remote, name) => tags.pushTag(repo(repoId), remote, name),
  'tag.deleteRemote': async (repoId, remote, name) =>
    tags.deleteRemoteTag(repo(repoId), remote, name),

  'reflog.list': async (repoId, ref, limit) => reflog.listReflog(repo(repoId), ref, limit),

  'backup.list': async (repoId) => backup.listBackups(repo(repoId)),
  'backup.restore': async (repoId, ref, mode, newName) =>
    backup.restoreBackup(repo(repoId), ref, mode, newName),
  'backup.delete': async (repoId, ref) => backup.deleteBackup(repo(repoId), ref)
}

function isTrustedSender(event: IpcMainInvokeEvent, rendererUrl: string | undefined): boolean {
  const url = event.senderFrame?.url ?? ''
  if (rendererUrl && url.startsWith(rendererUrl)) return true
  return url.startsWith('file://')
}

export function registerIpc(rendererUrl: string | undefined): void {
  setCommandLogSink((entry) => broadcast({ type: 'command', entry }))
  ipcMain.handle(INVOKE_CHANNEL, async (event, method: string, args: unknown[]) => {
    if (!isTrustedSender(event, rendererUrl)) {
      return { ok: false, error: { message: 'Untrusted sender' } } satisfies InvokeEnvelope<never>
    }
    const fn = (handlers as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[
      method
    ]
    if (!fn || !Object.prototype.hasOwnProperty.call(handlers, method)) {
      return {
        ok: false,
        error: { message: `Unknown method ${method}` }
      } satisfies InvokeEnvelope<never>
    }
    try {
      const value = await fn(...(Array.isArray(args) ? args : []))
      return { ok: true, value } satisfies InvokeEnvelope<unknown>
    } catch (e) {
      const err = e as Error
      const detail =
        e instanceof GitError
          ? [`$ git ${e.args.join(' ')}`, e.stderr.trim(), e.stdout.trim()]
              .filter(Boolean)
              .join('\n')
          : undefined
      return { ok: false, error: { message: err.message, detail } } satisfies InvokeEnvelope<never>
    }
  })
}

export function stopWatchers(): void {
  for (const w of openRepos.values()) w.stop()
  openRepos.clear()
}

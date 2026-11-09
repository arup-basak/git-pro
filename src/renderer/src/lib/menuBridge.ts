import type { MenuCommand, MenuState } from '@shared/menu'
import type { RefsSnapshot, RepoStatus, StashOverview, StashTarget } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import {
  addRemote,
  applyStash,
  checkoutBranch,
  checkoutCommit,
  cherryPick,
  copy,
  createBranchAt,
  createTagAt,
  discardChanges,
  editHistoryFrom,
  fetchRemote,
  opAbort,
  opContinue,
  opSkip,
  openLiveMerge,
  pull,
  queryClient,
  renameBranch,
  resetTo,
  revertCommit,
  setUpstream,
  stagePaths,
  stashSave,
  unstagePaths
} from './actions'
import { call } from './api'
import { invalidateRepo, keys } from './queries'
import { useViewSettings } from './settings'
import { useUi } from './store'
import { cloneRepo, initRepo, openRecentRepo, pickRepo } from './useOpenRepo'

/* ---------------- state → menu ---------------- */

/** Reports everything the application menu depends on to the main process. */
export function useMenuState(): void {
  const repo = useUi((s) => s.repo)
  const view = useUi((s) => s.view)
  const logOpen = useUi((s) => s.logOpen)
  const selectedSha = useUi((s) => s.selectedSha)
  const stashSel = useUi((s) => s.stashSel)
  const syntax = useViewSettings((s) => s.syntax)
  const wordDiff = useViewSettings((s) => s.wordDiff)
  const wrap = useViewSettings((s) => s.wrap)
  const theme = useViewSettings((s) => s.theme)
  const repoId = repo?.id ?? ''
  const enabled = !!repo

  const recent = useQuery({ queryKey: ['recent'], queryFn: () => call('repo.recent') })
  const refs = useQuery({
    queryKey: keys.refs(repoId),
    queryFn: () => call('refs.snapshot', repoId),
    enabled
  })
  const status = useQuery({
    queryKey: keys.status(repoId),
    queryFn: () => call('status.get', repoId),
    enabled
  })
  const stashes = useQuery({
    queryKey: keys.stashes(repoId),
    queryFn: () => call('stash.list', repoId),
    enabled
  })
  const detail = useQuery({
    queryKey: keys.detail(repoId, selectedSha ?? ''),
    queryFn: () => call('commit.detail', repoId, selectedSha!),
    enabled: enabled && !!selectedSha,
    staleTime: Infinity
  })

  const entries = status.data?.entries ?? []
  const current = refs.data?.branches.find((b) => b.current)
  const stashLabel = !stashSel
    ? null
    : stashSel.kind === 'app'
      ? stashes.data?.app.find((s) => s.id === stashSel.id)?.name
      : stashes.data?.stack.find((s) => s.sha === stashSel.sha)?.ref

  const state: MenuState = {
    repo: repo ? { name: repo.name, path: repo.path } : null,
    recent: recent.data ?? [],
    branches: refs.data?.branches.map((b) => b.name) ?? [],
    currentBranch: refs.data?.currentBranch ?? null,
    remotes: refs.data?.remotes.map((r) => r.name) ?? [],
    hasHead: !!refs.data?.head,
    hasUpstream: !!current?.upstream,
    changes: entries.length,
    staged: entries.filter((e) => !e.untracked && !e.conflicted && e.index !== '.').length,
    op: {
      kind: status.data?.op.kind ?? 'none',
      conflicted: status.data?.op.conflicted.length ?? 0
    },
    view,
    logOpen,
    selectedCommit:
      selectedSha && detail.data?.sha === selectedSha
        ? { sha: selectedSha, subject: detail.data.subject }
        : selectedSha
          ? { sha: selectedSha, subject: '' }
          : null,
    selectedStash: stashLabel ? { label: stashLabel } : null,
    syntax,
    wordDiff,
    wrap,
    theme
  }
  const json = JSON.stringify(state)
  useEffect(() => {
    const t = setTimeout(() => {
      call('app.menuState', JSON.parse(json) as MenuState).catch(() => undefined)
    }, 60)
    return () => clearTimeout(t)
  }, [json])
}

/* ---------------- menu → actions ---------------- */

/** Runs after the next view has mounted (menu commands often switch views first). */
function soon(fn: () => void): void {
  setTimeout(fn, 60)
}

function focus(selector: string): void {
  soon(() => document.querySelector<HTMLElement>(selector)?.focus())
}

function openPushFor(branch: string | null, refs: RefsSnapshot | undefined): void {
  const ui = useUi.getState()
  const info = refs?.branches.find((b) => b.name === branch)
  const upstream = info?.upstream
  ui.openPush({
    sourceKind: 'branch',
    source: branch ?? undefined,
    remote: upstream?.split('/')[0] ?? refs?.remotes[0]?.name,
    dest: upstream ? upstream.split('/').slice(1).join('/') : (branch ?? undefined)
  })
}

export async function runMenuCommand(command: MenuCommand, arg?: string): Promise<void> {
  const ui = useUi.getState()
  const settings = useViewSettings.getState()

  // Commands that work without an open repository.
  switch (command) {
    case 'app.settings':
      ui.setSettingsOpen(true)
      return
    case 'app.shortcuts':
      ui.setShortcutsOpen(true)
      return
    case 'repo.init':
      return initRepo()
    case 'repo.open':
      return pickRepo()
    case 'repo.clone':
      return cloneRepo()
    case 'repo.openRecent':
      if (arg) await openRecentRepo(arg)
      return
    case 'repo.clearRecent':
      void queryClient.invalidateQueries({ queryKey: ['recent'] })
      return
    case 'view.syntax':
      settings.set({ syntax: !settings.syntax })
      return
    case 'view.wordDiff':
      settings.set({ wordDiff: !settings.wordDiff })
      return
    case 'view.wrap':
      settings.set({ wrap: !settings.wrap })
      return
    case 'view.theme':
      if (arg) settings.set({ theme: arg, syntax: true })
      return
  }

  const repo = ui.repo
  if (!repo) return
  const repoId = repo.id
  const refs = queryClient.getQueryData<RefsSnapshot>(keys.refs(repoId))
  const status = queryClient.getQueryData<RepoStatus>(keys.status(repoId))
  const branch = refs?.currentBranch ?? null
  const entries = status?.entries ?? []

  switch (command) {
    case 'repo.close':
      ui.setRepo(null)
      return
    case 'repo.reveal':
      await call('repo.reveal', repoId)
      return
    case 'repo.refresh':
      await invalidateRepo(queryClient, repoId)
      return
    case 'find':
      ui.setView('graph')
      focus('[data-graph-search]')
      return
    case 'view.graph':
      ui.setView('graph')
      return
    case 'view.changes':
      ui.setView('changes')
      return
    case 'view.stashes':
      ui.setView('stashes')
      return
    case 'view.history':
      ui.setView('history')
      return
    case 'view.reflog':
      ui.setView('reflog')
      return
    case 'view.backups':
      ui.setView('backups')
      return
    case 'view.log':
      ui.toggleLog()
      return

    case 'remote.fetchAll':
      await fetchRemote(null)
      return
    case 'remote.fetch':
      if (arg) await fetchRemote(arg)
      return
    case 'remote.pull':
      await pull('ff-only')
      return
    case 'remote.pullMerge':
      await pull('merge')
      return
    case 'remote.pullRebase':
      await pull('rebase')
      return
    case 'remote.push':
    case 'branch.push':
      openPushFor(branch, refs)
      return
    case 'remote.add':
      await addRemote()
      return

    case 'history.edit':
      ui.openHistory({ tip: branch ?? 'HEAD', base: { count: 10 } })
      return
    case 'op.resolve': {
      const conflicted = status?.op.conflicted ?? []
      openLiveMerge(conflicted, status?.op.detail ?? 'Resolve conflicts')
      return
    }
    case 'op.continue':
      await opContinue()
      return
    case 'op.skip':
      await opSkip()
      return
    case 'op.abort':
      await opAbort(status?.op.kind ?? 'operation')
      return

    case 'branch.new':
      await createBranchAt(refs?.head ?? 'HEAD', branch ?? 'HEAD')
      return
    case 'branch.checkout':
      if (arg && arg !== branch) await checkoutBranch(arg)
      return
    case 'branch.rename':
      if (branch) await renameBranch(branch)
      return
    case 'branch.upstream': {
      if (!branch) return
      const upstream = refs?.branches.find((b) => b.name === branch)?.upstream
      await setUpstream(branch, refs?.remoteBranches.map((r) => r.short) ?? [], upstream)
      return
    }
    case 'branch.show': {
      if (!branch) return
      ui.setGraphRef(branch)
      ui.select(refs?.branches.find((b) => b.name === branch)?.sha ?? null)
      ui.setView('graph')
      return
    }

    case 'changes.commit':
      ui.setView('changes')
      focus('[data-commit-message]')
      return
    case 'changes.amend':
      ui.setView('changes')
      soon(() => {
        window.dispatchEvent(new Event('gitpro:amend'))
        document.querySelector<HTMLElement>('[data-commit-message]')?.focus()
      })
      return
    case 'changes.stageAll':
      await stagePaths(
        entries
          .filter((e) => !e.conflicted && (e.untracked || e.worktree !== '.'))
          .map((e) => e.path)
      )
      return
    case 'changes.unstageAll':
      await unstagePaths(
        entries.filter((e) => !e.untracked && !e.conflicted && e.index !== '.').map((e) => e.path)
      )
      return
    case 'changes.discardAll':
      await discardChanges(entries.filter((e) => !e.conflicted))
      return

    case 'stash.new':
      stashSave()
      return
    case 'stash.staged':
      stashSave({ staged: true })
      return
    case 'stash.preview':
      ui.setView('stashes')
      soon(() => window.dispatchEvent(new Event('gitpro:stash-preview')))
      return
    case 'stash.apply':
    case 'stash.pop': {
      const t = ui.stashSel
      if (!t) return
      const ov = queryClient.getQueryData<StashOverview>(keys.stashes(repoId))
      const label =
        t.kind === 'app'
          ? (ov?.app.find((s) => s.id === t.id)?.name ?? 'stash')
          : (ov?.stack.find((s) => s.sha === t.sha)?.ref ?? 'stash')
      await applyStash(t as StashTarget, label, command === 'stash.pop')
      return
    }
  }

  // Commands on the selected commit.
  const sha = ui.selectedSha
  if (!sha) return
  switch (command) {
    case 'commit.edit': {
      const d = await queryClient.fetchQuery({
        queryKey: keys.detail(repoId, sha),
        queryFn: () => call('commit.detail', repoId, sha),
        staleTime: Infinity
      })
      editHistoryFrom(d.sha, d.parents[0] ?? null, ui.graphRef ?? branch ?? undefined)
      return
    }
    case 'commit.push':
      ui.openPush({ sourceKind: 'commit', source: sha })
      return
    case 'commit.branch':
      await createBranchAt(sha)
      return
    case 'commit.tag':
      await createTagAt(sha)
      return
    case 'commit.checkout':
      await checkoutCommit(sha)
      return
    case 'commit.cherryPick':
      await cherryPick(sha)
      return
    case 'commit.revert':
      await revertCommit(sha)
      return
    case 'commit.reset':
      await resetTo(sha, branch)
      return
    case 'commit.copySha':
      copy(sha, 'SHA copied')
      return
  }
}

/** Subscribes to menu clicks and accelerators coming from the main process. */
export function useMenuCommands(): void {
  useEffect(
    () =>
      window.gitPro.on((ev) => {
        if (ev.type === 'menu') void runMenuCommand(ev.command, ev.arg)
      }),
    []
  )
}

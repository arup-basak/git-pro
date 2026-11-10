import type { LogQuery } from '@shared/api'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { call, errorParts } from './api'
import { useUi } from './store'

export const keys = {
  all: (repoId: string) => ['repo', repoId] as const,
  refs: (repoId: string) => ['repo', repoId, 'refs'] as const,
  status: (repoId: string) => ['repo', repoId, 'status'] as const,
  log: (repoId: string, q: LogQuery) => ['repo', repoId, 'log', q] as const,
  detail: (repoId: string, sha: string) => ['repo', repoId, 'detail', sha] as const,
  stashes: (repoId: string) => ['repo', repoId, 'stashes'] as const,
  backups: (repoId: string) => ['repo', repoId, 'backups'] as const,
  reflog: (repoId: string, ref: string) => ['repo', repoId, 'reflog', ref] as const,
  bisect: (repoId: string) => ['repo', repoId, 'bisect'] as const,
  worktrees: (repoId: string) => ['repo', repoId, 'worktrees'] as const,
  tracking: (repoId: string) => ['repo', repoId, 'tracking'] as const
}

export function useRepoId(): string {
  const repo = useUi((s) => s.repo)
  if (!repo) throw new Error('No repository open')
  return repo.id
}

export function useRefs() {
  const repoId = useRepoId()
  return useQuery({ queryKey: keys.refs(repoId), queryFn: () => call('refs.snapshot', repoId) })
}

export function useStatus() {
  const repoId = useRepoId()
  return useQuery({ queryKey: keys.status(repoId), queryFn: () => call('status.get', repoId) })
}

export function useLog(q: LogQuery) {
  const repoId = useRepoId()
  return useQuery({
    queryKey: keys.log(repoId, q),
    queryFn: () => call('log.list', repoId, q),
    placeholderData: (prev) => prev
  })
}

export function useCommitDetail(sha: string | null) {
  const repoId = useRepoId()
  return useQuery({
    queryKey: keys.detail(repoId, sha ?? ''),
    queryFn: () => call('commit.detail', repoId, sha!),
    enabled: !!sha,
    staleTime: Infinity
  })
}

export function useStashes() {
  const repoId = useRepoId()
  return useQuery({ queryKey: keys.stashes(repoId), queryFn: () => call('stash.list', repoId) })
}

export function useStashFiles(sha: string | null) {
  const repoId = useRepoId()
  return useQuery({
    queryKey: ['repo', repoId, 'stash-files', sha],
    queryFn: () => call('stash.files', repoId, sha!),
    enabled: !!sha,
    staleTime: Infinity
  })
}

export function useBackups() {
  const repoId = useRepoId()
  return useQuery({ queryKey: keys.backups(repoId), queryFn: () => call('backup.list', repoId) })
}

export function invalidateRepo(qc: QueryClient, repoId: string): Promise<void> {
  return qc.invalidateQueries({
    queryKey: keys.all(repoId),
    predicate: (q) => q.queryKey[2] !== 'detail'
  })
}

export function showError(e: unknown, title?: string): void {
  const { message, detail } = errorParts(e)
  toast.error(title ?? message, {
    description: title ? message + (detail ? `\n${detail}` : '') : detail,
    duration: 12000
  })
}

/** Subscribes to main-process events: refresh on repo changes, collect the command log. */
export function useAppEvents(): void {
  const qc = useQueryClient()
  useEffect(() => {
    let progressTimer: ReturnType<typeof setTimeout> | undefined
    const off = window.gitPro.on((ev) => {
      const ui = useUi.getState()
      if (ev.type === 'command') ui.addCommand(ev.entry)
      else if (ev.type === 'progress') {
        ui.setProgress(ev.line)
        clearTimeout(progressTimer)
        progressTimer = setTimeout(() => useUi.getState().setProgress(null), 2500)
      } else if (ev.type === 'repo-changed' && ui.repo?.id === ev.repoId) {
        if (ev.scope === 'worktree') void qc.invalidateQueries({ queryKey: keys.status(ev.repoId) })
        else void invalidateRepo(qc, ev.repoId)
      }
    })
    const onFocus = (): void => {
      const repo = useUi.getState().repo
      if (repo) void invalidateRepo(qc, repo.id)
    }
    window.addEventListener('focus', onFocus)
    return () => {
      off()
      window.removeEventListener('focus', onFocus)
    }
  }, [qc])
}

import type { RepoInfo } from '@shared/types'
import { queryClient } from './actions'
import { call } from './api'
import { openForm } from './dialogs'
import { showError } from './queries'
import { useUi } from './store'

function done(r: RepoInfo | null): void {
  if (r) useUi.getState().setRepo(r)
  void queryClient.invalidateQueries({ queryKey: ['recent'] })
}

export const pickRepo = (): Promise<void> => call('repo.pick').then(done, (e) => showError(e))

export const openRecentRepo = (path: string): Promise<void> =>
  call('repo.openRecent', path).then(done, (e) => showError(e))

export const initRepo = (): Promise<void> => call('repo.init').then(done, (e) => showError(e))

export async function cloneRepo(): Promise<void> {
  const v = await openForm<{ url: string }>({
    title: 'Clone repository',
    description: 'You will be asked for the parent folder next.',
    submitLabel: 'Choose folder…',
    fields: [
      {
        name: 'url',
        label: 'Repository URL',
        type: 'text',
        required: true,
        mono: true,
        placeholder: 'git@github.com:owner/repo.git'
      }
    ]
  })
  if (v) await call('repo.clone', v.url.trim()).then(done, (e) => showError(e, 'Clone failed'))
}

export function useOpenRepo(): {
  pick: () => Promise<void>
  openRecent: (path: string) => Promise<void>
  clone: () => Promise<void>
  init: () => Promise<void>
} {
  return { pick: pickRepo, openRecent: openRecentRepo, clone: cloneRepo, init: initRepo }
}

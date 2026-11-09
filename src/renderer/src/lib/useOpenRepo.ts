import type { RepoInfo } from '@shared/types'
import { useQueryClient } from '@tanstack/react-query'
import { call } from './api'
import { openForm } from './dialogs'
import { showError } from './queries'
import { useUi } from './store'

export function useOpenRepo(): {
  pick: () => Promise<void>
  openRecent: (path: string) => Promise<void>
  clone: () => Promise<void>
  init: () => Promise<void>
} {
  const setRepo = useUi((s) => s.setRepo)
  const qc = useQueryClient()
  const done = (r: RepoInfo | null): void => {
    if (r) setRepo(r)
    void qc.invalidateQueries({ queryKey: ['recent'] })
  }
  return {
    pick: () => call('repo.pick').then(done, (e) => showError(e)),
    openRecent: (path) => call('repo.openRecent', path).then(done, (e) => showError(e)),
    init: () => call('repo.init').then(done, (e) => showError(e)),
    clone: async () => {
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
  }
}

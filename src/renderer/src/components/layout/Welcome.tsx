import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderGit2, FolderOpen, FolderPlus, GitBranchPlus, X } from 'lucide-react'
import { call } from '../../lib/api'
import { useOpenRepo } from '../../lib/useOpenRepo'
import { Button } from '../ui'
import { ViewSettingsButton } from './ViewSettings'

export function Welcome() {
  const open = useOpenRepo()
  const qc = useQueryClient()
  const recent = useQuery({ queryKey: ['recent'], queryFn: () => call('repo.recent') })
  return (
    <div className="relative flex h-full items-center justify-center">
      <div className="absolute top-3 right-3">
        <ViewSettingsButton />
      </div>
      <div className="w-[560px]">
        <div className="mb-6 flex items-center gap-3">
          <FolderGit2 size={30} className="text-accent" />
          <div>
            <h1 className="text-xl font-semibold">Git Pro</h1>
            <p className="text-muted">Full manual control over commits, history and pushes.</p>
          </div>
        </div>
        <div className="mb-6 flex gap-2">
          <Button variant="primary" icon={<FolderOpen size={14} />} onClick={open.pick}>
            Open repository…
          </Button>
          <Button icon={<GitBranchPlus size={14} />} onClick={open.clone}>
            Clone…
          </Button>
          <Button icon={<FolderPlus size={14} />} onClick={open.init}>
            New repository…
          </Button>
        </div>
        <div className="text-[11px] font-semibold tracking-wide text-faint uppercase">Recent</div>
        <div className="mt-2 overflow-hidden rounded-md border border-line">
          {(recent.data ?? []).length === 0 && (
            <div className="p-3 text-muted">No recent repositories</div>
          )}
          {(recent.data ?? []).map((p) => (
            <div
              key={p}
              className="group flex cursor-pointer items-center gap-2 border-b border-line px-3 py-2 last:border-b-0 hover:bg-hover"
              onClick={() => open.openRecent(p)}
            >
              <FolderGit2 size={14} className="text-muted" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{p.split('/').pop()}</div>
                <div className="truncate text-xs text-faint">{p}</div>
              </div>
              <button
                title="Remove from list"
                className="rounded p-1 text-faint opacity-0 group-hover:opacity-100 hover:bg-line hover:text-fg"
                onClick={(e) => {
                  e.stopPropagation()
                  void call('repo.forget', p).then(() =>
                    qc.invalidateQueries({ queryKey: ['recent'] })
                  )
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

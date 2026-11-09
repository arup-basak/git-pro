import { useQuery } from '@tanstack/react-query'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  FolderGit2,
  History,
  PackageOpen,
  RefreshCw,
  Terminal
} from 'lucide-react'
import { call } from '../../lib/api'
import { fetchRemote, pull, queryClient, stashSave } from '../../lib/actions'
import { invalidateRepo, useRefs, useStatus } from '../../lib/queries'
import { useUi } from '../../lib/store'
import { Button, DropdownButton, type MenuEntry } from '../ui'
import { useOpenRepo } from '../../lib/useOpenRepo'
import { ViewSettingsButton } from './ViewSettings'

export function Toolbar() {
  const repo = useUi((s) => s.repo)!
  const ui = useUi()
  const refs = useRefs()
  const status = useStatus()
  const open = useOpenRepo()
  const recent = useQuery({ queryKey: ['recent'], queryFn: () => call('repo.recent') })
  const current = refs.data?.currentBranch
  const remotes = refs.data?.remotes ?? []
  const branchInfo = refs.data?.branches.find((b) => b.current)
  const changes = status.data?.entries.length ?? 0

  const repoMenu: MenuEntry[] = [
    ...(recent.data ?? [])
      .filter((p) => p !== repo.path)
      .slice(0, 10)
      .map((p) => ({
        label: p.split('/').pop()!,
        hint: p.replace(/^\/Users\/[^/]+/, '~'),
        onSelect: () => open.openRecent(p)
      })),
    { separator: true },
    { label: 'Open repository…', onSelect: open.pick },
    { label: 'Clone…', onSelect: open.clone },
    { label: 'New repository…', onSelect: open.init },
    { separator: true },
    { label: 'Reveal in Finder', onSelect: () => void call('repo.reveal', repo.id) },
    { label: 'Close repository', onSelect: () => ui.setRepo(null) }
  ]

  const openPush = (): void =>
    ui.openPush({
      sourceKind: 'branch',
      source: current ?? undefined,
      remote: branchInfo?.upstream?.split('/')[0] ?? remotes[0]?.name,
      dest: branchInfo?.upstream
        ? branchInfo.upstream.split('/').slice(1).join('/')
        : (current ?? undefined)
    })

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
      <DropdownButton
        entries={repoMenu}
        trigger={
          <button className="flex h-7 items-center gap-2 rounded-md px-2 hover:bg-hover">
            <FolderGit2 size={15} className="text-accent" />
            <span className="font-semibold">{repo.name}</span>
            <ChevronDown size={12} className="text-muted" />
          </button>
        }
      />
      <span className="text-faint">/</span>
      <span className="mono rounded bg-line px-2 py-0.5 text-[12px]" title="Current branch">
        {current ?? (refs.data?.head ? `detached @ ${refs.data.head.slice(0, 8)}` : 'no commits')}
      </span>
      {branchInfo?.upstream && (
        <span className="text-xs text-muted" title={`Tracking ${branchInfo.upstream}`}>
          ↑{branchInfo.ahead ?? 0} ↓{branchInfo.behind ?? 0}
        </span>
      )}

      <div className="mx-2 h-5 w-px bg-line" />

      <DropdownButton
        entries={[
          { label: 'Fetch all remotes', onSelect: () => void fetchRemote(null) },
          ...remotes.map((r) => ({
            label: `Fetch ${r.name}`,
            onSelect: () => void fetchRemote(r.name)
          }))
        ]}
        trigger={
          <Button icon={<RefreshCw size={13} />} disabled={remotes.length === 0}>
            Fetch
          </Button>
        }
      />
      <DropdownButton
        entries={[
          { label: 'Pull (fast-forward only)', onSelect: () => void pull('ff-only') },
          { label: 'Pull (merge)', onSelect: () => void pull('merge') },
          { label: 'Pull (rebase)', onSelect: () => void pull('rebase') }
        ]}
        trigger={
          <Button icon={<ArrowDownToLine size={13} />} disabled={!branchInfo?.upstream}>
            Pull
          </Button>
        }
      />
      <Button
        icon={<ArrowUpFromLine size={13} />}
        onClick={openPush}
        disabled={remotes.length === 0}
      >
        Push…
      </Button>
      <Button
        icon={<PackageOpen size={13} />}
        onClick={() => void stashSave()}
        disabled={changes === 0}
      >
        Stash
      </Button>
      <Button
        icon={<History size={13} />}
        onClick={() => ui.openHistory({ tip: current ?? 'HEAD', base: { count: 10 } })}
        disabled={!refs.data?.head}
        title="Edit dates, authors, messages, order of recent commits"
      >
        Edit history…
      </Button>

      <div className="flex-1" />
      <ViewSettingsButton />
      <Button
        variant="ghost"
        icon={<RefreshCw size={13} />}
        onClick={() => void invalidateRepo(queryClient, repo.id)}
        title="Refresh"
      />
      <Button
        variant={ui.logOpen ? 'default' : 'ghost'}
        icon={<Terminal size={13} />}
        onClick={() => ui.toggleLog()}
        title="Command log"
      >
        Log
      </Button>
    </div>
  )
}

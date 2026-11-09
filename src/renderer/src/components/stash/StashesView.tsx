import type { AppStash, StackStash, StashTarget } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import {
  Archive,
  ChevronDown,
  ChevronRight,
  GitBranchPlus,
  Inbox,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Search,
  Trash2
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  adoptStash,
  applyStash,
  copy,
  deleteStash,
  editStash,
  purgeStash,
  restoreStash,
  stashSave,
  stashToBranch,
  togglePin
} from '../../lib/actions'
import { call } from '../../lib/api'
import { cx, relative, short } from '../../lib/format'
import { useRepoId, useStashFiles, useStashes } from '../../lib/queries'
import { useUi } from '../../lib/store'
import { FileRow } from '../commit/CommitDetails'
import { DiffView } from '../commit/DiffView'
import { Button, DropdownButton, Empty, Spinner, WithContextMenu, type MenuEntry } from '../ui'
import { StashPreview } from './StashPreview'

type Sel =
  | { kind: 'app'; stash: AppStash }
  | { kind: 'trash'; stash: AppStash }
  | { kind: 'stack'; stash: StackStash }

function Group({
  title,
  count,
  children,
  defaultOpen = true,
  hint
}: {
  title: string
  count: number
  children: ReactNode
  defaultOpen?: boolean
  hint?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        title={hint}
        onClick={() => setOpen(!open)}
        className="flex h-7 w-full items-center gap-1 px-2 text-[11px] font-semibold tracking-wide text-faint uppercase hover:text-muted"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="truncate">{title}</span>
        <span className="font-normal">{count}</span>
      </button>
      {open && children}
    </div>
  )
}

function Row({
  active,
  title,
  sub,
  icon,
  onClick,
  menu
}: {
  active: boolean
  title: string
  sub: string
  icon?: ReactNode
  onClick: () => void
  menu: () => MenuEntry[]
}) {
  return (
    <WithContextMenu entries={menu}>
      <div
        onClick={onClick}
        className={cx(
          'mx-1 cursor-default rounded px-2 py-1.5',
          active ? 'bg-accent-strong/25' : 'hover:bg-hover'
        )}
      >
        <div className="flex items-center gap-1.5">
          {icon}
          <span className="truncate font-medium">{title}</span>
        </div>
        <div className="truncate text-[11px] text-faint">{sub}</div>
      </div>
    </WithContextMenu>
  )
}

function appMenu(s: AppStash, groups: string[]): MenuEntry[] {
  const t: StashTarget = { kind: 'app', id: s.id }
  return [
    { label: 'Apply', onSelect: () => void applyStash(t, s.name, false) },
    { label: 'Apply & remove', onSelect: () => void applyStash(t, s.name, true) },
    { label: 'Create branch from stash…', onSelect: () => void stashToBranch(t, s.name) },
    { separator: true },
    { label: 'Edit name, group, notes…', onSelect: () => void editStash(s, groups) },
    { label: s.pinned ? 'Unpin' : 'Pin to top', onSelect: () => void togglePin(s) },
    { label: 'Copy commit SHA', onSelect: () => copy(s.sha, 'SHA copied') },
    { separator: true },
    { label: 'Move to Recently deleted', danger: true, onSelect: () => void deleteStash(t, s.name) }
  ]
}

function stackMenu(s: StackStash): MenuEntry[] {
  const t: StashTarget = { kind: 'stack', index: s.index, sha: s.sha }
  return [
    { label: 'Apply', onSelect: () => void applyStash(t, s.ref, false) },
    { label: 'Pop', onSelect: () => void applyStash(t, s.ref, true) },
    { label: 'Move into app stashes…', onSelect: () => void adoptStash(s) },
    { label: 'Create branch from stash…', onSelect: () => void stashToBranch(t, s.ref) },
    { separator: true },
    { label: 'Copy commit SHA', onSelect: () => copy(s.sha, 'SHA copied') },
    { label: 'Drop…', danger: true, onSelect: () => void deleteStash(t, s.ref) }
  ]
}

export function StashesView() {
  const ui = useUi()
  const stashes = useStashes()
  const [q, setQ] = useState('')
  const data = stashes.data
  const match = (s: string): boolean => !q || s.toLowerCase().includes(q.toLowerCase())

  const grouped = useMemo(() => {
    const m = new Map<string, AppStash[]>()
    for (const s of data?.app ?? []) {
      if (!match(`${s.name} ${s.notes} ${s.branch ?? ''} ${s.group}`)) continue
      const k = s.group || ''
      m.set(k, [...(m.get(k) ?? []), s])
    }
    return [...m.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, q])

  const sel: Sel | null = useMemo(() => {
    const t = ui.stashSel
    if (!t || !data) return null
    if (t.kind === 'app') {
      const a = data.app.find((s) => s.id === t.id)
      if (a) return { kind: 'app', stash: a }
      const tr = data.trash.find((s) => s.id === t.id)
      return tr ? { kind: 'trash', stash: tr } : null
    }
    const st = data.stack.find((s) => s.sha === t.sha)
    return st ? { kind: 'stack', stash: st } : null
  }, [ui.stashSel, data])

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-[300px] shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-2">
          <div className="relative flex-1">
            <Search size={12} className="absolute top-1/2 left-2 -translate-y-1/2 text-faint" />
            <input
              className="field w-full pl-6"
              placeholder="Filter stashes"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Button size="sm" icon={<Plus size={12} />} onClick={() => stashSave()} title="New stash">
            New
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto py-1">
          {stashes.isLoading && (
            <div className="p-4 text-center">
              <Spinner />
            </div>
          )}
          {data && data.app.length === 0 && data.stack.length === 0 && (
            <div className="px-4 py-8 text-center text-xs leading-relaxed text-muted">
              No stashes yet. Stash your changes from the toolbar or the Changes view — each one
              gets a name, a group and notes.
            </div>
          )}
          {grouped.map(([g, list]) => (
            <Group key={g || '__none'} title={g || 'Ungrouped'} count={list.length}>
              {list.map((s) => (
                <Row
                  key={s.id}
                  active={sel?.kind === 'app' && sel.stash.id === s.id}
                  icon={s.pinned ? <Pin size={11} className="shrink-0 text-accent" /> : undefined}
                  title={s.name}
                  sub={`${s.branch ?? 'detached'} · ${relative(s.createdAt / 1000)}`}
                  onClick={() => ui.selectStash({ kind: 'app', id: s.id })}
                  menu={() => appMenu(s, data?.groups ?? [])}
                />
              ))}
            </Group>
          ))}
          {data && data.stack.length > 0 && (
            <Group
              title="Git stash stack"
              count={data.stack.length}
              hint="Plain git stashes (refs/stash). Indices shift as entries are added or dropped."
            >
              {data.stack
                .filter((s) => match(s.message))
                .map((s) => (
                  <Row
                    key={s.sha}
                    active={sel?.kind === 'stack' && sel.stash.sha === s.sha}
                    icon={<Inbox size={11} className="shrink-0 text-faint" />}
                    title={s.message.replace(/^(?:WIP on|On) [^:]+: /, '')}
                    sub={`${s.ref} · ${s.branch ?? 'detached'} · ${relative(s.date)}`}
                    onClick={() => ui.selectStash({ kind: 'stack', index: s.index, sha: s.sha })}
                    menu={() => stackMenu(s)}
                  />
                ))}
            </Group>
          )}
          {data && data.trash.length > 0 && (
            <Group title="Recently deleted" count={data.trash.length} defaultOpen={false}>
              {data.trash.map((s) => (
                <Row
                  key={s.id}
                  active={sel?.kind === 'trash' && sel.stash.id === s.id}
                  icon={<Trash2 size={11} className="shrink-0 text-faint" />}
                  title={s.name}
                  sub={`deleted ${relative((s.deletedAt ?? s.createdAt) / 1000)}`}
                  onClick={() => ui.selectStash({ kind: 'app', id: s.id })}
                  menu={() => [
                    { label: 'Restore', onSelect: () => void restoreStash(s.id) },
                    {
                      label: 'Delete forever…',
                      danger: true,
                      onSelect: () => void purgeStash(s.id, s.name)
                    }
                  ]}
                />
              ))}
            </Group>
          )}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        {sel ? (
          <StashDetail key={sel.stash.sha} sel={sel} groups={data?.groups ?? []} />
        ) : (
          <Empty>
            <div className="flex flex-col items-center gap-2">
              <Archive className="text-faint" />
              Select a stash to inspect it or preview applying it.
            </div>
          </Empty>
        )}
      </div>
    </div>
  )
}

function StashDetail({ sel, groups }: { sel: Sel; groups: string[] }) {
  const repoId = useRepoId()
  const [tab, setTab] = useState<'changes' | 'preview'>('changes')
  // Stash → Preview Applying… in the menu bar.
  useEffect(() => {
    const onPreview = (): void => setTab('preview')
    window.addEventListener('gitpro:stash-preview', onPreview)
    return () => window.removeEventListener('gitpro:stash-preview', onPreview)
  }, [])
  const [file, setFile] = useState<string | null>(null)
  const sha = sel.stash.sha
  const files = useStashFiles(sha)
  const diff = useQuery({
    queryKey: ['repo', repoId, 'stash-diff', sha, file],
    queryFn: () => call('stash.diff', repoId, sha, file ?? undefined),
    enabled: tab === 'changes',
    staleTime: Infinity
  })
  const target: StashTarget =
    sel.kind === 'stack'
      ? { kind: 'stack', index: sel.stash.index, sha }
      : { kind: 'app', id: sel.stash.id }
  const label = sel.kind === 'stack' ? sel.stash.ref : sel.stash.name
  const app = sel.kind !== 'stack' ? sel.stash : null

  const menu: MenuEntry[] =
    sel.kind === 'app'
      ? appMenu(sel.stash, groups).slice(2)
      : sel.kind === 'stack'
        ? stackMenu(sel.stash).slice(2)
        : []

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-line px-4 pt-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-[15px] font-semibold">{label}</h2>
              {app?.group && (
                <span className="rounded bg-line px-1.5 text-[11px] text-muted">{app.group}</span>
              )}
              {app?.pinned && <Pin size={12} className="text-accent" />}
              {sel.kind === 'stack' && (
                <span className="rounded bg-line px-1.5 text-[11px] text-muted">
                  git stash stack
                </span>
              )}
              {sel.kind === 'trash' && (
                <span className="rounded bg-bad/15 px-1.5 text-[11px] text-bad">deleted</span>
              )}
            </div>
            {app?.notes && (
              <p className="mt-1 text-[12.5px] whitespace-pre-wrap text-muted select-text">
                {app.notes}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
              <span>
                Branch <span className="mono text-fg">{sel.stash.branch ?? 'detached'}</span>
              </span>
              <span title={app?.baseSubject}>
                Based on <span className="mono text-fg">{short(sel.stash.baseSha)}</span>
                {app?.baseSubject && <span className="text-faint"> {app.baseSubject}</span>}
              </span>
              <span>{relative(app ? app.createdAt / 1000 : (sel.stash as StackStash).date)}</span>
              {app && (
                <span>
                  {app.scope === 'staged'
                    ? 'staged changes'
                    : app.scope === 'paths'
                      ? 'selected files'
                      : 'all changes'}
                  {app.includeUntracked ? ' + untracked' : ''}
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {sel.kind === 'trash' ? (
              <>
                <Button onClick={() => void restoreStash(sel.stash.id)}>Restore</Button>
                <Button
                  variant="danger"
                  onClick={() => void purgeStash(sel.stash.id, sel.stash.name)}
                >
                  Delete forever
                </Button>
              </>
            ) : (
              <>
                {app && (
                  <Button
                    variant="ghost"
                    icon={<Pencil size={12} />}
                    onClick={() => void editStash(app, groups)}
                    title="Edit"
                  />
                )}
                <Button
                  icon={<GitBranchPlus size={13} />}
                  onClick={() => void stashToBranch(target, label)}
                >
                  Branch
                </Button>
                <Button onClick={() => void applyStash(target, label, false)}>Apply</Button>
                <Button variant="primary" onClick={() => setTab('preview')}>
                  Preview apply
                </Button>
                <DropdownButton
                  align="end"
                  entries={menu}
                  trigger={<Button variant="ghost" icon={<MoreHorizontal size={14} />} />}
                />
              </>
            )}
          </div>
        </div>
        <div className="mt-3 flex gap-4 text-[13px]">
          {(['changes', 'preview'] as const).map((t) => (
            <button
              key={t}
              disabled={t === 'preview' && sel.kind === 'trash'}
              onClick={() => setTab(t)}
              className={cx(
                '-mb-px border-b-2 pb-2 disabled:opacity-30',
                tab === t ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'
              )}
            >
              {t === 'changes'
                ? `Changes${files.data ? ` (${files.data.length})` : ''}`
                : 'Apply preview'}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'preview' && sel.kind !== 'trash' ? (
          <StashPreview sha={sha} target={target} label={label} />
        ) : (
          <div className="flex h-full min-h-0">
            <div className="w-[300px] shrink-0 overflow-auto border-r border-line">
              <div
                onClick={() => setFile(null)}
                className={cx(
                  'flex h-7 cursor-default items-center px-3 text-xs',
                  file === null ? 'text-fg' : 'text-muted hover:text-fg'
                )}
              >
                All files
              </div>
              {files.data?.map((f) => (
                <FileRow
                  key={f.path + f.untracked}
                  f={{ path: f.path, status: f.untracked ? 'U' : f.status }}
                  active={file === f.path}
                  onClick={() => setFile(f.path)}
                />
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <DiffView patch={diff.data ?? ''} loading={diff.isLoading} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

import {
  Archive,
  Inbox,
  Pin,
  ChevronDown,
  ChevronRight,
  Cloud,
  FileDiff,
  GitBranch,
  GitFork,
  History,
  LifeBuoy,
  ShieldCheck,
  Plus,
  Tag
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import {
  addRemote,
  checkoutBranch,
  checkoutRemoteBranch,
  copy,
  createBranchAt,
  deleteBranch,
  deleteRemoteBranch,
  deleteRemoteTag,
  deleteTag,
  editRemote,
  fetchRemote,
  pushTag,
  removeRemote,
  renameBranch,
  setUpstream,
  stashSave
} from '../../lib/actions'
import {
  dragSource,
  dropTarget,
  useDropHover,
  type DragPayload,
  type DropTarget
} from '../../lib/dnd'
import { cx, relative } from '../../lib/format'
import { useBackups, useRefs, useStashes, useStatus } from '../../lib/queries'
import { useUi, type View } from '../../lib/store'
import { WithContextMenu, type MenuEntry } from '../ui'

function Section({
  title,
  count,
  children,
  right,
  defaultOpen = true
}: {
  title: string
  count?: number
  children: ReactNode
  right?: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mb-1">
      <div className="group flex h-7 items-center px-2 text-[11px] font-semibold tracking-wide text-faint uppercase">
        <button className="flex flex-1 items-center gap-1" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {title}
          {count !== undefined && <span className="ml-1 font-normal text-faint">{count}</span>}
        </button>
        {right}
      </div>
      {open && <div>{children}</div>}
    </div>
  )
}

function Item({
  icon,
  label,
  active,
  muted,
  right,
  onClick,
  onDoubleClick,
  title
}: {
  icon?: ReactNode
  label: ReactNode
  active?: boolean
  muted?: boolean
  right?: ReactNode
  onClick?: () => void
  onDoubleClick?: () => void
  title?: string
}) {
  return (
    <div
      title={title}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cx(
        'mx-1 flex h-[26px] cursor-default items-center gap-2 rounded px-2 text-[13px]',
        active ? 'bg-accent-strong/25 text-fg' : 'hover:bg-hover',
        muted && 'text-muted'
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {right}
    </div>
  )
}

function NavItem({
  view,
  icon,
  label,
  count
}: {
  view: View
  icon: ReactNode
  label: string
  count?: number
}) {
  const ui = useUi()
  const active = ui.view === view && (view !== 'graph' || ui.graphRef === null)
  return (
    <Item
      icon={icon}
      label={label}
      active={active}
      onClick={() => {
        if (view === 'graph') ui.setGraphRef(null)
        ui.setView(view)
      }}
      right={
        count ? (
          <span className="rounded-full bg-accent-strong px-1.5 text-[11px] text-white">
            {count}
          </span>
        ) : undefined
      }
    />
  )
}

/** Makes a sidebar row draggable and a drop target, with a highlight while hovered. */
function DragDropRow({
  payload,
  target,
  dropKey,
  children
}: {
  payload: DragPayload
  target: DropTarget
  dropKey: string
  children: ReactNode
}) {
  const hover = useDropHover(dropKey)
  return (
    <div
      {...dragSource(payload)}
      {...dropTarget(target, dropKey)}
      className={cx('rounded', hover && 'bg-accent/10 ring-1 ring-accent ring-inset')}
    >
      {children}
    </div>
  )
}

export function Sidebar() {
  const ui = useUi()
  const refs = useRefs()
  const status = useStatus()
  const stashes = useStashes()
  const backups = useBackups()
  const data = refs.data
  const remotes = data?.remotes ?? []
  const remoteShorts = (data?.remoteBranches ?? []).map((r) => r.short)

  const showRef = (ref: string, sha: string): void => {
    ui.setGraphRef(ref)
    ui.select(sha)
    ui.setView('graph')
  }

  const cur = data?.currentBranch ?? null
  /** "Merge X into <current>…" / "Rebase <current> onto X…" for any ref other than the current branch. */
  const integrateEntries = (ref: string): MenuEntry[] =>
    cur && ref !== cur
      ? [
          {
            label: `Merge ${ref} into ${cur}…`,
            onSelect: () => ui.openIntegrate({ kind: 'merge', source: ref, target: cur })
          },
          {
            label: `Rebase ${cur} onto ${ref}…`,
            onSelect: () => ui.openIntegrate({ kind: 'rebase', branch: cur, onto: ref })
          },
          { separator: true }
        ]
      : []

  const branchMenu = (
    name: string,
    sha: string,
    upstream?: string,
    current?: boolean
  ): MenuEntry[] => [
    { label: `Check out ${name}`, disabled: current, onSelect: () => void checkoutBranch(name) },
    {
      label: 'Push to…',
      disabled: remotes.length === 0,
      onSelect: () =>
        ui.openPush({
          sourceKind: 'branch',
          source: name,
          remote: upstream?.split('/')[0] ?? remotes[0]?.name,
          dest: upstream ? upstream.split('/').slice(1).join('/') : name
        })
    },
    { label: 'Edit history…', onSelect: () => ui.openHistory({ tip: name, base: { count: 10 } }) },
    { separator: true },
    ...(current
      ? [
          {
            label: `Merge into ${name}…`,
            onSelect: () => ui.openIntegrate({ kind: 'merge', target: name })
          },
          {
            label: `Rebase ${name} onto…`,
            onSelect: () => ui.openIntegrate({ kind: 'rebase', branch: name })
          },
          { separator: true }
        ]
      : integrateEntries(name)),
    { label: 'New branch from here…', onSelect: () => void createBranchAt(sha, name) },
    { label: 'Rename…', onSelect: () => void renameBranch(name) },
    { label: 'Set upstream…', onSelect: () => void setUpstream(name, remoteShorts, upstream) },
    { separator: true },
    { label: 'Copy name', onSelect: () => copy(name) },
    { label: 'Delete…', danger: true, disabled: current, onSelect: () => void deleteBranch(name) }
  ]

  return (
    <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-line bg-panel py-2">
      <div className="mb-2">
        <NavItem
          view="graph"
          icon={<GitFork size={14} className="text-muted" />}
          label="All commits"
        />
        <NavItem
          view="changes"
          icon={<FileDiff size={14} className="text-muted" />}
          label="Changes"
          count={status.data?.entries.length}
        />
        <NavItem
          view="stashes"
          icon={<Archive size={14} className="text-muted" />}
          label="Stashes"
          count={(stashes.data?.app.length ?? 0) + (stashes.data?.stack.length ?? 0) || undefined}
        />
        <NavItem
          view="history"
          icon={<History size={14} className="text-muted" />}
          label="History editor"
        />
        <NavItem
          view="reflog"
          icon={<LifeBuoy size={14} className="text-muted" />}
          label="Reflog"
        />
        <NavItem
          view="backups"
          icon={<ShieldCheck size={14} className="text-muted" />}
          label="Backups"
          count={backups.data?.length || undefined}
        />
      </div>

      <Section title="Branches" count={data?.branches.length}>
        {data?.branches.map((b) => (
          <WithContextMenu
            key={b.name}
            entries={() => branchMenu(b.name, b.sha, b.upstream, b.current)}
          >
            <div>
              <DragDropRow
                payload={{ kind: 'branch', name: b.name, remote: false }}
                target={{ kind: 'branch', name: b.name, current: b.current }}
                dropKey={`side:branch:${b.name}`}
              >
                <Item
                  icon={
                    <GitBranch size={13} className={b.current ? 'text-accent' : 'text-muted'} />
                  }
                  label={<span className={b.current ? 'font-semibold' : ''}>{b.name}</span>}
                  active={ui.view === 'graph' && ui.graphRef === b.name}
                  title={`${b.subject}\n${relative(b.date)}${b.upstream ? `\ntracks ${b.upstream}` : ''}\nDouble-click to check out`}
                  onClick={() => showRef(b.name, b.sha)}
                  onDoubleClick={() => !b.current && void checkoutBranch(b.name)}
                  right={
                    b.upstream ? (
                      <span className={cx('text-[11px]', b.gone ? 'text-bad' : 'text-faint')}>
                        {b.gone
                          ? 'gone'
                          : `${b.ahead ? `↑${b.ahead}` : ''}${b.behind ? `↓${b.behind}` : ''}`}
                      </span>
                    ) : undefined
                  }
                />
              </DragDropRow>
            </div>
          </WithContextMenu>
        ))}
      </Section>

      <Section
        title="Remotes"
        count={remotes.length}
        right={
          <button
            title="Add remote"
            className="rounded p-0.5 hover:bg-hover hover:text-fg"
            onClick={() => void addRemote()}
          >
            <Plus size={12} />
          </button>
        }
      >
        {remotes.map((r) => (
          <RemoteGroup key={r.name} name={r.name}>
            {{
              header: (
                <WithContextMenu
                  entries={() => [
                    { label: `Fetch ${r.name}`, onSelect: () => void fetchRemote(r.name) },
                    { label: 'Edit URL…', onSelect: () => void editRemote(r.name, r.fetchUrl) },
                    { label: 'Copy URL', onSelect: () => copy(r.fetchUrl) },
                    { separator: true },
                    {
                      label: 'Remove remote…',
                      danger: true,
                      onSelect: () => void removeRemote(r.name)
                    }
                  ]}
                >
                  <div>
                    <Item
                      icon={<Cloud size={13} className="text-ok" />}
                      label={r.name}
                      title={r.fetchUrl}
                      muted
                    />
                  </div>
                </WithContextMenu>
              ),
              body: data?.remoteBranches
                .filter((rb) => rb.remote === r.name)
                .map((rb) => (
                  <WithContextMenu
                    key={rb.short}
                    entries={() => [
                      {
                        label: 'Check out as local branch…',
                        onSelect: () => void checkoutRemoteBranch(rb.short, rb.name)
                      },
                      { separator: true },
                      ...integrateEntries(rb.short),
                      {
                        label: 'New branch from here…',
                        onSelect: () => void createBranchAt(rb.sha, rb.short)
                      },
                      {
                        label: 'Push something to this branch…',
                        onSelect: () => ui.openPush({ remote: r.name, dest: rb.name })
                      },
                      {
                        label: 'Edit history…',
                        onSelect: () => ui.openHistory({ tip: rb.short, base: { count: 10 } })
                      },
                      { separator: true },
                      { label: 'Copy name', onSelect: () => copy(rb.short) },
                      {
                        label: `Delete on ${r.name}…`,
                        danger: true,
                        onSelect: () => void deleteRemoteBranch(r.name, rb.name)
                      }
                    ]}
                  >
                    <div className="pl-4">
                      <DragDropRow
                        payload={{ kind: 'branch', name: rb.short, remote: true }}
                        target={{ kind: 'remote', short: rb.short }}
                        dropKey={`side:remote:${rb.short}`}
                      >
                        <Item
                          icon={<GitBranch size={12} className="text-faint" />}
                          label={rb.name}
                          active={ui.view === 'graph' && ui.graphRef === rb.short}
                          title={`${rb.subject}\n${relative(rb.date)}`}
                          onClick={() => showRef(rb.short, rb.sha)}
                        />
                      </DragDropRow>
                    </div>
                  </WithContextMenu>
                ))
            }}
          </RemoteGroup>
        ))}
      </Section>

      <Section title="Tags" count={data?.tags.length} defaultOpen={false}>
        {data?.tags.map((t) => (
          <WithContextMenu
            key={t.name}
            entries={() => [
              { label: 'Show in graph', onSelect: () => showRef(`refs/tags/${t.name}`, t.sha) },
              { label: 'New branch from tag…', onSelect: () => void createBranchAt(t.sha, t.name) },
              { separator: true },
              ...integrateEntries(t.name),
              ...remotes.map((r) => ({
                label: `Push to ${r.name}`,
                onSelect: () => void pushTag(r.name, t.name)
              })),
              { separator: true },
              { label: 'Copy name', onSelect: () => copy(t.name) },
              { label: 'Delete local tag…', danger: true, onSelect: () => void deleteTag(t.name) },
              ...remotes.map((r) => ({
                label: `Delete on ${r.name}…`,
                danger: true,
                onSelect: () => void deleteRemoteTag(r.name, t.name)
              }))
            ]}
          >
            <div>
              <Item
                icon={<Tag size={12} className="text-warn" />}
                label={t.name}
                title={t.subject || t.sha}
                onClick={() => showRef(`refs/tags/${t.name}`, t.sha)}
              />
            </div>
          </WithContextMenu>
        ))}
      </Section>

      <Section
        title="Stashes"
        count={(stashes.data?.app.length ?? 0) + (stashes.data?.stack.length ?? 0)}
        right={
          <button
            title="New stash"
            className="rounded p-0.5 hover:bg-hover hover:text-fg"
            onClick={() => stashSave()}
          >
            <Plus size={12} />
          </button>
        }
      >
        {stashes.data?.app.slice(0, 12).map((s) => (
          <Item
            key={s.id}
            icon={
              s.pinned ? (
                <Pin size={12} className="text-accent" />
              ) : (
                <Archive size={12} className="text-muted" />
              )
            }
            label={s.name}
            title={`${s.group ? `[${s.group}] ` : ''}${s.name}\n${s.branch ?? 'detached'} · ${relative(s.createdAt / 1000)}`}
            active={ui.view === 'stashes' && ui.stashSel?.kind === 'app' && ui.stashSel.id === s.id}
            onClick={() => {
              ui.selectStash({ kind: 'app', id: s.id })
              ui.setView('stashes')
            }}
          />
        ))}
        {(stashes.data?.stack.length ?? 0) > 0 && (
          <Item
            icon={<Inbox size={12} className="text-faint" />}
            label={`${stashes.data!.stack.length} on git stash stack`}
            muted
            onClick={() => ui.setView('stashes')}
          />
        )}
      </Section>
    </aside>
  )
}

function RemoteGroup({
  children
}: {
  name: string
  children: { header: ReactNode; body: ReactNode }
}) {
  return (
    <div>
      {children.header}
      {children.body}
    </div>
  )
}

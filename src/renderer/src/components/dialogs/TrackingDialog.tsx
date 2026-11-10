import type { TrackingReport } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import {
  CheckCircle2,
  CloudOff,
  CloudUpload,
  GitBranchPlus,
  Link2,
  RefreshCw,
  Unlink
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { addRemote, fetchRemote } from '../../lib/actions'
import { call } from '../../lib/api'
import { cx, relative } from '../../lib/format'
import { keys, useRepoId } from '../../lib/queries'
import { useUi } from '../../lib/store'
import {
  createLocalBranches,
  publishBranches,
  republishTarget,
  setUpstreams
} from '../../lib/tracking'
import { Badge, Button, Modal, Select, Spinner } from '../ui'

export function TrackingDialog() {
  const open = useUi((s) => s.trackingOpen)
  const repo = useUi((s) => s.repo)
  return open && repo ? <TrackingPanel /> : null
}

type SectionKey = 'unpublished' | 'unlinked' | 'gone' | 'remoteOnly'

/** Selected row ids per section; null means "everything" (the default for fixable sections). */
type Selection = Record<SectionKey, Set<string> | null>

function TrackingPanel() {
  const repoId = useRepoId()
  const close = (): void => useUi.getState().setTrackingOpen(false)
  const progress = useUi((s) => s.progress)
  const report = useQuery({
    queryKey: keys.tracking(repoId),
    queryFn: () => call('tracking.report', repoId)
  })
  const [remote, setRemote] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [sel, setSel] = useState<Selection>({
    unpublished: null,
    unlinked: null,
    gone: null,
    remoteOnly: new Set()
  })
  const refs = useQuery({
    queryKey: keys.refs(repoId),
    queryFn: () => call('refs.snapshot', repoId)
  })
  const remotes = refs.data?.remotes ?? []
  const r = report.data
  const target = remote ?? r?.defaultRemote ?? null

  const ids: Record<SectionKey, string[]> = {
    unpublished: r?.unpublished.map((b) => b.name) ?? [],
    unlinked: r?.unlinked.map((u) => u.branch.name) ?? [],
    gone: r?.gone.map((g) => g.branch.name) ?? [],
    remoteOnly: r?.remoteOnly.map((b) => b.short) ?? []
  }
  const selected = (k: SectionKey): string[] =>
    sel[k] === null ? ids[k] : ids[k].filter((id) => sel[k]!.has(id))
  const isSelected = (k: SectionKey, id: string): boolean => sel[k] === null || sel[k]!.has(id)
  const toggle = (k: SectionKey, id: string): void =>
    setSel((s) => {
      const next = new Set(s[k] ?? ids[k])
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { ...s, [k]: next }
    })
  const toggleAll = (k: SectionKey): void =>
    setSel((s) => ({ ...s, [k]: selected(k).length === ids[k].length ? new Set() : null }))

  const act = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(label)
    try {
      await fn()
    } finally {
      setBusy(null)
    }
  }

  const publishSelected = (): Promise<void> =>
    act('publish', () =>
      publishBranches(
        target!,
        selected('unpublished').map((b) => ({ branch: b, dest: b }))
      )
    )

  const trackSelected = (): Promise<void> =>
    act('track', () => {
      const chosen = new Set(selected('unlinked'))
      const changes = r!.unlinked
        .filter((u) => chosen.has(u.branch.name))
        .map((u) => ({ branch: u.branch.name, upstream: u.candidate }))
      return setUpstreams(changes, (done) =>
        done.length === 1
          ? `${done[0]} now tracks its remote branch`
          : `${done.length} branches now track their remote branches`
      )
    })

  const republishSelected = (): Promise<void> =>
    act('republish', async () => {
      const chosen = new Set(selected('gone'))
      // Group by remote: one push per remote.
      const byRemote = new Map<string, Array<{ branch: string; dest: string }>>()
      for (const g of r!.gone) {
        if (!chosen.has(g.branch.name)) continue
        const t = republishTarget(g.upstream, { remotes })
        if (!t) continue
        byRemote.set(t.remote, [
          ...(byRemote.get(t.remote) ?? []),
          { branch: g.branch.name, dest: t.dest }
        ])
      }
      for (const [rem, items] of byRemote) await publishBranches(rem, items)
    })

  const untrackSelected = (): Promise<void> =>
    act('untrack', () =>
      setUpstreams(
        selected('gone').map((b) => ({ branch: b, upstream: null })),
        (done) =>
          done.length === 1
            ? `${done[0]} no longer tracks a remote branch`
            : `${done.length} branches no longer track deleted branches`
      )
    )

  const createSelected = (): Promise<void> =>
    act('create', async () => {
      const chosen = new Set(selected('remoteOnly'))
      await createLocalBranches(
        r!.remoteOnly
          .filter((b) => chosen.has(b.short))
          .map((b) => ({ remoteBranch: b.short, name: b.name }))
      )
      setSel((s) => ({ ...s, remoteOnly: new Set() }))
    })

  const refresh = (): Promise<void> => act('fetch', () => fetchRemote(null))

  const nothing =
    r && !r.unpublished.length && !r.unlinked.length && !r.gone.length && !r.remoteOnly.length
  const fixable = r ? r.unpublished.length + r.unlinked.length + r.gone.length : 0

  return (
    <Modal
      open
      width={720}
      onOpenChange={(o) => !o && close()}
      title="Branch tracking"
      description="Connect local branches to branches on a remote. Based on the last fetch — fetch to see what changed on the server."
      footer={
        <div className="flex w-full items-center gap-2">
          <div className="mono min-w-0 flex-1 truncate text-[11px] text-faint">
            {busy ? (progress ?? 'Working…') : ''}
          </div>
          <Button
            icon={busy === 'fetch' ? <Spinner size={12} /> : <RefreshCw size={13} />}
            disabled={!!busy || remotes.length === 0}
            onClick={() => void refresh()}
            title="git fetch --all --prune (detects branches deleted on the remote)"
          >
            Fetch &amp; prune
          </Button>
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        </div>
      }
    >
      {!r ? (
        <div className="flex h-32 items-center justify-center">
          <Spinner />
        </div>
      ) : nothing ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-muted">
          <CheckCircle2 size={22} className="text-ok" />
          <div>Every local branch is connected to a remote branch.</div>
          <div className="text-xs text-faint">
            {remotes.length
              ? 'And every remote branch has a local branch.'
              : 'This repository has no remotes.'}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {fixable === 0 && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <CheckCircle2 size={14} className="text-ok" /> Every local branch is connected to a
              remote branch.
            </div>
          )}

          {r.unpublished.length > 0 && (
            <Group
              icon={<CloudOff size={13} className="text-warn" />}
              title="Not on a remote"
              hint="These branches exist only here. Publishing pushes each one and makes it track the new remote branch."
              count={r.unpublished.length}
              allChecked={selected('unpublished').length === ids.unpublished.length}
              someChecked={selected('unpublished').length > 0}
              onToggleAll={() => toggleAll('unpublished')}
              actions={
                remotes.length === 0 ? (
                  <Button size="sm" onClick={() => void addRemote()}>
                    Add remote…
                  </Button>
                ) : (
                  <>
                    {remotes.length > 1 && (
                      <Select
                        value={target ?? ''}
                        onChange={setRemote}
                        className="h-6 w-32"
                        aria-label="Remote to publish to"
                        options={remotes.map((x) => ({ value: x.name, label: x.name }))}
                      />
                    )}
                    <Button
                      size="sm"
                      variant="primary"
                      icon={busy === 'publish' ? <Spinner size={11} /> : <CloudUpload size={12} />}
                      disabled={!!busy || !target || selected('unpublished').length === 0}
                      onClick={() => void publishSelected()}
                    >
                      Publish {selected('unpublished').length} to {target}
                    </Button>
                  </>
                )
              }
            >
              {r.unpublished.map((b) => (
                <Row
                  key={b.name}
                  checked={isSelected('unpublished', b.name)}
                  onToggle={() => toggle('unpublished', b.name)}
                  name={b.name}
                  current={b.current}
                  detail={target ? `→ ${target}/${b.name}` : 'no remote'}
                  date={b.date}
                />
              ))}
            </Group>
          )}

          {r.unlinked.length > 0 && (
            <Group
              icon={<Link2 size={13} className="text-accent" />}
              title="On the remote, but not tracked"
              hint="A remote branch with the same name exists. Tracking it shows ahead/behind counts and lets Pull and Push work without choosing a target."
              count={r.unlinked.length}
              allChecked={selected('unlinked').length === ids.unlinked.length}
              someChecked={selected('unlinked').length > 0}
              onToggleAll={() => toggleAll('unlinked')}
              actions={
                <Button
                  size="sm"
                  variant="primary"
                  icon={busy === 'track' ? <Spinner size={11} /> : <Link2 size={12} />}
                  disabled={!!busy || selected('unlinked').length === 0}
                  onClick={() => void trackSelected()}
                >
                  Track {selected('unlinked').length}
                </Button>
              }
            >
              {r.unlinked.map((u) => (
                <Row
                  key={u.branch.name}
                  checked={isSelected('unlinked', u.branch.name)}
                  onToggle={() => toggle('unlinked', u.branch.name)}
                  name={u.branch.name}
                  current={u.branch.current}
                  detail={`↔ ${u.candidate}`}
                  badge={<Relation ahead={u.ahead} behind={u.behind} />}
                  date={u.branch.date}
                />
              ))}
            </Group>
          )}

          {r.gone.length > 0 && (
            <Group
              icon={<Unlink size={13} className="text-bad" />}
              title="Upstream deleted on the remote"
              hint="The remote branch these track no longer exists (often after a merged pull request). Publish them again, or stop tracking."
              count={r.gone.length}
              allChecked={selected('gone').length === ids.gone.length}
              someChecked={selected('gone').length > 0}
              onToggleAll={() => toggleAll('gone')}
              actions={
                <>
                  <Button
                    size="sm"
                    disabled={!!busy || selected('gone').length === 0}
                    onClick={() => void untrackSelected()}
                  >
                    Stop tracking
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    icon={busy === 'republish' ? <Spinner size={11} /> : <CloudUpload size={12} />}
                    disabled={!!busy || selected('gone').length === 0}
                    onClick={() => void republishSelected()}
                  >
                    Publish again
                  </Button>
                </>
              }
            >
              {r.gone.map((g) => (
                <Row
                  key={g.branch.name}
                  checked={isSelected('gone', g.branch.name)}
                  onToggle={() => toggle('gone', g.branch.name)}
                  name={g.branch.name}
                  current={g.branch.current}
                  detail={<span className="line-through">{g.upstream}</span>}
                  date={g.branch.date}
                />
              ))}
            </Group>
          )}

          {r.remoteOnly.length > 0 && (
            <RemoteOnly
              report={r}
              busy={busy}
              selectedIds={selected('remoteOnly')}
              allChecked={selected('remoteOnly').length === ids.remoteOnly.length}
              isSelected={(id) => isSelected('remoteOnly', id)}
              onToggle={(id) => toggle('remoteOnly', id)}
              onToggleAll={() => toggleAll('remoteOnly')}
              onCreate={() => void createSelected()}
            />
          )}
        </div>
      )}
    </Modal>
  )
}

function RemoteOnly({
  report,
  busy,
  selectedIds,
  allChecked,
  isSelected,
  onToggle,
  onToggleAll,
  onCreate
}: {
  report: TrackingReport
  busy: string | null
  selectedIds: string[]
  allChecked: boolean
  isSelected: (id: string) => boolean
  onToggle: (id: string) => void
  onToggleAll: () => void
  onCreate: () => void
}) {
  const LIMIT = 8
  const [all, setAll] = useState(report.remoteOnly.length <= LIMIT)
  const shown = all ? report.remoteOnly : report.remoteOnly.slice(0, LIMIT)
  return (
    <Group
      icon={<GitBranchPlus size={13} className="text-ok" />}
      title="Only on the remote"
      hint="No local branch tracks these. Creating a local branch sets up tracking without checking anything out."
      count={report.remoteOnly.length}
      allChecked={allChecked}
      someChecked={selectedIds.length > 0}
      onToggleAll={onToggleAll}
      actions={
        <Button
          size="sm"
          variant="primary"
          icon={busy === 'create' ? <Spinner size={11} /> : <GitBranchPlus size={12} />}
          disabled={!!busy || selectedIds.length === 0}
          onClick={onCreate}
        >
          {selectedIds.length === 0
            ? 'Create local branches'
            : `Create ${selectedIds.length} local branch${selectedIds.length === 1 ? '' : 'es'}`}
        </Button>
      }
    >
      {shown.map((b) => (
        <Row
          key={b.short}
          checked={isSelected(b.short)}
          onToggle={() => onToggle(b.short)}
          name={b.short}
          detail={`→ local ${b.name}`}
          date={b.date}
        />
      ))}
      {!all && (
        <button
          className="mx-2 my-1 text-left text-xs text-accent hover:underline"
          onClick={() => setAll(true)}
        >
          Show {report.remoteOnly.length - LIMIT} more
        </button>
      )}
    </Group>
  )
}

function Group({
  icon,
  title,
  hint,
  count,
  allChecked,
  someChecked,
  onToggleAll,
  actions,
  children
}: {
  icon: ReactNode
  title: string
  hint: string
  count: number
  allChecked: boolean
  someChecked: boolean
  onToggleAll: () => void
  actions: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-md border border-line">
      <header className="flex items-center gap-2 border-b border-line bg-panel-2 px-2 py-1.5">
        <input
          type="checkbox"
          className="accent-accent-strong"
          aria-label={`Select all: ${title}`}
          checked={allChecked}
          ref={(el) => {
            if (el) el.indeterminate = someChecked && !allChecked
          }}
          onChange={onToggleAll}
        />
        {icon}
        <span className="text-[13px] font-semibold">{title}</span>
        <span className="text-xs text-faint">{count}</span>
        <div className="flex-1" />
        <div className="flex items-center gap-2">{actions}</div>
      </header>
      <p className="px-3 pt-2 text-[11px] text-faint">{hint}</p>
      <div className="max-h-56 overflow-y-auto py-1">{children}</div>
    </section>
  )
}

function Row({
  checked,
  onToggle,
  name,
  current,
  detail,
  badge,
  date
}: {
  checked: boolean
  onToggle: () => void
  name: string
  current?: boolean
  detail: ReactNode
  badge?: ReactNode
  date: number
}) {
  return (
    <label className="mx-1 flex h-[26px] cursor-default items-center gap-2 rounded px-2 text-[13px] hover:bg-hover">
      <input
        type="checkbox"
        className="accent-accent-strong"
        checked={checked}
        onChange={onToggle}
      />
      <span className={cx('mono min-w-0 shrink truncate', current && 'font-semibold')}>{name}</span>
      {current && <Badge color="current">current</Badge>}
      <span className="mono min-w-0 flex-1 truncate text-xs text-faint">{detail}</span>
      {badge}
      <span className="w-20 shrink-0 text-right text-[11px] text-faint">{relative(date)}</span>
    </label>
  )
}

function Relation({ ahead, behind }: { ahead: number; behind: number }) {
  if (!ahead && !behind) return <Badge>same commit</Badge>
  if (ahead && behind)
    return (
      <Badge color="warn" title="Both sides have commits the other lacks">
        ↑{ahead} ↓{behind} diverged
      </Badge>
    )
  return (
    <Badge
      color="branch"
      title={ahead ? 'Local has commits to push' : 'Remote has commits to pull'}
    >
      {ahead ? `↑${ahead}` : `↓${behind}`}
    </Badge>
  )
}

import type { StatusEntry } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { Archive, GitMerge, Minus, Plus, Undo2 } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { openLiveMerge, run, stashSave } from '../../lib/actions'
import { call } from '../../lib/api'
import { cx } from '../../lib/format'
import { useRepoId, useStatus } from '../../lib/queries'
import { FileRow } from '../commit/CommitDetails'
import { DiffView } from '../commit/DiffView'
import { confirmDialog } from '../../lib/dialogs'
import { Button, Empty } from '../ui'
import { CommitComposer } from './CommitComposer'

type Focus = { path: string; staged: boolean; untracked: boolean; conflicted: boolean } | null

function letterOf(e: StatusEntry, staged: boolean): string {
  if (e.conflicted) return 'U'
  if (e.untracked) return '?'
  const l = staged ? e.index : e.worktree
  return l === '.' ? 'M' : l
}

function List({
  title,
  entries,
  staged,
  focus,
  setFocus,
  selected,
  toggle,
  actions,
  rowActions
}: {
  title: string
  entries: StatusEntry[]
  staged: boolean
  focus: Focus
  setFocus: (f: Focus) => void
  selected: Set<string>
  toggle: (path: string) => void
  actions: ReactNode
  rowActions: (e: StatusEntry) => ReactNode
}) {
  if (!entries.length) return null
  return (
    <div className="mb-1">
      <div className="flex h-7 items-center gap-1 px-2 text-[11px] font-semibold tracking-wide text-faint uppercase">
        <span className="flex-1">
          {title} <span className="font-normal">{entries.length}</span>
        </span>
        {actions}
      </div>
      {entries.map((e) => (
        <div key={e.path} className="group relative flex items-center">
          <input
            type="checkbox"
            className="ml-2 accent-accent-strong"
            checked={selected.has(e.path)}
            onChange={() => toggle(e.path)}
            onClick={(ev) => ev.stopPropagation()}
          />
          <div className="min-w-0 flex-1">
            <FileRow
              f={{ path: e.path, oldPath: e.origPath, status: letterOf(e, staged) }}
              active={focus?.path === e.path && focus.staged === staged}
              onClick={() =>
                setFocus({ path: e.path, staged, untracked: e.untracked, conflicted: e.conflicted })
              }
              right={<span className="hidden gap-0.5 group-hover:flex">{rowActions(e)}</span>}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

const IconBtn = ({
  title,
  onClick,
  children
}: {
  title: string
  onClick: () => void
  children: ReactNode
}) => (
  <button
    title={title}
    onClick={(e) => {
      e.stopPropagation()
      onClick()
    }}
    className="rounded p-0.5 text-muted hover:bg-line-strong hover:text-fg"
  >
    {children}
  </button>
)

export function ChangesView() {
  const repoId = useRepoId()
  const status = useStatus()
  const [focus, setFocus] = useState<Focus>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const entries = useMemo(() => status.data?.entries ?? [], [status.data])
  const conflicted = entries.filter((e) => e.conflicted)
  const staged = entries.filter((e) => !e.conflicted && !e.untracked && e.index !== '.')
  const unstaged = entries.filter((e) => !e.conflicted && (e.untracked || e.worktree !== '.'))
  const selectedPaths = [...selected].filter((p) => entries.some((e) => e.path === p))

  const diff = useQuery({
    queryKey: ['repo', repoId, 'wt-diff', focus],
    queryFn: () => call('worktree.diff', repoId, focus!.path, focus!.staged, focus!.untracked),
    enabled: !!focus && !focus.conflicted
  })

  const toggle = (p: string): void =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(p)) n.delete(p)
      else n.add(p)
      return n
    })

  const stage = (paths: string[]): Promise<unknown> =>
    run(() => call('worktree.stage', repoId, paths))
  const unstage = (paths: string[]): Promise<unknown> =>
    run(() => call('worktree.unstage', repoId, paths))
  const discard = async (list: StatusEntry[]): Promise<void> => {
    if (!list.length) return
    const ok = await confirmDialog({
      title: `Discard changes in ${list.length} file${list.length === 1 ? '' : 's'}?`,
      message:
        list
          .map((e) => `• ${e.path}${e.untracked ? ' (untracked — will be deleted)' : ''}`)
          .slice(0, 12)
          .join('\n') +
        (list.length > 12 ? `\n… and ${list.length - 12} more` : '') +
        '\n\nThis cannot be undone. Consider stashing instead.',
      confirmLabel: 'Discard',
      danger: true
    })
    if (!ok) return
    await run(
      () =>
        call(
          'worktree.discard',
          repoId,
          list.filter((e) => !e.untracked).map((e) => e.path),
          list.filter((e) => e.untracked).map((e) => e.path)
        ),
      'Changes discarded'
    )
    setSelected(new Set())
  }

  if (status.data && entries.length === 0) {
    return (
      <div className="flex h-full min-h-0">
        <div className="flex w-[380px] shrink-0 flex-col border-r border-line">
          <div className="min-h-0 flex-1">
            <Empty>Working tree clean</Empty>
          </div>
          <CommitComposer stagedCount={0} />
        </div>
        <div className="min-w-0 flex-1">
          <Empty>Nothing to show</Empty>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-[380px] shrink-0 flex-col border-r border-line">
        <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-line px-2">
          {selectedPaths.length > 0 ? (
            <>
              <span className="mr-1 text-xs text-muted">{selectedPaths.length} selected</span>
              <Button
                size="sm"
                onClick={() => void stage(selectedPaths).then(() => setSelected(new Set()))}
              >
                Stage
              </Button>
              <Button
                size="sm"
                onClick={() => void unstage(selectedPaths).then(() => setSelected(new Set()))}
              >
                Unstage
              </Button>
              <Button
                size="sm"
                icon={<Archive size={11} />}
                onClick={() => stashSave({ paths: selectedPaths })}
              >
                Stash…
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => void discard(entries.filter((e) => selected.has(e.path)))}
              >
                Discard
              </Button>
              <div className="flex-1" />
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" icon={<Archive size={11} />} onClick={() => stashSave()}>
                Stash all…
              </Button>
              <Button
                size="sm"
                disabled={!staged.length}
                onClick={() => stashSave({ staged: true })}
              >
                Stash staged…
              </Button>
              <div className="flex-1" />
              <span className="text-[11px] text-faint">Tick files to act on a selection</span>
            </>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto py-1">
          {conflicted.length > 0 && (
            <div className="mx-2 mb-2 rounded-md border border-warn/40 bg-warn/5 p-2">
              <div className="mb-1 flex items-center gap-2 text-xs text-warn">
                <GitMerge size={13} /> {conflicted.length} conflicted file
                {conflicted.length === 1 ? '' : 's'}
                <div className="flex-1" />
                <Button
                  size="sm"
                  onClick={() =>
                    openLiveMerge(
                      conflicted.map((e) => e.path),
                      'Resolve conflicts'
                    )
                  }
                >
                  Open merge editor
                </Button>
              </div>
              {conflicted.map((e) => (
                <div
                  key={e.path}
                  className="mono cursor-default truncate rounded px-1 py-0.5 hover:bg-hover"
                  onClick={() =>
                    openMergeAt(
                      conflicted.map((c) => c.path),
                      e.path
                    )
                  }
                >
                  {e.path}
                </div>
              ))}
            </div>
          )}
          <List
            title="Staged"
            entries={staged}
            staged
            focus={focus}
            setFocus={setFocus}
            selected={selected}
            toggle={toggle}
            actions={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void unstage(staged.map((e) => e.path))}
              >
                Unstage all
              </Button>
            }
            rowActions={(e) => (
              <IconBtn title="Unstage" onClick={() => void unstage([e.path])}>
                <Minus size={12} />
              </IconBtn>
            )}
          />
          <List
            title="Changes"
            entries={unstaged}
            staged={false}
            focus={focus}
            setFocus={setFocus}
            selected={selected}
            toggle={toggle}
            actions={
              <>
                <Button size="sm" variant="ghost" onClick={() => void discard(unstaged)}>
                  Discard all
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void stage(unstaged.map((e) => e.path))}
                >
                  Stage all
                </Button>
              </>
            }
            rowActions={(e) => (
              <>
                <IconBtn title="Discard" onClick={() => void discard([e])}>
                  <Undo2 size={12} />
                </IconBtn>
                <IconBtn title="Stage" onClick={() => void stage([e.path])}>
                  <Plus size={12} />
                </IconBtn>
              </>
            )}
          />
        </div>
        <CommitComposer stagedCount={staged.length} />
      </div>
      <div className={cx('min-w-0 flex-1')}>
        {focus?.conflicted ? (
          <Empty>
            <Button
              icon={<GitMerge size={13} />}
              onClick={() =>
                openMergeAt(
                  conflicted.map((c) => c.path),
                  focus.path
                )
              }
            >
              Open {focus.path} in the merge editor
            </Button>
          </Empty>
        ) : focus ? (
          <DiffView patch={diff.data ?? ''} loading={diff.isLoading} />
        ) : (
          <Empty>Select a file to see its changes</Empty>
        )}
      </div>
    </div>
  )
}

function openMergeAt(paths: string[], path: string): void {
  openLiveMerge([path, ...paths.filter((p) => p !== path)], 'Resolve conflicts')
}

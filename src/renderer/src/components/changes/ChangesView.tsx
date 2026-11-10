import { textHash } from '@shared/hash'
import type { LineAction, LineSelection, StatusEntry } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { Archive, GitMerge, Minus, Plus, Undo2, X } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { applyLines, discardChanges, openLiveMerge, run, stashSave } from '../../lib/actions'
import { fileMenu } from '../../lib/everyday'
import { call } from '../../lib/api'
import { cx } from '../../lib/format'
import { useRepoId, useStatus } from '../../lib/queries'
import { FileRow } from '../commit/CommitDetails'
import { FileList, FileListModeToggle } from '../FileList'
import { DiffView, type DiffSelection } from '../commit/DiffView'
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
  selectMany,
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
  selectMany: (paths: string[], on: boolean) => void
  actions: ReactNode
  /** Hover buttons for one file, or (folder view) for every file in a folder. */
  rowActions: (entries: StatusEntry[]) => ReactNode
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
      <FileList
        items={entries}
        pathOf={(e) => e.path}
        dirLeading={(files) => {
          const on = files.filter((f) => selected.has(f.path)).length
          return (
            <input
              type="checkbox"
              aria-label="Select folder"
              className="ml-2 accent-accent-strong"
              checked={on === files.length}
              ref={(el) => {
                if (el) el.indeterminate = on > 0 && on < files.length
              }}
              onChange={() =>
                selectMany(
                  files.map((f) => f.path),
                  on < files.length
                )
              }
            />
          )
        }}
        dirActions={rowActions}
        renderFile={(e, row) => (
          <div className="group relative flex items-center">
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
                  setFocus({
                    path: e.path,
                    staged,
                    untracked: e.untracked,
                    conflicted: e.conflicted
                  })
                }
                right={<span className="hidden gap-0.5 group-hover:flex">{rowActions([e])}</span>}
                menu={() => fileMenu(e.path, { entry: e })}
                depth={row.depth}
                nameOnly={row.tree}
              />
            </div>
          </div>
        )}
      />
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

const NO_LINES: ReadonlySet<number> = new Set()

/** Small text button shown on a hunk header. */
const HunkBtn = ({
  label,
  onClick,
  danger
}: {
  label: string
  onClick: () => void
  danger?: boolean
}) => (
  <button
    onMouseDown={(e) => e.stopPropagation()}
    onClick={onClick}
    className={cx(
      'rounded border border-line bg-panel px-1.5 font-sans text-[11px] leading-[17px] text-muted hover:border-line-strong',
      danger ? 'hover:text-bad' : 'hover:text-fg'
    )}
  >
    {label}
  </button>
)

export function ChangesView() {
  const repoId = useRepoId()
  const status = useStatus()
  const [picked, setFocus] = useState<Focus>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const entries = useMemo(() => status.data?.entries ?? [], [status.data])
  const conflicted = entries.filter((e) => e.conflicted)
  const staged = entries.filter((e) => !e.conflicted && !e.untracked && e.index !== '.')
  const unstaged = entries.filter((e) => !e.conflicted && (e.untracked || e.worktree !== '.'))
  const selectedPaths = [...selected].filter((p) => entries.some((e) => e.path === p))

  // Follow the focused file when all of its changes move to the other list (or it conflicts).
  const focus = useMemo<Focus>(() => {
    if (!picked || !status.data) return picked
    const list = picked.conflicted ? conflicted : picked.staged ? staged : unstaged
    if (list.some((e) => e.path === picked.path)) return picked
    const c = conflicted.find((e) => e.path === picked.path)
    if (c) return { ...picked, conflicted: true }
    const other = (picked.staged ? unstaged : staged).find((e) => e.path === picked.path)
    return other
      ? { path: other.path, staged: !picked.staged, untracked: other.untracked, conflicted: false }
      : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, entries])

  const diff = useQuery({
    queryKey: ['repo', repoId, 'wt-diff', focus],
    queryFn: () => call('worktree.diff', repoId, focus!.path, focus!.staged, focus!.untracked),
    enabled: !!focus && !focus.conflicted
  })
  const patch = diff.data ?? ''
  const diffHash = useMemo(() => textHash(patch), [patch])

  // Selected lines belong to one exact diff; any change to it starts a fresh selection.
  const selKey = focus ? `${focus.path}\0${focus.staged}\0${diffHash}` : ''
  const [lines, setLines] = useState<{ key: string; set: ReadonlySet<number> }>({
    key: '',
    set: NO_LINES
  })
  const lineSel = lines.key === selKey ? lines.set : NO_LINES
  const clearLines = (): void => setLines({ key: '', set: NO_LINES })
  const lineSelection = (changes: number[]): LineSelection => ({
    path: focus!.path,
    staged: focus!.staged,
    untracked: focus!.untracked,
    diffHash,
    changes
  })
  const actLines = async (action: LineAction, changes: number[]): Promise<void> => {
    if (await applyLines(action, lineSelection(changes))) clearLines()
  }
  const stashLines = (changes: number[]): void =>
    stashSave({ selections: [lineSelection(changes)] })

  const selection: DiffSelection | undefined =
    focus && !focus.conflicted && diff.data !== undefined
      ? {
          selected: lineSel,
          onChange: (next) => setLines({ key: selKey, set: next }),
          hunkActions: (changes) =>
            focus.staged ? (
              <HunkBtn label="Unstage hunk" onClick={() => void actLines('unstage', changes)} />
            ) : (
              <>
                <HunkBtn label="Stage hunk" onClick={() => void actLines('stage', changes)} />
                <HunkBtn label="Stash hunk…" onClick={() => stashLines(changes)} />
                <HunkBtn
                  label="Discard hunk…"
                  danger
                  onClick={() => void actLines('discard', changes)}
                />
              </>
            )
        }
      : undefined

  const toggle = (p: string): void =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(p)) n.delete(p)
      else n.add(p)
      return n
    })
  const selectMany = (paths: string[], on: boolean): void =>
    setSelected((s) => {
      const n = new Set(s)
      for (const p of paths) {
        if (on) n.add(p)
        else n.delete(p)
      }
      return n
    })

  const stage = (paths: string[]): Promise<unknown> =>
    run(() => call('worktree.stage', repoId, paths))
  const unstage = (paths: string[]): Promise<unknown> =>
    run(() => call('worktree.unstage', repoId, paths))
  const discard = async (list: StatusEntry[]): Promise<void> => {
    if (await discardChanges(list)) setSelected(new Set())
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
        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line px-2">
          {selectedPaths.length > 0 ? (
            <>
              <span
                title={`${selectedPaths.length} file${selectedPaths.length === 1 ? '' : 's'} selected`}
                className="mr-0.5 shrink-0 rounded-full bg-accent-strong px-1.5 text-[11px] text-white tabular-nums"
              >
                {selectedPaths.length}
              </span>
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
              <button
                type="button"
                title="Clear selection"
                aria-label="Clear selection"
                className="shrink-0 rounded p-1 text-muted hover:bg-hover hover:text-fg"
                onClick={() => setSelected(new Set())}
              >
                <X size={13} />
              </button>
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
              <span className="min-w-0 flex-1 truncate text-right text-[11px] text-faint">
                Tick files to act on a selection
              </span>
            </>
          )}
          <FileListModeToggle />
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
            selectMany={selectMany}
            actions={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void unstage(staged.map((e) => e.path))}
              >
                Unstage all
              </Button>
            }
            rowActions={(list) => (
              <IconBtn title="Unstage" onClick={() => void unstage(list.map((e) => e.path))}>
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
            selectMany={selectMany}
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
            rowActions={(list) => (
              <>
                <IconBtn title="Discard" onClick={() => void discard(list)}>
                  <Undo2 size={12} />
                </IconBtn>
                <IconBtn title="Stage" onClick={() => void stage(list.map((e) => e.path))}>
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
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-line px-3 text-xs">
              <span className="mono min-w-0 truncate text-muted">{focus.path}</span>
              <span className="shrink-0 text-faint">
                {focus.staged ? 'staged' : focus.untracked ? 'untracked' : 'unstaged'}
              </span>
              <div className="flex-1" />
              {lineSel.size > 0 ? (
                <>
                  <span className="mr-1 text-muted">
                    {lineSel.size} line{lineSel.size === 1 ? '' : 's'} selected
                  </span>
                  {focus.staged ? (
                    <Button size="sm" onClick={() => void actLines('unstage', [...lineSel])}>
                      Unstage lines
                    </Button>
                  ) : (
                    <>
                      <Button size="sm" onClick={() => void actLines('stage', [...lineSel])}>
                        Stage lines
                      </Button>
                      <Button
                        size="sm"
                        icon={<Archive size={11} />}
                        onClick={() => stashLines([...lineSel])}
                      >
                        Stash lines…
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => void actLines('discard', [...lineSel])}
                      >
                        Discard lines…
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" onClick={clearLines}>
                    Clear
                  </Button>
                </>
              ) : (
                <span className="shrink-0 text-faint">
                  Tick lines in the gutter, or use a hunk’s buttons
                </span>
              )}
            </div>
            <div className="min-h-0 flex-1">
              <DiffView patch={patch} loading={diff.isLoading} selection={selection} />
            </div>
          </div>
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

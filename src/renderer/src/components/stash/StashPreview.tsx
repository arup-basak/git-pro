import type { PreviewOutcome, StashTarget } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, GitMerge } from 'lucide-react'
import { useState } from 'react'
import { applyStash } from '../../lib/actions'
import { call } from '../../lib/api'
import { cx, short } from '../../lib/format'
import { useRefs, useRepoId, useStatus } from '../../lib/queries'
import { useUi } from '../../lib/store'
import { DiffView } from '../commit/DiffView'
import { Button, Checkbox, Empty, Spinner } from '../ui'

const OUTCOME: Record<PreviewOutcome, { label: string; cls: string; letter: string }> = {
  modified: { label: 'modified', cls: 'text-warn', letter: 'M' },
  added: { label: 'added', cls: 'text-ok', letter: 'A' },
  deleted: { label: 'deleted', cls: 'text-bad', letter: 'D' },
  conflict: { label: 'conflict', cls: 'text-bad', letter: '!' },
  blocked: { label: 'blocked by local changes', cls: 'text-bad', letter: '×' },
  untracked: { label: 'new untracked file', cls: 'text-ok', letter: 'U' },
  'untracked-blocked': { label: 'untracked file already exists', cls: 'text-bad', letter: '×' }
}

/** Dry-run of applying a stash onto the current workspace. */
export function StashPreview({
  sha,
  target,
  label
}: {
  sha: string
  target: StashTarget
  label: string
}) {
  const repoId = useRepoId()
  const ui = useUi()
  const refs = useRefs()
  const status = useStatus()
  const [file, setFile] = useState<string | null>(null)
  const [restoreIndex, setRestoreIndex] = useState(false)
  const [busy, setBusy] = useState(false)
  const preview = useQuery({
    queryKey: ['repo', repoId, 'stash-preview', sha],
    queryFn: () => call('stash.preview', repoId, sha)
  })
  const p = preview.data
  const sel = p?.files.find((f) => f.path === file) ?? null
  const diff = useQuery({
    queryKey: ['repo', repoId, 'stash-preview-diff', sha, p?.trees.result, file],
    queryFn: () =>
      sel?.untracked
        ? call('stash.diff', repoId, sha, sel.path)
        : call('tree.diff', repoId, p!.trees.ours, p!.trees.result, sel?.path),
    enabled: !!p
  })

  if (preview.isLoading) {
    return (
      <Empty>
        <Spinner />
      </Empty>
    )
  }
  if (!p)
    return (
      <Empty>
        {preview.error ? String((preview.error as Error).message) : 'Preview unavailable'}
      </Empty>
    )

  const counts = p.files.reduce<Record<string, number>>(
    (acc, f) => ((acc[f.outcome] = (acc[f.outcome] ?? 0) + 1), acc),
    {}
  )
  const conflicts = p.files.filter((f) => f.outcome === 'conflict').map((f) => f.path)
  const blocked = p.files.filter(
    (f) => f.outcome === 'blocked' || f.outcome === 'untracked-blocked'
  )
  const localChanges = status.data?.entries.length ?? 0

  const doApply = async (pop: boolean): Promise<void> => {
    setBusy(true)
    await applyStash(target, label, pop, restoreIndex)
    setBusy(false)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-3 py-2 text-xs">
        <span className="text-muted">
          Onto <span className="mono text-fg">{refs.data?.currentBranch ?? 'detached HEAD'}</span>
          {refs.data?.head && <span className="mono text-faint"> @ {short(refs.data.head)}</span>}
          {localChanges > 0 && (
            <span>
              {' '}
              + {localChanges} local change{localChanges === 1 ? '' : 's'}
            </span>
          )}
        </span>
        {p.clean ? (
          <span className="flex items-center gap-1 text-ok">
            <CheckCircle2 size={13} /> Applies cleanly
          </span>
        ) : (
          <span className="flex items-center gap-1 text-warn">
            <AlertTriangle size={13} />
            {conflicts.length
              ? `${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}`
              : ''}
            {conflicts.length && blocked.length ? ', ' : ''}
            {blocked.length ? `${blocked.length} blocked` : ''}
          </span>
        )}
        <span className="text-faint">
          {Object.entries(counts)
            .map(([k, n]) => `${n} ${OUTCOME[k as PreviewOutcome].label}`)
            .join(' · ')}
        </span>
        <div className="flex-1" />
        {conflicts.length > 0 && (
          <Button
            size="sm"
            icon={<GitMerge size={12} />}
            onClick={() =>
              ui.openMerge({
                source: { kind: 'trees', trees: p.trees },
                paths: conflicts,
                path: conflicts[0],
                title: `Preview · ${label}`
              })
            }
          >
            Preview merge
          </Button>
        )}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-[300px] shrink-0 overflow-auto border-r border-line">
          <div
            onClick={() => setFile(null)}
            className={cx(
              'flex h-7 cursor-default items-center px-3 text-xs',
              file === null ? 'text-fg' : 'text-muted hover:text-fg'
            )}
          >
            Resulting workspace changes
          </div>
          {p.files.map((f) => {
            const o = OUTCOME[f.outcome]
            return (
              <div
                key={f.path}
                onClick={() => setFile(f.path)}
                title={`${f.path} — ${o.label}`}
                className={cx(
                  'flex h-[24px] cursor-default items-center gap-2 px-3',
                  file === f.path ? 'bg-accent-strong/30' : 'hover:bg-hover'
                )}
              >
                <span className={cx('mono w-3 text-center font-semibold', o.cls)}>{o.letter}</span>
                <span className="min-w-0 flex-1 truncate">{f.path}</span>
                {f.outcome === 'conflict' && (
                  <button
                    className="text-[11px] text-accent hover:underline"
                    onClick={(e) => {
                      e.stopPropagation()
                      ui.openMerge({
                        source: { kind: 'trees', trees: p.trees },
                        paths: conflicts,
                        path: f.path,
                        title: `Preview · ${label}`
                      })
                    }}
                  >
                    merge
                  </button>
                )}
              </div>
            )
          })}
        </div>
        <div className="min-w-0 flex-1">
          {sel && (sel.outcome === 'blocked' || sel.outcome === 'untracked-blocked') ? (
            <Empty>
              {sel.outcome === 'blocked'
                ? 'This file has uncommitted local changes, so git would refuse to apply the stash. Commit, stash or discard them first.'
                : 'An untracked file with this name already exists; git would refuse to overwrite it. Move or delete it first.'}
            </Empty>
          ) : (
            <DiffView patch={diff.data ?? ''} loading={diff.isLoading} />
          )}
        </div>
      </div>
      <div className="flex h-11 shrink-0 items-center gap-3 border-t border-line px-3">
        <Checkbox
          checked={restoreIndex}
          onChange={setRestoreIndex}
          label="Restore staged state (--index)"
          title="Also re-stage what was staged when the stash was made"
        />
        {blocked.length > 0 && (
          <span className="text-xs text-bad">Resolve the blocked files before applying.</span>
        )}
        <div className="flex-1" />
        <Button disabled={busy || blocked.length > 0} onClick={() => doApply(false)}>
          Apply
        </Button>
        <Button
          variant="primary"
          disabled={busy || blocked.length > 0}
          onClick={() => doApply(true)}
        >
          Apply &amp; remove
        </Button>
      </div>
    </div>
  )
}

import type { LineSelection, StashScope } from '@shared/types'
import { useState } from 'react'
import { toast } from 'sonner'
import { queryClient } from '../../lib/actions'
import { call } from '../../lib/api'
import { cx } from '../../lib/format'
import {
  invalidateRepo,
  showError,
  useRefs,
  useRepoId,
  useStashes,
  useStatus
} from '../../lib/queries'
import { useUi } from '../../lib/store'
import { Button, Checkbox, Modal } from '../ui'

export function StashSaveDialog() {
  const dlg = useUi((s) => s.stashDialog)
  return dlg ? (
    <StashSaveForm
      key={JSON.stringify(dlg)}
      paths={dlg.paths}
      staged={dlg.staged}
      selections={dlg.selections}
    />
  ) : null
}

function StashSaveForm({
  paths,
  staged,
  selections
}: {
  paths?: string[]
  staged?: boolean
  selections?: LineSelection[]
}) {
  const repoId = useRepoId()
  const ui = useUi()
  const status = useStatus()
  const refs = useRefs()
  const stashes = useStashes()
  const entries = status.data?.entries ?? []
  const hasStaged = entries.some((e) => !e.untracked && !e.conflicted && e.index !== '.')
  const [name, setName] = useState('')
  const [group, setGroup] = useState('')
  const [notes, setNotes] = useState('')
  const [scope, setScope] = useState<StashScope>(
    selections?.length ? 'lines' : paths?.length ? 'paths' : staged ? 'staged' : 'all'
  )
  const lineCount = selections?.reduce((n, s) => n + s.changes.length, 0) ?? 0
  const [includeUntracked, setIncludeUntracked] = useState(true)
  const [keep, setKeep] = useState(false)
  const [busy, setBusy] = useState(false)
  const close = (): void => ui.closeStashDialog()

  const fileCount =
    scope === 'lines'
      ? (selections?.length ?? 0)
      : scope === 'paths'
        ? (paths?.length ?? 0)
        : scope === 'staged'
          ? entries.filter((e) => !e.untracked && e.index !== '.').length
          : entries.filter((e) => includeUntracked || !e.untracked).length

  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      const s = await call('stash.save', repoId, {
        name: name.trim() || `WIP on ${refs.data?.currentBranch ?? 'HEAD'}`,
        notes,
        group,
        scope,
        paths: scope === 'paths' ? paths : undefined,
        selections: scope === 'lines' ? selections : undefined,
        includeUntracked,
        keepWorkingTree: keep
      })
      toast.success(`Stashed “${s.name}”`, {
        description: keep ? 'Working tree left unchanged (snapshot).' : undefined
      })
      ui.selectStash({ kind: 'app', id: s.id })
      close()
    } catch (e) {
      showError(e, 'Could not stash')
    } finally {
      setBusy(false)
      void invalidateRepo(queryClient, repoId)
    }
  }

  const scopes: Array<[StashScope, string, boolean]> = [
    ['all', 'All changes', true],
    ['staged', 'Staged only', hasStaged],
    ['paths', `Selected files${paths?.length ? ` (${paths.length})` : ''}`, !!paths?.length]
  ]
  if (selections?.length) scopes.push(['lines', `Selected lines (${lineCount})`, true])

  return (
    <Modal
      open
      width={520}
      onOpenChange={(o) => !o && close()}
      title="New stash"
      description="Saved as a named stash with its own ref — it never shifts position like stash@{n}."
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={busy || fileCount === 0} onClick={submit}>
            {keep ? 'Save snapshot' : 'Stash'}{' '}
            {scope === 'lines'
              ? `${lineCount} line${lineCount === 1 ? '' : 's'}`
              : fileCount
                ? `${fileCount} file${fileCount === 1 ? '' : 's'}`
                : ''}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted">Name</label>
          <input
            data-autofocus
            className="field"
            placeholder={`WIP on ${refs.data?.currentBranch ?? 'HEAD'}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex gap-3">
          <div className="flex flex-1 flex-col gap-1">
            <label className="text-xs font-medium text-muted">Group</label>
            <input
              className="field"
              list="stash-groups"
              placeholder="none"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
            />
            <datalist id="stash-groups">
              {stashes.data?.groups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted">Notes</label>
          <textarea
            className="field h-16 resize-y py-1.5"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What is this work, what’s left to do…"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted">What to stash</label>
          <div className="flex rounded-md border border-line p-0.5">
            {scopes.map(([s, label, enabled]) => (
              <button
                type="button"
                key={s}
                disabled={!enabled}
                onClick={() => setScope(s)}
                className={cx(
                  'h-6 flex-1 rounded text-xs disabled:opacity-30',
                  scope === s ? 'bg-line-strong text-fg' : 'text-muted hover:text-fg'
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {scope === 'lines' && selections && (
            <div className="mono mt-1 max-h-24 overflow-auto rounded border border-line bg-bg px-2 py-1 text-muted">
              {selections.map((s) => (
                <div key={s.path} className="truncate">
                  {s.path}{' '}
                  <span className="text-faint">
                    · {s.changes.length} line{s.changes.length === 1 ? '' : 's'}
                  </span>
                </div>
              ))}
            </div>
          )}
          {scope === 'paths' && paths && (
            <div className="mono mt-1 max-h-24 overflow-auto rounded border border-line bg-bg px-2 py-1 text-muted">
              {paths.map((p) => (
                <div key={p} className="truncate">
                  {p}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Checkbox
            checked={includeUntracked && scope !== 'staged' && scope !== 'lines'}
            disabled={scope === 'staged' || scope === 'lines'}
            onChange={setIncludeUntracked}
            label="Include untracked files"
          />
          <Checkbox
            checked={keep}
            onChange={setKeep}
            label="Keep changes in the working tree (save a snapshot only)"
          />
        </div>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}

import type { IntegrateOutput, IntegrateResult, MergeMode } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, GitMerge } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { queryClient } from '../../lib/actions'
import { call } from '../../lib/api'
import { cx, short } from '../../lib/format'
import { invalidateRepo, showError, useRefs, useRepoId, useStatus } from '../../lib/queries'
import { useUi, type IntegrateRequest } from '../../lib/store'
import { branchOptions, refNames } from '../../lib/refs'
import { RefInput } from '../RefInput'
import { Button, Checkbox, Modal, Segmented, Select } from '../ui'

export function IntegrateDialog() {
  const req = useUi((s) => s.integrate)
  if (!req) return null
  return req.kind === 'merge' ? (
    <MergeForm key={JSON.stringify(req)} req={req} />
  ) : (
    <RebaseForm key={JSON.stringify(req)} req={req} />
  )
}

/** The value after it has stopped changing for `ms` (keeps previews from running per keystroke). */
function useSettled<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** A branch-name-safe slug of the last part of a ref (`origin/feature/x` → `x`). */
function slug(ref: string): string {
  return (ref.split('/').pop() ?? ref).replace(/[^\w.-]+/g, '-') || 'branch'
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-20 shrink-0 text-xs font-medium text-muted">{label}</label>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </div>
  )
}

/** "Into <branch>" vs "Into a new branch: [name]" */
function OutputChoice({
  inPlaceLabel,
  inPlaceHint,
  mode,
  setMode,
  name,
  setName
}: {
  inPlaceLabel: string
  inPlaceHint: string
  mode: IntegrateOutput['mode']
  setMode: (m: IntegrateOutput['mode']) => void
  name: string
  setName: (n: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="radio"
          className="accent-accent-strong"
          checked={mode === 'new-branch'}
          onChange={() => setMode('new-branch')}
        />
        New branch
        <input
          className="field mono h-6 flex-1"
          value={name}
          disabled={mode !== 'new-branch'}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="flex items-center gap-2 text-[13px]" title={inPlaceHint}>
        <input
          type="radio"
          className="accent-accent-strong"
          checked={mode === 'in-place'}
          onChange={() => setMode('in-place')}
        />
        {inPlaceLabel}
        <span className="text-xs text-faint">{inPlaceHint}</span>
      </label>
    </div>
  )
}

function CommandBox({ lines }: { lines: string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted">Command</label>
      <pre className="mono overflow-x-auto rounded border border-line bg-bg px-2 py-1.5 text-muted select-text">
        {lines.join('\n')}
      </pre>
    </div>
  )
}

function Status({ tone, children }: { tone: 'ok' | 'warn' | 'muted'; children: ReactNode }) {
  return (
    <div
      className={cx(
        'flex items-center gap-1.5 text-xs',
        tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-muted'
      )}
    >
      {tone === 'ok' ? (
        <CheckCircle2 size={13} />
      ) : tone === 'warn' ? (
        <AlertTriangle size={13} />
      ) : null}
      {children}
    </div>
  )
}

function finish(r: IntegrateResult): void {
  const ui = useUi.getState()
  ui.closeIntegrate()
  if (r.status === 'conflict') {
    toast.warning(r.message, { duration: 12000 })
    ui.setView('changes')
  } else if (r.status === 'up-to-date') {
    toast(r.message)
  } else {
    toast.success(r.message, {
      description: r.backupRef ? 'The previous position is kept in Backups.' : undefined
    })
    if (r.newTip) ui.select(r.newTip)
  }
}

/* ---------------- merge ---------------- */

const MERGE_MODES: Array<[MergeMode, string, string]> = [
  ['ff', 'Fast-forward if possible', 'git merge --ff (the default)'],
  ['no-ff', 'Always a merge commit', 'git merge --no-ff'],
  ['ff-only', 'Fast-forward only', 'git merge --ff-only'],
  ['squash', 'Squash', 'git merge --squash, then one commit']
]

function MergeForm({ req }: { req: Extract<IntegrateRequest, { kind: 'merge' }> }) {
  const repoId = useRepoId()
  const refs = useRefs()
  const ui = useUi()
  const current = refs.data?.currentBranch ?? ''
  const [source, setSource] = useState(req.source ?? '')
  const [target, setTarget] = useState(req.target ?? current)
  const [mode, setMode] = useState<MergeMode>('ff')
  const [outMode, setOutMode] = useState<IntegrateOutput['mode']>('in-place')
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const settled = useSettled(`${source.trim()}\0${target}`)
  const [qSource, qTarget] = settled.split('\0')

  const preview = useQuery({
    queryKey: ['repo', repoId, 'merge-preview', qSource, qTarget],
    queryFn: () => call('branch.mergePreview', repoId, qSource, qTarget),
    enabled: !!qSource && !!qTarget,
    retry: false
  })
  const p = preview.data && preview.data.source === source.trim() ? preview.data : undefined
  const branchName = name || `${target}-with-${slug(source.trim())}`
  const branch = outMode === 'new-branch' ? branchName : target
  const checkedOut = outMode === 'in-place' && !!p?.targetCheckedOut
  const needsCheckout = !!p && !p.clean && !checkedOut
  const ff = !!p?.fastForward && (mode === 'ff' || mode === 'ff-only')
  const blocked = !p || p.upToDate || (mode === 'ff-only' && !p.fastForward)

  const command = ((): string[] => {
    const flag = { ff: '--ff', 'no-ff': '--no-ff', 'ff-only': '--ff-only', squash: '--squash' }[
      mode
    ]
    const merge = `git merge ${flag} ${source.trim() || '<source>'}`
    if (checkedOut) return [merge]
    if (needsCheckout) {
      return [
        outMode === 'new-branch' ? `git switch -c ${branch} ${target}` : `git switch ${target}`,
        merge
      ]
    }
    if (ff) {
      return outMode === 'new-branch'
        ? [`git branch ${branch} ${short(p!.sourceSha)}`]
        : [`git update-ref refs/heads/${target} ${short(p!.sourceSha)}   # fast-forward`]
    }
    return [
      `# merged without touching your working tree:`,
      `git merge-tree --write-tree ${target} ${source.trim()}`,
      `git commit-tree <tree> -p ${target}${mode === 'squash' ? '' : ` -p ${source.trim()}`}`,
      outMode === 'new-branch'
        ? `git branch ${branch} <commit>`
        : `git update-ref refs/heads/${target} <commit>`
    ]
  })()

  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await call('branch.merge', repoId, {
        source: source.trim(),
        target,
        mode,
        message: message.trim() || undefined,
        output:
          outMode === 'new-branch'
            ? { mode: 'new-branch', name: branchName }
            : { mode: 'in-place' },
        checkout: needsCheckout
      })
      finish(r)
    } catch (e) {
      showError(e, 'Could not merge')
    } finally {
      setBusy(false)
      void invalidateRepo(queryClient, repoId)
    }
  }

  return (
    <Modal
      open
      width={600}
      onOpenChange={(o) => !o && ui.closeIntegrate()}
      title="Merge"
      description="Bring the commits of one branch into another."
      footer={
        <>
          <Button onClick={() => ui.closeIntegrate()}>Cancel</Button>
          <Button variant="primary" disabled={busy || blocked} onClick={() => void submit()}>
            {mode === 'squash' ? 'Squash' : 'Merge'} {source.trim() ? `${source.trim()} ` : ''}
            into {branch}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (!busy && !blocked) void submit()
        }}
      >
        <Row label="Merge">
          <RefInput
            autoFocus={!req.source}
            className="flex-1"
            value={source}
            onChange={setSource}
            options={refNames(refs.data).filter((r) => r !== target)}
            placeholder="branch, remote branch, tag or commit"
          />
        </Row>
        <Row label="Into">
          <Select
            className="flex-1"
            value={target}
            onChange={setTarget}
            aria-label="Into"
            options={branchOptions(refs.data)}
          />
        </Row>
        <Row label="How">
          <Segmented value={mode} onChange={setMode} options={MERGE_MODES} className="flex-1" />
        </Row>
        <div className="rounded-md border border-line bg-bg/50 px-3 py-2">
          {!source.trim() ? (
            <Status tone="muted">Choose what to merge.</Status>
          ) : preview.isError ? (
            <Status tone="warn">{(preview.error as Error).message}</Status>
          ) : !p ? (
            <Status tone="muted">Checking…</Status>
          ) : p.upToDate ? (
            <Status tone="muted">
              {target} already contains {p.source}. Nothing to merge.
            </Status>
          ) : (
            <div className="flex flex-col gap-1.5">
              {p.clean ? (
                <Status tone="ok">
                  {p.ahead} commit{p.ahead === 1 ? '' : 's'} ·{' '}
                  {ff ? 'fast-forward' : 'merges cleanly'} · {p.files.length} file
                  {p.files.length === 1 ? '' : 's'} change
                </Status>
              ) : (
                <Status tone="warn">
                  {p.conflicted.length} conflict{p.conflicted.length === 1 ? '' : 's'} · {p.ahead}{' '}
                  commit{p.ahead === 1 ? '' : 's'}
                  <button
                    type="button"
                    className="ml-1 inline-flex items-center gap-1 text-accent hover:underline"
                    onClick={() => {
                      ui.closeIntegrate()
                      ui.openMerge({
                        source: { kind: 'trees', trees: p.trees },
                        paths: p.conflicted,
                        path: p.conflicted[0],
                        title: `Preview · merge ${p.source} into ${p.target}`
                      })
                    }}
                  >
                    <GitMerge size={12} /> Preview in merge editor
                  </button>
                </Status>
              )}
              {mode === 'ff-only' && !p.fastForward && (
                <Status tone="warn">
                  The histories have diverged, so a fast-forward is impossible.
                </Status>
              )}
              <div className="mono max-h-28 overflow-auto text-muted">
                {p.files.map((f) => (
                  <div key={f.path} className="flex gap-2 truncate">
                    <span
                      className={cx(
                        'w-3 shrink-0',
                        p.conflicted.includes(f.path) ? 'text-warn' : 'text-faint'
                      )}
                    >
                      {p.conflicted.includes(f.path) ? '!' : f.status}
                    </span>
                    {f.path}
                  </div>
                ))}
              </div>
              {needsCheckout ? (
                <Status tone="muted">
                  Conflicts are resolved in your working tree, so {branch} will be checked out
                  first.
                </Status>
              ) : (
                !checkedOut && (
                  <Status tone="muted">
                    {branch} is not checked out: the merge happens without touching your working
                    tree.
                  </Status>
                )
              )}
            </div>
          )}
        </div>
        <OutputChoice
          inPlaceLabel={`Into ${target || 'the branch'}`}
          inPlaceHint="moves the branch (a backup is kept)"
          mode={outMode}
          setMode={setOutMode}
          name={branchName}
          setName={setName}
        />
        {!ff && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted">Commit message</label>
            <textarea
              className="field mono h-14 resize-y py-1.5"
              value={message}
              placeholder={
                mode === 'squash'
                  ? `Squashed '${source.trim()}' (with the list of commits)`
                  : `Merge branch '${source.trim()}' into ${branch}`
              }
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
        )}
        <CommandBox lines={command} />
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}

/* ---------------- rebase onto ---------------- */

function RebaseForm({ req }: { req: Extract<IntegrateRequest, { kind: 'rebase' }> }) {
  const repoId = useRepoId()
  const refs = useRefs()
  const status = useStatus()
  const ui = useUi()
  const dirty = (status.data?.entries ?? []).some((e) => !e.untracked)
  const [branch, setBranch] = useState(req.branch ?? refs.data?.currentBranch ?? '')
  const [onto, setOnto] = useState(req.onto ?? '')
  const [outMode, setOutMode] = useState<IntegrateOutput['mode']>('new-branch')
  const [name, setName] = useState('')
  const [autostash, setAutostash] = useState(true)
  const [keepMerges, setKeepMerges] = useState(false)
  const [busy, setBusy] = useState(false)
  const settled = useSettled(`${branch}\0${onto.trim()}`)
  const [qBranch, qOnto] = settled.split('\0')

  const preview = useQuery({
    queryKey: ['repo', repoId, 'rebase-preview', qBranch, qOnto],
    queryFn: () => call('branch.rebasePreview', repoId, qBranch, qOnto),
    enabled: !!qBranch && !!qOnto,
    retry: false
  })
  const p = preview.data && preview.data.onto === onto.trim() ? preview.data : undefined
  const branchName = name || `${branch}-rebased`
  const result = outMode === 'new-branch' ? branchName : branch
  const blocked = !p || p.upToDate || !p.commits.length

  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await call('branch.rebaseOnto', repoId, {
        branch,
        onto: onto.trim(),
        output:
          outMode === 'new-branch'
            ? { mode: 'new-branch', name: branchName }
            : { mode: 'in-place' },
        autostash,
        keepMerges
      })
      finish(r)
    } catch (e) {
      showError(e, 'Could not rebase')
    } finally {
      setBusy(false)
      void invalidateRepo(queryClient, repoId)
    }
  }

  const command = [
    ...(outMode === 'new-branch' ? [`git branch ${branchName} ${branch}`] : []),
    `git rebase${autostash ? ' --autostash' : ''}${keepMerges ? ' --rebase-merges' : ''} ${onto.trim() || '<new base>'} ${result}`
  ]

  return (
    <Modal
      open
      width={600}
      onOpenChange={(o) => !o && ui.closeIntegrate()}
      title="Rebase onto"
      description="Replay a branch's own commits on top of another commit."
      footer={
        <>
          <Button onClick={() => ui.closeIntegrate()}>Cancel</Button>
          <Button variant="primary" disabled={busy || blocked} onClick={() => void submit()}>
            Rebase {result}
            {onto.trim() ? ` onto ${onto.trim()}` : ''}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (!busy && !blocked) void submit()
        }}
      >
        <Row label="Rebase">
          <Select
            className="flex-1"
            value={branch}
            onChange={setBranch}
            aria-label="Rebase"
            options={branchOptions(refs.data)}
          />
        </Row>
        <Row label="Onto">
          <RefInput
            autoFocus={!req.onto}
            className="flex-1"
            value={onto}
            onChange={setOnto}
            options={refNames(refs.data).filter((r) => r !== branch)}
            placeholder="branch, remote branch, tag or commit"
          />
        </Row>
        <div className="rounded-md border border-line bg-bg/50 px-3 py-2">
          {!onto.trim() ? (
            <Status tone="muted">Choose the new base.</Status>
          ) : preview.isError ? (
            <Status tone="warn">{(preview.error as Error).message}</Status>
          ) : !p ? (
            <Status tone="muted">Checking…</Status>
          ) : p.upToDate ? (
            <Status tone="muted">
              {branch} is already based on {p.onto}. Nothing to do.
            </Status>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Status tone="ok">
                {p.commits.length} commit{p.commits.length === 1 ? '' : 's'} will be replayed onto{' '}
                {p.onto} ({short(p.ontoSha)})
              </Status>
              <div className="mono max-h-32 overflow-auto text-muted">
                {p.commits.map((c) => (
                  <div key={c.sha} className="truncate">
                    <span className="text-faint">{short(c.sha)}</span> {c.subject}
                  </div>
                ))}
              </div>
              <Status tone="muted">
                Conflicts stop the rebase for the merge editor. {result} is checked out afterwards.
              </Status>
            </div>
          )}
        </div>
        <OutputChoice
          inPlaceLabel={`Rewrite ${branch || 'the branch'} in place`}
          inPlaceHint="a backup is kept; pushing needs force"
          mode={outMode}
          setMode={setOutMode}
          name={branchName}
          setName={setName}
        />
        <div className="flex flex-col gap-1.5">
          <Checkbox
            checked={autostash}
            onChange={setAutostash}
            label={`Autostash uncommitted changes${dirty ? ' (you have some)' : ''}`}
          />
          {p?.hasMerges && (
            <Checkbox
              checked={keepMerges}
              onChange={setKeepMerges}
              label="Keep merge commits (--rebase-merges) instead of flattening them"
            />
          )}
        </div>
        <CommandBox lines={command} />
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}

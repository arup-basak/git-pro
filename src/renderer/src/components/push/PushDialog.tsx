import { buildPushArgs, formatCommand } from '@shared/push'
import type { ForceMode, PushResult, PushSpec } from '@shared/types'
import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { queryClient } from '../../lib/actions'
import { call } from '../../lib/api'
import { cx, short } from '../../lib/format'
import { invalidateRepo, showError, useRefs, useRepoId } from '../../lib/queries'
import { useUi } from '../../lib/store'
import { confirmDialog } from '../../lib/dialogs'
import { Button, Checkbox, Combobox, Modal, Select } from '../ui'

export function PushDialog() {
  const prefill = useUi((s) => s.push)
  return prefill ? <PushForm key={JSON.stringify(prefill)} prefill={prefill} /> : null
}

/** Keeps the end of long URLs/paths, which identifies the repository. */
function shortUrl(url: string): string {
  return url.length > 56 ? `…${url.slice(-55)}` : url
}

const PROTECTED = /^(main|master|release.*|prod.*|production)$/

function PushForm({ prefill }: { prefill: Partial<PushSpec> }) {
  const repoId = useRepoId()
  const ui = useUi()
  const refs = useRefs()
  const data = refs.data
  const [sourceKind, setSourceKind] = useState<PushSpec['sourceKind']>(
    prefill.sourceKind ?? 'branch'
  )
  const [source, setSource] = useState(prefill.source ?? data?.currentBranch ?? '')
  const [remote, setRemote] = useState(prefill.remote ?? data?.remotes[0]?.name ?? '')
  const [dest, setDest] = useState(
    prefill.dest ??
      (prefill.sourceKind !== 'commit' ? (prefill.source ?? data?.currentBranch ?? '') : '')
  )
  const [force, setForce] = useState<ForceMode>(prefill.force ?? 'none')
  /** null = follow the source: on when the branch has no upstream yet (or it was deleted). */
  const [upstreamChoice, setUpstreamChoice] = useState<boolean | null>(prefill.setUpstream ?? null)
  const [followTags, setFollowTags] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<PushResult | null>(null)
  const progress = useUi((s) => s.progress)
  const sourceInfo =
    sourceKind === 'branch' ? data?.branches.find((b) => b.name === source.trim()) : undefined
  const unconnected = !!sourceInfo && (!sourceInfo.upstream || !!sourceInfo.gone)
  const setUpstream = sourceKind === 'branch' && (upstreamChoice ?? unconnected)

  const spec: PushSpec = {
    remote,
    sourceKind,
    source: source.trim(),
    dest: dest.trim(),
    force,
    setUpstream,
    followTags,
    dryRun: false
  }
  const remoteBranches = (data?.remoteBranches ?? []).filter((r) => r.remote === remote)
  const existing = remoteBranches.find((r) => r.name === spec.dest)
  const sourceSha =
    sourceKind === 'branch' ? data?.branches.find((b) => b.name === spec.source)?.sha : undefined
  const command = formatCommand(buildPushArgs(spec))
  const valid = !!remote && !!spec.source && !!spec.dest
  const close = (): void => ui.closePush()

  const go = async (dryRun: boolean): Promise<void> => {
    if (!dryRun && force !== 'none') {
      const ok = await confirmDialog({
        title:
          force === 'force' ? 'Force push (overwrite unconditionally)?' : 'Force push with lease?',
        message:
          `${remote}/${spec.dest} will be overwritten with ${sourceKind === 'branch' ? spec.source : short(spec.source)}.` +
          (force === 'force'
            ? '\n\nPlain --force ignores what is on the remote: commits pushed by others since your last fetch will be lost.'
            : '\n\n--force-with-lease refuses if the remote moved since your last fetch.') +
          (PROTECTED.test(spec.dest)
            ? `\n\n${spec.dest} looks like a shared/protected branch.`
            : ''),
        confirmLabel: 'Force push',
        danger: true
      })
      if (!ok) return
    }
    setBusy(true)
    setResult(null)
    try {
      const r = await call('remote.push', repoId, { ...spec, dryRun })
      setResult(r)
      if (r.ok && !dryRun)
        toast.success(`Pushed to ${remote}/${spec.dest}`, { description: r.summary })
    } catch (e) {
      showError(e, 'Push failed')
    } finally {
      setBusy(false)
      void invalidateRepo(queryClient, repoId)
    }
  }

  return (
    <Modal
      open
      width={620}
      onOpenChange={(o) => !o && close()}
      title="Push"
      description="Push any local branch or any commit to any branch on a remote."
      footer={
        <>
          <Button onClick={close}>{result?.ok ? 'Close' : 'Cancel'}</Button>
          <Button disabled={!valid || busy} onClick={() => void go(true)}>
            Dry run
          </Button>
          <Button
            variant={force === 'none' ? 'primary' : 'danger'}
            disabled={!valid || busy}
            onClick={() => void go(false)}
          >
            {busy ? 'Pushing…' : force === 'none' ? 'Push' : 'Force push'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
        <label className="text-xs text-muted">Source</label>
        <div className="flex min-w-0 gap-2">
          <Select
            value={sourceKind}
            onChange={setSourceKind}
            className="w-36 shrink-0"
            aria-label="Source kind"
            options={[
              { value: 'branch', label: 'Local branch' },
              { value: 'commit', label: 'Commit / ref' }
            ]}
          />
          {sourceKind === 'branch' ? (
            <Select
              value={source}
              onChange={setSource}
              className="flex-1"
              aria-label="Source branch"
              options={[
                ...(data?.branches.some((b) => b.name === source)
                  ? []
                  : [{ value: source, label: source || '—' }]),
                ...(data?.branches ?? []).map((b) => ({
                  value: b.name,
                  label: b.name,
                  hint: b.current ? 'current' : undefined
                }))
              ]}
            />
          ) : (
            <input
              className="field mono flex-1"
              placeholder="SHA, tag, HEAD~2…"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          )}
        </div>

        <label className="text-xs text-muted">Remote</label>
        <Select
          value={remote}
          onChange={setRemote}
          aria-label="Remote"
          options={(data?.remotes ?? []).map((r) => ({
            value: r.name,
            label: `${r.name} — ${shortUrl(r.pushUrl || r.fetchUrl)}`
          }))}
        />

        <label className="text-xs text-muted">Remote branch</label>
        <div>
          <Combobox
            mono
            autoFocus
            placeholder="branch name on the remote (new or existing)"
            value={dest}
            onChange={setDest}
            options={remoteBranches.map((r) => ({ value: r.name }))}
          />
          <div className="mt-1 text-[11px] text-faint">
            {spec.dest
              ? existing
                ? `Exists on ${remote} at ${short(existing.sha)}${sourceSha === existing.sha ? ' — already up to date' : ''}`
                : `Will create ${remote}/${spec.dest}`
              : ' '}
          </div>
        </div>

        <label className="text-xs text-muted">Force</label>
        <div className="flex rounded-md border border-line p-0.5">
          {(
            [
              ['none', 'No'],
              ['lease', 'With lease (safe)'],
              ['force', 'Force (dangerous)']
            ] as Array<[ForceMode, string]>
          ).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setForce(v)}
              className={cx(
                'h-6 flex-1 rounded text-xs',
                force === v
                  ? v === 'force'
                    ? 'bg-bad/25 text-bad'
                    : 'bg-line-strong text-fg'
                  : 'text-muted hover:text-fg'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <span />
        <div className="flex gap-4">
          <Checkbox
            checked={setUpstream}
            onChange={setUpstreamChoice}
            disabled={sourceKind !== 'branch'}
            label="Set as upstream"
            title={
              unconnected
                ? `${sourceInfo!.name} ${sourceInfo!.gone ? 'tracks a deleted branch' : 'has no upstream'}; pushing will connect it to ${remote}/${spec.dest || '…'}`
                : sourceInfo?.upstream
                  ? `${sourceInfo.name} currently tracks ${sourceInfo.upstream}`
                  : undefined
            }
          />
          <Checkbox
            checked={followTags}
            onChange={setFollowTags}
            label="Push reachable annotated tags"
          />
        </div>
      </div>

      {force !== 'none' && PROTECTED.test(spec.dest) && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">
          <AlertTriangle size={14} /> {spec.dest} looks like a shared branch. Force pushing rewrites
          it for everyone.
        </div>
      )}

      <div className="mt-4">
        <div className="mb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">
          Command
        </div>
        <div className="mono rounded-md border border-line bg-bg px-3 py-2 break-all whitespace-pre-wrap text-muted select-text">
          {command}
        </div>
      </div>

      {(busy || result) && (
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">
            {busy ? 'Progress' : result?.ok ? 'Result' : 'Rejected'}
          </div>
          <pre
            className={cx(
              'mono max-h-48 overflow-auto rounded-md border px-3 py-2 whitespace-pre-wrap select-text',
              result && !result.ok
                ? 'border-bad/40 bg-bad/5 text-bad'
                : 'border-line bg-bg text-muted'
            )}
          >
            {busy ? (progress ?? 'Connecting…') : `${result!.summary}\n\n${result!.output}`}
          </pre>
        </div>
      )}
    </Modal>
  )
}

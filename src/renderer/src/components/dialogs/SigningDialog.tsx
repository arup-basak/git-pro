import type { ConfigScope, SigningConfig, SigningFormat } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, XCircle } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { call } from '../../lib/api'
import { cx } from '../../lib/format'
import { showError, useRepoId } from '../../lib/queries'
import { useUi } from '../../lib/store'
import { Button, Checkbox, Combobox, Modal } from '../ui'

export function SigningDialog() {
  const open = useUi((s) => s.signingOpen)
  const repo = useUi((s) => s.repo)
  return open && repo ? <SigningForm /> : null
}

const FORMATS: Array<[SigningFormat, string]> = [
  ['openpgp', 'GPG (OpenPGP)'],
  ['ssh', 'SSH key'],
  ['x509', 'X.509 (gpgsm)']
]

function SigningForm() {
  const repoId = useRepoId()
  const close = (): void => useUi.getState().setSigningOpen(false)
  const current = useQuery({
    queryKey: ['repo', repoId, 'signing'],
    queryFn: () => call('signing.get', repoId)
  })
  const keys = useQuery({
    queryKey: ['signing-keys', repoId],
    queryFn: () => call('signing.keys', repoId),
    staleTime: 60_000
  })
  if (!current.data) return null
  return (
    <SigningFields
      key={JSON.stringify(current.data)}
      initial={current.data}
      keys={keys.data ?? []}
      repoId={repoId}
      close={close}
    />
  )
}

function SigningFields({
  initial,
  keys,
  repoId,
  close
}: {
  initial: SigningConfig
  keys: Array<{ format: SigningFormat; id: string; label: string }>
  repoId: string
  close: () => void
}) {
  const [c, setC] = useState<SigningConfig>(initial)
  const [scope, setScope] = useState<ConfigScope>(
    initial.keyScope === 'global' ? 'global' : 'local'
  )
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (p: Partial<SigningConfig>): void => {
    setC((x) => ({ ...x, ...p }))
    setTest(null)
  }
  const options = keys.filter((k) => k.format === c.format)

  const save = async (andTest: boolean): Promise<void> => {
    setBusy(true)
    try {
      await call('signing.set', repoId, scope, c)
      if (andTest) setTest(await call('signing.test', repoId))
      else {
        toast.success(
          `Signing settings saved to the ${scope === 'local' ? 'repository' : 'global'} config`
        )
        close()
      }
    } catch (e) {
      showError(e, 'Could not save signing settings')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      width={560}
      onOpenChange={(o) => !o && close()}
      title="Commit signing"
      description="Sign commits and tags with a GPG or SSH key. Git Pro writes the same settings `git config` would."
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button disabled={busy} onClick={() => void save(true)}>
            Save and test
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void save(false)}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted">Key type</label>
          <div className="flex rounded-md border border-line p-0.5">
            {FORMATS.map(([f, label]) => (
              <button
                key={f}
                type="button"
                onClick={() => set({ format: f, key: f === initial.format ? initial.key : '' })}
                className={cx(
                  'h-6 flex-1 rounded text-xs',
                  c.format === f ? 'bg-line-strong text-fg' : 'text-muted hover:text-fg'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted">
            Signing key <span className="text-faint">(user.signingkey)</span>
          </label>
          <Combobox
            mono
            value={c.key}
            placeholder={
              c.format === 'ssh' ? '~/.ssh/id_ed25519.pub' : 'key id; empty = your default key'
            }
            onChange={(key) => set({ key })}
            options={options.map((k) => ({ value: k.id, label: k.label }))}
          />
          {options.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {options.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => set({ key: k.id })}
                  className={cx(
                    'max-w-full truncate rounded border px-1.5 py-0.5 text-[11px]',
                    c.key === k.id
                      ? 'border-accent text-fg'
                      : 'border-line text-muted hover:text-fg'
                  )}
                  title={k.id}
                >
                  {k.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Checkbox
            checked={c.signCommits}
            onChange={(v) => set({ signCommits: v })}
            label="Sign every commit (commit.gpgsign)"
          />
          <Checkbox
            checked={c.signTags}
            onChange={(v) => set({ signTags: v })}
            label="Sign every annotated tag (tag.gpgsign)"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted">Save to</label>
          <div className="flex gap-4 text-[13px]">
            {(
              [
                ['local', 'This repository'],
                ['global', 'All repositories (global config)']
              ] as const
            ).map(([s, label]) => (
              <label key={s} className="flex items-center gap-1.5">
                <input
                  type="radio"
                  className="accent-accent-strong"
                  checked={scope === s}
                  onChange={() => setScope(s)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
        {test && (
          <div
            className={cx(
              'flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-xs whitespace-pre-wrap',
              test.ok ? 'border-ok/40 text-ok' : 'border-bad/40 text-bad'
            )}
          >
            {test.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
            {test.message}
          </div>
        )}
      </div>
    </Modal>
  )
}

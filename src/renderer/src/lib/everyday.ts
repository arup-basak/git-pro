import type { BisectState, RepoStatus, StatusEntry, WorktreeInfo } from '@shared/types'
import { toast } from 'sonner'
import type { MenuEntry } from '../components/ui'
import { copy, queryClient } from './actions'
import { call, errorParts } from './api'
import { confirmDialog, openForm } from './dialogs'
import { short } from './format'
import { invalidateRepo, keys, showError } from './queries'
import { useUi } from './store'
import { showOpenedRepo } from './useOpenRepo'

/* Blame, file history, ignore, bisect and worktrees (the "everyday git" actions). */

function repoId(): string {
  const r = useUi.getState().repo
  if (!r) throw new Error('No repository open')
  return r.id
}

async function attempt<T>(fn: () => Promise<T>, errorTitle: string): Promise<T | undefined> {
  const id = repoId()
  try {
    return await fn()
  } catch (e) {
    showError(e, errorTitle)
    return undefined
  } finally {
    void invalidateRepo(queryClient, id)
  }
}

/* ---------- files ---------- */

export function openBlame(path: string, rev: string | null = null): void {
  useUi.getState().openFile({ path, tab: 'blame', rev })
}

export function openFileHistory(path: string): void {
  useUi.getState().openFile({ path, tab: 'history', rev: null })
}

/** Right-click menu for a file row. `rev` blames that revision; `entry` adds working-tree items. */
export function fileMenu(
  path: string,
  opts: { rev?: string; entry?: StatusEntry } = {}
): MenuEntry[] {
  const id = repoId()
  const deleted = opts.entry && (opts.entry.worktree === 'D' || opts.entry.index === 'D')
  return [
    {
      label: 'Blame',
      disabled: opts.entry?.untracked,
      onSelect: () => openBlame(path, opts.rev ?? null)
    },
    {
      label: 'File history',
      disabled: opts.entry?.untracked,
      onSelect: () => openFileHistory(path)
    },
    { separator: true },
    {
      label: 'Reveal in Finder',
      disabled: !!deleted,
      onSelect: () => void call('repo.reveal', id, path).catch((e) => showError(e))
    },
    {
      label: 'Open in default app',
      disabled: !!deleted,
      onSelect: () => void call('repo.openFile', id, path).catch((e) => showError(e))
    },
    ...(opts.entry
      ? [
          { separator: true },
          { label: 'Ignore…', onSelect: () => void ignoreFile(path, !opts.entry!.untracked) }
        ]
      : []),
    { separator: true },
    { label: 'Copy path', onSelect: () => copy(path, 'Path copied') }
  ]
}

/** Patterns worth suggesting for a path: the path itself, its extension, its folders. */
export function ignoreSuggestions(path: string): string[] {
  const out = [path]
  const name = path.split('/').pop() ?? path
  const dot = name.lastIndexOf('.')
  if (dot > 0) out.push(`*${name.slice(dot)}`)
  const parts = path.split('/').slice(0, -1)
  for (let i = parts.length; i > 0; i--) out.push(`${parts.slice(0, i).join('/')}/`)
  return out
}

export async function ignoreFile(path: string, tracked: boolean): Promise<void> {
  const options = ignoreSuggestions(path)
  const v = await openForm<{ pattern: string; custom: string; target: string; untrack: boolean }>({
    title: `Ignore ${path}`,
    submitLabel: 'Ignore',
    fields: [
      {
        name: 'pattern',
        label: 'Pattern',
        type: 'select',
        default: options[0],
        options: [...options.map((o) => ({ value: o, label: o })), { value: '', label: 'Custom…' }]
      },
      {
        name: 'custom',
        label: 'Custom pattern',
        type: 'text',
        mono: true,
        placeholder: 'e.g. *.log or build/',
        showIf: (x) => x.pattern === ''
      },
      {
        name: 'target',
        label: 'Add it to',
        type: 'select',
        default: 'gitignore',
        options: [
          { value: 'gitignore', label: '.gitignore (shared with everyone)' },
          { value: 'exclude', label: '.git/info/exclude (this clone only)' }
        ]
      },
      ...(tracked
        ? [
            {
              name: 'untrack',
              label: 'Stop tracking it (git rm --cached; the file stays on disk)',
              type: 'checkbox' as const,
              default: true
            }
          ]
        : [])
    ]
  })
  if (!v) return
  const pattern = (v.pattern || v.custom).trim()
  if (!pattern) return
  const r = await attempt(
    () =>
      call('file.ignore', repoId(), {
        pattern,
        target: v.target === 'exclude' ? 'exclude' : 'gitignore',
        untrack: tracked && v.untrack ? [path] : []
      }),
    'Could not ignore'
  )
  if (r)
    toast.success(
      r.added ? `Added ${pattern} to ${r.file.split('/').pop()}` : `${pattern} was already ignored`
    )
}

/* ---------- bisect ---------- */

function bisecting(): boolean {
  return queryClient.getQueryData<RepoStatus>(keys.status(repoId()))?.op.kind === 'bisect'
}

function bisectToast(s: BisectState | undefined): void {
  if (!s) return
  queryClient.setQueryData(keys.bisect(repoId()), s)
  if (s.firstBad) {
    toast.success(`First bad commit: ${short(s.firstBad.sha)} ${s.firstBad.subject}`, {
      duration: 15000
    })
  } else if (s.current) {
    toast(`Now test ${short(s.current)}`, {
      description: `Mark it good or bad.${s.remaining != null ? ` About ${s.remaining} step${s.remaining === 1 ? '' : 's'} left.` : ''}`
    })
  }
}

export async function bisectStartAt(badSha: string): Promise<void> {
  const v = await openForm<{ good: string }>({
    title: `Bisect: ${short(badSha)} is bad`,
    description:
      'Git checks out commits between a good and a bad one; you test each and mark it, until the commit that broke things is found. Your working tree must be clean.',
    submitLabel: 'Start bisect',
    fields: [
      {
        name: 'good',
        label: 'Last known good commit',
        type: 'text',
        mono: true,
        required: true,
        placeholder: 'commit, tag or branch'
      }
    ]
  })
  if (!v) return
  bisectToast(
    await attempt(
      () => call('bisect.start', repoId(), badSha, v.good.trim()),
      'Could not start bisect'
    )
  )
}

export async function bisectMark(verdict: 'good' | 'bad' | 'skip', rev?: string): Promise<void> {
  bisectToast(
    await attempt(() => call('bisect.mark', repoId(), verdict, rev), `Could not mark ${verdict}`)
  )
}

export async function bisectEnd(): Promise<void> {
  const ended = await attempt(async () => {
    await call('bisect.reset', repoId())
    return true
  }, 'Could not end bisect')
  if (!ended) return
  queryClient.removeQueries({ queryKey: keys.bisect(repoId()) })
  toast.success('Bisect ended; back where you started')
}

export function bisectMenu(sha: string): MenuEntry {
  return bisecting()
    ? {
        label: 'Bisect',
        sub: [
          { label: 'Mark as good', onSelect: () => void bisectMark('good', sha) },
          { label: 'Mark as bad', onSelect: () => void bisectMark('bad', sha) },
          { label: 'Skip (cannot test)', onSelect: () => void bisectMark('skip', sha) },
          { separator: true },
          { label: 'End bisect', onSelect: () => void bisectEnd() }
        ]
      }
    : { label: 'Bisect from here (this commit is bad)…', onSelect: () => void bisectStartAt(sha) }
}

/* ---------- worktrees ---------- */

export async function addWorktree(branch?: string): Promise<void> {
  let req: { branch: string; create: boolean; startPoint?: string }
  if (branch) {
    req = { branch, create: false }
  } else {
    const v = await openForm<{ mode: string; branch: string; start: string }>({
      title: 'New worktree',
      description:
        'A second working folder for this repository, with its own checked-out branch. You will choose where to put it.',
      submitLabel: 'Choose folder…',
      fields: [
        {
          name: 'mode',
          label: 'Branch',
          type: 'select',
          default: 'new',
          options: [
            { value: 'new', label: 'Create a new branch' },
            { value: 'existing', label: 'Check out an existing branch' }
          ]
        },
        { name: 'branch', label: 'Branch name', type: 'text', mono: true, required: true },
        {
          name: 'start',
          label: 'Start from',
          type: 'text',
          mono: true,
          default: 'HEAD',
          showIf: (x) => x.mode === 'new'
        }
      ]
    })
    if (!v) return
    req = {
      branch: v.branch.trim(),
      create: v.mode === 'new',
      startPoint: v.start.trim() || 'HEAD'
    }
  }
  const w = await attempt(
    () => call('worktrees.add', repoId(), req),
    'Could not create the worktree'
  )
  if (!w) return
  void queryClient.invalidateQueries({ queryKey: keys.worktrees(repoId()) })
  toast.success(`Worktree for ${req.branch} created`, {
    description: w.path,
    action: { label: 'Open', onClick: () => void openWorktree(w.path) }
  })
}

export async function openWorktree(path: string): Promise<void> {
  try {
    showOpenedRepo(await call('worktrees.open', repoId(), path))
  } catch (e) {
    showError(e, 'Could not open the worktree')
  }
}

export async function removeWorktree(w: WorktreeInfo): Promise<void> {
  const ok = await confirmDialog({
    title: `Remove the worktree at ${w.path}?`,
    message: `The folder is deleted. ${w.branch ? `The branch ${w.branch} is kept.` : ''}`,
    confirmLabel: 'Remove',
    danger: true
  })
  if (!ok) return
  const id = repoId()
  try {
    await call('worktrees.remove', id, w.path, false)
  } catch (e) {
    const { message } = errorParts(e)
    if (!/modified or untracked|contains modified|is dirty|use --force/i.test(message)) {
      showError(e, 'Could not remove the worktree')
      return
    }
    const force = await confirmDialog({
      title: 'The worktree has uncommitted changes',
      message: `${message}\n\nRemove it anyway? Those changes are lost.`,
      confirmLabel: 'Remove anyway',
      danger: true
    })
    if (!force) return
    try {
      await call('worktrees.remove', id, w.path, true)
    } catch (err) {
      showError(err, 'Could not remove the worktree')
      return
    }
  } finally {
    void invalidateRepo(queryClient, id)
  }
  toast.success('Worktree removed')
}

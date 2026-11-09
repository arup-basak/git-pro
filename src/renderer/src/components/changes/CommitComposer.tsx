import { nowGitDate } from '@shared/dates'
import type { GitDate } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { run } from '../../lib/actions'
import { call } from '../../lib/api'
import { short } from '../../lib/format'
import { useRefs, useRepoId } from '../../lib/queries'
import { Button, Checkbox, DateField } from '../ui'

export function CommitComposer({ stagedCount }: { stagedCount: number }) {
  const repoId = useRepoId()
  const refs = useRefs()
  const identity = useQuery({
    queryKey: ['repo', repoId, 'identity'],
    queryFn: () => call('repo.identity', repoId),
    staleTime: Infinity
  })
  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  const [signoff, setSignoff] = useState(false)
  const [noVerify, setNoVerify] = useState(false)
  const [allowEmpty, setAllowEmpty] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [customAuthor, setCustomAuthor] = useState(false)
  const [authorEdit, setAuthor] = useState<{ name: string; email: string } | null>(null)
  const author = authorEdit ?? identity.data ?? { name: '', email: '' }
  const [customDates, setCustomDates] = useState(false)
  const [authorDate, setAuthorDate] = useState<GitDate>(nowGitDate)
  const [committerDate, setCommitterDate] = useState<GitDate>(nowGitDate)
  const [sameDate, setSameDate] = useState(true)
  const [busy, setBusy] = useState(false)
  const head = refs.data?.head

  const toggleAmend = async (v: boolean): Promise<void> => {
    setAmend(v)
    if (v && !message.trim() && head) {
      const d = await call('commit.detail', repoId, head)
      setMessage(d.message.replace(/\n+$/, ''))
      setAuthorDate(d.author.date)
      setCommitterDate(d.committer.date)
    }
  }

  const canCommit = !!message.trim() && (stagedCount > 0 || amend || allowEmpty) && !busy

  const submit = async (): Promise<void> => {
    setBusy(true)
    const sha = await run(
      () =>
        call('worktree.commit', repoId, {
          message,
          amend,
          signoff,
          noVerify,
          allowEmpty,
          author: customAuthor ? author : undefined,
          authorDate: customDates ? authorDate : undefined,
          committerDate: customDates ? (sameDate ? authorDate : committerDate) : undefined
        }),
      (s) => `${amend ? 'Amended' : 'Committed'} ${short(s)}`,
      'Commit failed'
    )
    setBusy(false)
    if (sha) {
      setMessage('')
      setAmend(false)
    }
  }

  return (
    <div className="shrink-0 border-t border-line bg-panel p-2">
      <textarea
        className="field h-[84px] w-full resize-none py-1.5 leading-snug"
        placeholder={`Commit message${refs.data?.currentBranch ? ` (on ${refs.data.currentBranch})` : ''}\n\nBody…`}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canCommit) void submit()
        }}
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Checkbox
          checked={amend}
          onChange={(v) => void toggleAmend(v)}
          label="Amend"
          disabled={!head}
        />
        <Checkbox checked={customDates} onChange={setCustomDates} label="Custom date" />
        <button
          className="flex items-center gap-0.5 text-xs text-muted hover:text-fg"
          onClick={() => setAdvanced(!advanced)}
        >
          {advanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />} More
        </button>
      </div>
      {advanced && (
        <div className="mt-2 flex flex-col gap-1.5 rounded-md border border-line p-2">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <Checkbox checked={signoff} onChange={setSignoff} label="Sign-off" />
            <Checkbox checked={noVerify} onChange={setNoVerify} label="Skip hooks" />
            <Checkbox checked={allowEmpty} onChange={setAllowEmpty} label="Allow empty" />
            <Checkbox checked={customAuthor} onChange={setCustomAuthor} label="Custom author" />
          </div>
          {customAuthor && (
            <div className="flex gap-1.5">
              <input
                className="field min-w-0 flex-1"
                placeholder="Name"
                value={author.name}
                onChange={(e) => setAuthor({ ...author, name: e.target.value })}
              />
              <input
                className="field min-w-0 flex-1"
                placeholder="email@example.com"
                value={author.email}
                onChange={(e) => setAuthor({ ...author, email: e.target.value })}
              />
            </div>
          )}
        </div>
      )}
      {customDates && (
        <div className="mt-2 flex flex-col gap-1.5 rounded-md border border-line p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted">Author date</span>
            <DateField compact value={authorDate} onChange={setAuthorDate} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Checkbox
              checked={sameDate}
              onChange={setSameDate}
              label={<span className="text-xs text-muted">Committer = author</span>}
            />
            <DateField
              compact
              value={sameDate ? authorDate : committerDate}
              onChange={setCommitterDate}
              disabled={sameDate}
            />
          </div>
        </div>
      )}
      <Button
        variant="primary"
        className="mt-2 w-full"
        disabled={!canCommit}
        onClick={() => void submit()}
      >
        {amend
          ? 'Amend last commit'
          : `Commit ${stagedCount ? `${stagedCount} file${stagedCount === 1 ? '' : 's'}` : ''}`}
        <span className="ml-1 text-[11px] opacity-60">⌘↵</span>
      </Button>
    </div>
  )
}

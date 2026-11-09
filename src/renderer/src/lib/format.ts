import { formatGitDate } from '@shared/dates'
import type { GitDate } from '@shared/types'
import { formatDistanceToNowStrict } from 'date-fns'

export const short = (sha: string): string => sha.slice(0, 8)

export function relative(ts: number): string {
  if (!ts) return ''
  return formatDistanceToNowStrict(new Date(ts * 1000), { addSuffix: true })
}

/** "2024-01-05 14:03" in the commit's own offset. */
export function compactDate(d: GitDate): string {
  return formatGitDate(d).slice(0, 16)
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export function defaultEditedBranchName(base: string): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
  const clean = base.replace(/^refs\/heads\//, '').replace(/[^\w./-]/g, '-') || 'history'
  return `${clean}-edited-${stamp}`
}

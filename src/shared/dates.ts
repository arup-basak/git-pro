import type { GitDate } from './types'

const TZ_RE = /^[+-]\d{4}$/

export function isValidTz(tz: string): boolean {
  if (!TZ_RE.test(tz)) return false
  const mm = Number(tz.slice(3, 5))
  return mm < 60
}

export function tzToMinutes(tz: string): number {
  if (!isValidTz(tz)) throw new Error(`Invalid timezone offset "${tz}" (expected ±hhmm)`)
  const sign = tz[0] === '-' ? -1 : 1
  return sign * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5)))
}

export function minutesToTz(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  const hh = String(Math.floor(abs / 60)).padStart(2, '0')
  const mm = String(abs % 60).padStart(2, '0')
  return `${sign}${hh}${mm}`
}

/** Parses git's raw date format: "<unix seconds> <±hhmm>". */
export function parseRawDate(raw: string): GitDate {
  const m = /^@?(-?\d+) ([+-]\d{4})$/.exec(raw.trim())
  if (!m) throw new Error(`Unparseable git date "${raw}"`)
  return { ts: Number(m[1]), tz: m[2] }
}

/** Formats a date for GIT_AUTHOR_DATE / GIT_COMMITTER_DATE / --date. The "@" forces raw parsing. */
export function toGitDateArg(d: GitDate): string {
  assertGitDate(d)
  return `@${d.ts} ${d.tz}`
}

export function assertGitDate(d: GitDate): void {
  if (!Number.isInteger(d.ts) || d.ts < 0) throw new Error(`Invalid timestamp ${d.ts}`)
  if (!isValidTz(d.tz)) throw new Error(`Invalid timezone offset "${d.tz}"`)
}

export function sameDate(a: GitDate, b: GitDate): boolean {
  return a.ts === b.ts && a.tz === b.tz
}

export function shiftDate(d: GitDate, seconds: number): GitDate {
  return { ts: d.ts + seconds, tz: d.tz }
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')

/** Wall-clock fields of the date in its own offset. */
function wallClock(d: GitDate): Date {
  return new Date((d.ts + tzToMinutes(d.tz) * 60) * 1000)
}

/** "YYYY-MM-DDTHH:mm:ss" in the date's own offset, for <input type="datetime-local" step="1">. */
export function toInputValue(d: GitDate): string {
  const w = wallClock(d)
  return (
    `${w.getUTCFullYear()}-${pad(w.getUTCMonth() + 1)}-${pad(w.getUTCDate())}` +
    `T${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())}:${pad(w.getUTCSeconds())}`
  )
}

/** Inverse of toInputValue: interprets a datetime-local value as wall-clock time in `tz`. */
export function fromInputValue(value: string, tz: string): GitDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (!m) throw new Error(`Invalid date/time "${value}"`)
  const utcMs = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0)
  return { ts: Math.round(utcMs / 1000) - tzToMinutes(tz) * 60, tz }
}

/** "2024-01-05 14:03:22 +0530" */
export function formatGitDate(d: GitDate): string {
  return `${toInputValue(d).replace('T', ' ')} ${d.tz}`
}

/** Re-expresses the same instant in another offset. */
export function withTz(d: GitDate, tz: string): GitDate {
  tzToMinutes(tz)
  return { ts: d.ts, tz }
}

/** The machine's current offset as ±hhmm (for a given instant, so DST is respected). */
export function localTz(atMs: number = Date.now()): string {
  return minutesToTz(-new Date(atMs).getTimezoneOffset())
}

export function nowGitDate(): GitDate {
  const now = Date.now()
  return { ts: Math.floor(now / 1000), tz: localTz(now) }
}

/** Every real-world UTC offset, ordered west → east. */
export const TZ_OPTIONS: string[] = [
  -720, -660, -600, -570, -540, -480, -420, -360, -300, -240, -210, -180, -120, -60, 0, 60, 120,
  180, 210, 240, 270, 300, 330, 345, 360, 390, 420, 480, 525, 540, 570, 600, 630, 660, 720, 765,
  780, 840
].map(minutesToTz)

/** Evenly spaced timestamps from start to end (inclusive), oldest first. */
export function spreadEvenly(start: number, end: number, n: number): number[] {
  if (n <= 0) return []
  if (n === 1) return [start]
  const step = (end - start) / (n - 1)
  return Array.from({ length: n }, (_, i) => Math.round(start + step * i))
}

/** n random timestamps in [start, end], sorted ascending (so commit order is kept). */
export function spreadRandom(start: number, end: number, n: number, rand = Math.random): number[] {
  const out = Array.from({ length: n }, () => Math.round(start + rand() * (end - start)))
  return out.sort((a, b) => a - b)
}

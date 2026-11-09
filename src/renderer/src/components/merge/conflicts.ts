export type Choice = 'ours' | 'theirs' | 'both' | 'base' | 'custom'

export interface TextSeg {
  kind: 'text'
  text: string
}

export interface ConflictSeg {
  kind: 'conflict'
  ours: string
  base: string | null
  theirs: string
  oursLabel: string
  baseLabel: string
  theirsLabel: string
  choice: Choice | null
  custom: string
}

export type Segment = TextSeg | ConflictSeg

const START = /^<{7}(?: |$)/
const BASE = /^\|{7}(?: |$)/
const SEP = /^={7}$/
const END = /^>{7}(?: |$)/

/** Splits text containing git conflict markers (merge or diff3 style) into segments. */
export function parseConflicts(text: string): Segment[] {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const segs: Segment[] = []
  let buf = ''
  let raw = ''
  let state: 'text' | 'ours' | 'base' | 'theirs' = 'text'
  let cur: ConflictSeg | null = null
  const flush = (): void => {
    if (buf) segs.push({ kind: 'text', text: buf })
    buf = ''
  }
  for (const line of lines) {
    const bare = line.replace(/\r?\n$/, '')
    if (state === 'text') {
      if (START.test(bare)) {
        flush()
        raw = line
        cur = {
          kind: 'conflict',
          ours: '',
          base: null,
          theirs: '',
          oursLabel: bare.slice(8),
          baseLabel: '',
          theirsLabel: '',
          choice: null,
          custom: ''
        }
        state = 'ours'
      } else {
        buf += line
      }
      continue
    }
    raw += line
    if (state === 'ours' && BASE.test(bare)) {
      cur!.base = ''
      cur!.baseLabel = bare.slice(8)
      state = 'base'
    } else if ((state === 'ours' || state === 'base') && SEP.test(bare)) {
      state = 'theirs'
    } else if (state === 'theirs' && END.test(bare)) {
      cur!.theirsLabel = bare.slice(8)
      segs.push(cur!)
      cur = null
      state = 'text'
    } else if (state === 'ours') cur!.ours += line
    else if (state === 'base') cur!.base += line
    else cur!.theirs += line
  }
  if (state !== 'text') buf += raw // unterminated block: keep it verbatim
  flush()
  return segs
}

export function resolvedText(seg: ConflictSeg): string | null {
  switch (seg.choice) {
    case 'ours':
      return seg.ours
    case 'theirs':
      return seg.theirs
    case 'both':
      return seg.ours + seg.theirs
    case 'base':
      return seg.base ?? ''
    case 'custom':
      return seg.custom
    default:
      return null
  }
}

function markers(seg: ConflictSeg): string {
  const nl = (s: string): string => (s && !s.endsWith('\n') ? s + '\n' : s)
  return (
    `<<<<<<< ${seg.oursLabel}\n${nl(seg.ours)}` +
    (seg.base !== null ? `||||||| ${seg.baseLabel}\n${nl(seg.base)}` : '') +
    `=======\n${nl(seg.theirs)}>>>>>>> ${seg.theirsLabel}\n`
  )
}

export function compose(segs: Segment[]): { text: string; unresolved: number } {
  let text = ''
  let unresolved = 0
  for (const s of segs) {
    if (s.kind === 'text') text += s.text
    else {
      const r = resolvedText(s)
      if (r === null) {
        unresolved++
        text += markers(s)
      } else text += r
    }
  }
  return { text, unresolved }
}

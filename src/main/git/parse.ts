import { parseRawDate } from '../../shared/dates'
import type {
  CommitSummary,
  FileChange,
  GitDate,
  Identity,
  RefLabel,
  StatusEntry
} from '../../shared/types'

export const FS = '\x1f'
export const RS = '\x1e'

/** `git log` format producing one record per commit, fields split by \x1f, records by \x1e. */
export const LOG_FORMAT = ['%H', '%P', '%an', '%ae', '%ad', '%cn', '%ce', '%cd', '%D', '%s']
  .join('%x1f')
  .concat('%x1e')

export function parseLog(stdout: string): CommitSummary[] {
  const commits: CommitSummary[] = []
  for (const rec of stdout.split(RS)) {
    const r = rec.replace(/^\n/, '')
    if (!r) continue
    const [sha, parents, an, ae, ad, cn, ce, cd, deco, subject] = r.split(FS)
    commits.push({
      sha,
      parents: parents ? parents.split(' ') : [],
      author: { name: an, email: ae, date: parseRawDate(ad) },
      committer: { name: cn, email: ce, date: parseRawDate(cd) },
      refs: parseDecorations(deco ?? ''),
      subject: subject ?? ''
    })
  }
  return commits
}

/** Parses `%D` output produced with `--decorate=full`. */
export function parseDecorations(deco: string): RefLabel[] {
  const out: RefLabel[] = []
  if (!deco.trim()) return out
  for (const raw of deco.split(', ')) {
    const part = raw.trim()
    if (part.startsWith('HEAD -> ')) {
      out.push({ kind: 'head', name: 'HEAD' })
      const ref = part.slice('HEAD -> '.length)
      out.push({ ...classifyRef(ref), current: true })
    } else if (part === 'HEAD') {
      out.push({ kind: 'head', name: 'HEAD' })
    } else if (part.startsWith('tag: ')) {
      out.push(classifyRef(part.slice(5)))
    } else {
      const label = classifyRef(part)
      if (label.kind === 'remote' && label.name.endsWith('/HEAD')) continue
      out.push(label)
    }
  }
  return out
}

function classifyRef(ref: string): RefLabel {
  if (ref.startsWith('refs/heads/')) return { kind: 'branch', name: ref.slice(11) }
  if (ref.startsWith('refs/remotes/')) return { kind: 'remote', name: ref.slice(13) }
  if (ref.startsWith('refs/tags/')) return { kind: 'tag', name: ref.slice(10) }
  return { kind: 'branch', name: ref }
}

export interface RawCommit {
  tree: string
  parents: string[]
  author: Identity
  committer: Identity
  encoding: string | null
  signed: boolean
  /** Message bytes exactly as stored. */
  message: Buffer
}

const IDENT_RE = /^(.*) <(.*)> (-?\d+) ([+-]\d{4})$/

export function parseIdentLine(value: string): Identity {
  const m = IDENT_RE.exec(value)
  if (!m) throw new Error(`Unparseable identity line "${value}"`)
  const date: GitDate = { ts: Number(m[3]), tz: m[4] }
  return { name: m[1], email: m[2], date }
}

/** Parses `git cat-file commit <sha>` output, keeping the message as raw bytes. */
export function parseRawCommit(buf: Buffer): RawCommit {
  const sep = buf.indexOf('\n\n')
  const headerText = (sep === -1 ? buf : buf.subarray(0, sep)).toString('utf8')
  const message = sep === -1 ? Buffer.alloc(0) : buf.subarray(sep + 2)
  let tree = ''
  const parents: string[] = []
  let author: Identity | null = null
  let committer: Identity | null = null
  let encoding: string | null = null
  let signed = false
  for (const line of headerText.split('\n')) {
    if (line.startsWith(' ')) continue // continuation of a multi-line header (gpgsig, mergetag)
    const sp = line.indexOf(' ')
    const key = sp === -1 ? line : line.slice(0, sp)
    const value = sp === -1 ? '' : line.slice(sp + 1)
    switch (key) {
      case 'tree':
        tree = value
        break
      case 'parent':
        parents.push(value)
        break
      case 'author':
        author = parseIdentLine(value)
        break
      case 'committer':
        committer = parseIdentLine(value)
        break
      case 'encoding':
        encoding = value
        break
      case 'gpgsig':
      case 'gpgsig-sha256':
        signed = true
        break
    }
  }
  if (!tree || !author || !committer) throw new Error('Malformed commit object')
  return { tree, parents, author, committer, encoding, signed, message }
}

export function subjectOf(message: string): string {
  return message.split('\n').find((l) => l.trim() !== '') ?? ''
}

/** Parses `git status --porcelain=v2 -z --branch --untracked-files=all`. */
export function parseStatus(stdout: string): {
  head: string | null
  branch: string | null
  upstream?: string
  ahead: number
  behind: number
  entries: StatusEntry[]
} {
  const tokens = stdout.split('\0')
  let head: string | null = null
  let branch: string | null = null
  let upstream: string | undefined
  let ahead = 0
  let behind = 0
  const entries: StatusEntry[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (!t) continue
    if (t.startsWith('# ')) {
      const [, key, ...rest] = t.split(' ')
      const val = rest.join(' ')
      if (key === 'branch.oid') head = val === '(initial)' ? null : val
      else if (key === 'branch.head') branch = val === '(detached)' ? null : val
      else if (key === 'branch.upstream') upstream = val
      else if (key === 'branch.ab') {
        const m = /\+(\d+) -(\d+)/.exec(val)
        if (m) {
          ahead = +m[1]
          behind = +m[2]
        }
      }
      continue
    }
    const type = t[0]
    if (type === '1') {
      const f = splitN(t, 9)
      entries.push(entry(f[8], f[1]))
    } else if (type === '2') {
      const f = splitN(t, 10)
      const e = entry(f[9], f[1])
      e.origPath = tokens[++i]
      entries.push(e)
    } else if (type === 'u') {
      const f = splitN(t, 11)
      entries.push({ ...entry(f[10], f[1]), conflicted: true })
    } else if (type === '?') {
      entries.push({
        path: t.slice(2),
        index: '.',
        worktree: '?',
        conflicted: false,
        untracked: true
      })
    }
  }
  return { head, branch, upstream, ahead, behind, entries }
}

function entry(path: string, xy: string): StatusEntry {
  return { path, index: xy[0], worktree: xy[1], conflicted: false, untracked: false }
}

/** Splits on spaces into at most n fields (the last field keeps its spaces, e.g. a path). */
function splitN(s: string, n: number): string[] {
  const out: string[] = []
  let rest = s
  for (let i = 0; i < n - 1; i++) {
    const sp = rest.indexOf(' ')
    if (sp === -1) break
    out.push(rest.slice(0, sp))
    rest = rest.slice(sp + 1)
  }
  out.push(rest)
  return out
}

/** Combines `git diff --name-status -z -M` and `git diff --numstat -z -M` output. */
export function parseFileChanges(nameStatus: string, numstat: string): FileChange[] {
  const files: FileChange[] = []
  const ns = nameStatus.split('\0')
  for (let i = 0; i < ns.length; i++) {
    const code = ns[i]
    if (!code) continue
    const letter = code[0]
    if (letter === 'R' || letter === 'C') {
      files.push({
        status: letter,
        oldPath: ns[i + 1],
        path: ns[i + 2],
        additions: null,
        deletions: null
      })
      i += 2
    } else {
      files.push({ status: letter, path: ns[i + 1], additions: null, deletions: null })
      i += 1
    }
  }
  const counts = new Map<string, [number | null, number | null]>()
  const nt = numstat.split('\0')
  for (let i = 0; i < nt.length; i++) {
    const rec = nt[i]
    if (!rec) continue
    const [a, d, path] = rec.split('\t')
    const add = a === '-' ? null : Number(a)
    const del = d === '-' ? null : Number(d)
    if (path === '' || path === undefined) {
      // rename: "a\td\t\0old\0new"
      const newPath = nt[i + 2]
      counts.set(newPath, [add, del])
      i += 2
    } else {
      counts.set(path, [add, del])
    }
  }
  for (const f of files) {
    const c = counts.get(f.path)
    if (c) [f.additions, f.deletions] = c
  }
  return files
}

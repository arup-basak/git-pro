import type { LogQuery } from '../../shared/api'
import type {
  BranchInfo,
  CommitDetail,
  CommitSummary,
  RefsSnapshot,
  RemoteBranchInfo,
  RemoteInfo,
  TagInfo
} from '../../shared/types'
import {
  FS,
  LOG_FORMAT,
  RS,
  parseFileChanges,
  parseLog,
  parseRawCommit,
  type RawCommit
} from './parse'
import { git, gitOut } from './runner'
import { assertSafe, currentBranch, emptyTree, tryResolve } from './util'

const LOG_BASE = [
  'log',
  `--format=${LOG_FORMAT}`,
  '--date=raw',
  '--decorate=full',
  '--decorate-refs-exclude=refs/git-pro/',
  '--decorate-refs-exclude=refs/stash'
]

export async function listLog(cwd: string, q: LogQuery): Promise<CommitSummary[]> {
  const limit = Math.max(1, Math.min(q.limit, 5000))
  const search = q.search?.trim()
  if (search && q.searchMode === 'sha') {
    if (!/^[0-9a-fA-F]{4,64}$/.test(search)) return []
    const sha = await tryResolve(cwd, `${search}^{commit}`)
    if (!sha) return []
    const r = await git(cwd, [...LOG_BASE, '-1', sha], { quietStdout: true })
    return parseLog(r.stdout)
  }
  const args = [...LOG_BASE, '--topo-order', `-n${limit}`]
  if (q.skip) args.push(`--skip=${q.skip}`)
  if (search) {
    args.push('--regexp-ignore-case', '--fixed-strings')
    args.push(q.searchMode === 'author' ? `--author=${search}` : `--grep=${search}`)
  }
  if (q.ref) {
    assertSafe(q.ref, 'ref')
    args.push(q.ref)
  } else {
    args.push('--branches', '--remotes', '--tags')
    if (await tryResolve(cwd, 'HEAD')) args.push('HEAD')
  }
  args.push('--')
  const r = await git(cwd, args, { allowFail: true, quietStdout: true })
  if (r.code !== 0) {
    // An empty repository (no commits yet) is not an error for the UI.
    if (!(await tryResolve(cwd, 'HEAD'))) return []
    throw new Error(r.stderr.trim() || 'git log failed')
  }
  return parseLog(r.stdout)
}

/** Reads many commit objects in a single `git cat-file --batch` call. */
export async function readRawCommits(cwd: string, shas: string[]): Promise<Map<string, RawCommit>> {
  const out = new Map<string, RawCommit>()
  if (shas.length === 0) return out
  const r = await git(cwd, ['cat-file', '--batch'], {
    input: shas.join('\n') + '\n',
    quietStdout: true
  })
  const buf = r.stdoutBuf
  let pos = 0
  while (pos < buf.length) {
    const nl = buf.indexOf(0x0a, pos)
    if (nl === -1) break
    const header = buf.subarray(pos, nl).toString('utf8')
    const [sha, type, sizeStr] = header.split(' ')
    if (type === 'missing' || !sizeStr) throw new Error(`Object ${sha} is missing`)
    const size = Number(sizeStr)
    const body = buf.subarray(nl + 1, nl + 1 + size)
    if (type !== 'commit') throw new Error(`${sha} is a ${type}, not a commit`)
    out.set(sha, parseRawCommit(body))
    pos = nl + 1 + size + 1 // trailing LF after each object
  }
  return out
}

export async function commitDetail(cwd: string, rev: string): Promise<CommitDetail> {
  assertSafe(rev, 'revision')
  const r = await git(cwd, [...LOG_BASE, '-1', `${rev}^{commit}`, '--'], { quietStdout: true })
  const [summary] = parseLog(r.stdout)
  if (!summary) throw new Error(`Commit ${rev} not found`)
  const raw = (await readRawCommits(cwd, [summary.sha])).get(summary.sha)!
  const base = summary.parents[0] ?? (await emptyTree(cwd))
  const [nameStatus, numstat] = await Promise.all([
    gitOut(cwd, ['diff', '--name-status', '-z', '-M', base, summary.sha, '--']),
    gitOut(cwd, ['diff', '--numstat', '-z', '-M', base, summary.sha, '--'])
  ])
  return {
    ...summary,
    message: raw.message.toString('utf8'),
    tree: raw.tree,
    signed: raw.signed,
    files: parseFileChanges(nameStatus, numstat)
  }
}

/** Unified diff of a commit against its first parent (or the empty tree for a root commit). */
export async function commitDiff(cwd: string, rev: string, paths?: string[]): Promise<string> {
  assertSafe(rev, 'revision')
  const sha = await gitOut(cwd, ['rev-parse', '--verify', `${rev}^{commit}`])
  const parents = (await gitOut(cwd, ['rev-list', '--parents', '-n1', sha])).split(' ').slice(1)
  const base = parents[0] ?? (await emptyTree(cwd))
  const args = ['diff', '-M', '--patch', base, sha, '--']
  if (paths?.length) args.push(...paths)
  return (await git(cwd, args, { quietStdout: true })).stdout
}

const REF_FORMAT = [
  '%(refname)',
  '%(objectname)',
  '%(upstream:short)',
  '%(upstream:track)',
  '%(contents:subject)',
  '%(committerdate:unix)',
  '%(*objectname)',
  '%(objecttype)'
]
  .join('%1f')
  .concat('%1e')

export async function listRemotes(cwd: string): Promise<RemoteInfo[]> {
  const out = await gitOut(cwd, ['remote', '-v'])
  const map = new Map<string, RemoteInfo>()
  for (const line of out.split('\n')) {
    const m = /^(\S+)\t(.+) \((fetch|push)\)$/.exec(line)
    if (!m) continue
    const r = map.get(m[1]) ?? { name: m[1], fetchUrl: '', pushUrl: '' }
    if (m[3] === 'fetch') r.fetchUrl = m[2]
    else r.pushUrl = m[2]
    map.set(m[1], r)
  }
  return [...map.values()]
}

export async function refsSnapshot(cwd: string): Promise<RefsSnapshot> {
  const [refsOut, head, branch, remotes] = await Promise.all([
    gitOut(cwd, [
      'for-each-ref',
      `--format=${REF_FORMAT}`,
      '--sort=-committerdate',
      'refs/heads',
      'refs/remotes',
      'refs/tags'
    ]),
    tryResolve(cwd, 'HEAD'),
    currentBranch(cwd),
    listRemotes(cwd)
  ])
  const remoteNames = remotes.map((r) => r.name).sort((a, b) => b.length - a.length)
  const branches: BranchInfo[] = []
  const remoteBranches: RemoteBranchInfo[] = []
  const tags: TagInfo[] = []
  for (const rec of refsOut.split(RS)) {
    const r = rec.replace(/^\n/, '')
    if (!r) continue
    const [ref, sha, upstream, track, subject, date, peeled, type] = r.split(FS)
    if (ref.startsWith('refs/heads/')) {
      const name = ref.slice(11)
      const ahead = /ahead (\d+)/.exec(track)
      const behind = /behind (\d+)/.exec(track)
      branches.push({
        name,
        sha,
        upstream: upstream || undefined,
        ahead: ahead ? +ahead[1] : upstream ? 0 : undefined,
        behind: behind ? +behind[1] : upstream ? 0 : undefined,
        gone: track.includes('gone'),
        current: name === branch,
        subject,
        date: Number(date) || 0
      })
    } else if (ref.startsWith('refs/remotes/')) {
      const short = ref.slice(13)
      if (short.endsWith('/HEAD')) continue
      const remote = remoteNames.find((n) => short.startsWith(n + '/')) ?? short.split('/')[0]
      remoteBranches.push({
        remote,
        name: short.slice(remote.length + 1),
        short,
        sha,
        subject,
        date: Number(date) || 0
      })
    } else if (ref.startsWith('refs/tags/')) {
      const annotated = type === 'tag'
      tags.push({
        name: ref.slice(10),
        sha: annotated && peeled ? peeled : sha,
        annotated,
        subject: annotated ? subject : ''
      })
    }
  }
  branches.sort((a, b) => (a.current ? -1 : b.current ? 1 : a.name.localeCompare(b.name)))
  remoteBranches.sort((a, b) => a.short.localeCompare(b.short))
  tags.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))
  return { head, currentBranch: branch, branches, remoteBranches, tags, remotes }
}

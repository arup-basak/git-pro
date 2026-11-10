import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bisectMark, bisectReset, bisectStart, bisectState } from '../src/main/git/bisect'
import { blameFile } from '../src/main/git/blame'
import { addIgnore } from '../src/main/git/ignore'
import { listLog } from '../src/main/git/log'
import { getSigning, setSigning } from '../src/main/git/signing'
import { addWorktree, listWorktrees, removeWorktree, worktreePath } from '../src/main/git/worktrees'
import { makeRepo, type TestRepo } from './helpers/tmpRepo'

let repo: TestRepo
const extra: string[] = []
afterEach(() => {
  repo?.cleanup()
  for (const d of extra.splice(0)) rmSync(d, { recursive: true, force: true })
})

const write = (f: string, c: string): void => writeFileSync(join(repo.dir, f), c)

describe('blame', () => {
  it('attributes each line to the commit that last changed it', async () => {
    repo = await makeRepo()
    const first = await repo.commit('f.txt', 'one\ntwo\nthree\n', 'first')
    const second = await repo.commit('f.txt', 'one\nTWO\nthree\nfour\n', 'second')
    const b = await blameFile(repo.dir, 'f.txt', null)
    expect(b.lines).toEqual(['one', 'TWO', 'three', 'four'])
    expect(b.hunks.map((h) => [h.start, h.count, h.sha])).toEqual([
      [0, 1, first],
      [1, 1, second],
      [2, 1, first],
      [3, 1, second]
    ])
    expect(b.commits[second]).toMatchObject({ summary: 'second', author: 'Test User' })
    expect(b.commits[second].previous).toEqual({ sha: first, path: 'f.txt' })

    const old = await blameFile(repo.dir, 'f.txt', first)
    expect(old.lines).toEqual(['one', 'two', 'three'])
    expect(old.hunks).toHaveLength(1)
  })

  it('marks uncommitted lines', async () => {
    repo = await makeRepo()
    await repo.commit('f.txt', 'a\n', 'first')
    write('f.txt', 'a\nnew\n')
    const b = await blameFile(repo.dir, 'f.txt', null)
    expect(b.hunks[1].sha).toMatch(/^0+$/)
    expect(b.commits[b.hunks[1].sha].author).toBe('Not Committed Yet')
  })
})

describe('file history', () => {
  it('lists only the commits touching a file, across a rename', async () => {
    repo = await makeRepo()
    await repo.commit('a.txt', 'a\n', 'add a')
    await repo.commit('other.txt', 'x\n', 'unrelated')
    await repo.commit('a.txt', 'a\nmore\n', 'edit a')
    await repo.git(['mv', 'a.txt', 'b.txt'])
    await repo.git(['commit', '-q', '-m', 'rename to b'])
    const plain = await listLog(repo.dir, { limit: 50, path: 'b.txt' })
    expect(plain.map((c) => c.subject)).toEqual(['rename to b'])
    const followed = await listLog(repo.dir, { limit: 50, path: 'b.txt', follow: true })
    expect(followed.map((c) => c.subject)).toEqual(['rename to b', 'edit a', 'add a'])
  })
})

describe('bisect', () => {
  it('finds the first bad commit', async () => {
    repo = await makeRepo()
    const shas: string[] = []
    for (let i = 1; i <= 8; i++) {
      shas.push(await repo.commit('n.txt', `${i >= 5 ? 'broken' : 'ok'} ${i}\n`, `step ${i}`))
    }
    let s = await bisectStart(repo.dir, shas[7], shas[0])
    expect(s).toMatchObject({ active: true, bad: shas[7], good: [shas[0]] })
    expect(s.remaining).toBeGreaterThan(0)
    for (let i = 0; i < 10 && !s.firstBad; i++) {
      const content = readFileSync(join(repo.dir, 'n.txt'), 'utf8')
      s = await bisectMark(repo.dir, content.startsWith('broken') ? 'bad' : 'good')
    }
    expect(s.firstBad).toEqual({ sha: shas[4], subject: 'step 5' })
    await bisectReset(repo.dir)
    expect((await bisectState(repo.dir)).active).toBe(false)
    expect(await repo.git(['symbolic-ref', '--short', 'HEAD'])).toBe('main')
  })

  it('refuses a dirty working tree', async () => {
    repo = await makeRepo()
    const a = await repo.commit('n.txt', '1\n', 'one')
    const b = await repo.commit('n.txt', '2\n', 'two')
    write('n.txt', 'dirty\n')
    await expect(bisectStart(repo.dir, b, a)).rejects.toThrow(/commit or stash/)
  })
})

describe('worktrees', () => {
  it('adds, lists and removes linked worktrees', async () => {
    repo = await makeRepo()
    await repo.commit('a.txt', 'a\n', 'first')
    await repo.git(['branch', 'feature'])
    const parent = realpathSync(mkdtempSync(join(tmpdir(), 'gitpro-wt-')))
    extra.push(parent)
    const path = worktreePath(parent, repo.dir, 'feature/x')
    expect(path).toMatch(/-feature-x$/)

    const w = await addWorktree(repo.dir, path, { branch: 'feature', create: false })
    expect(w).toMatchObject({ branch: 'feature', current: false, main: false })
    const fresh = await addWorktree(repo.dir, worktreePath(parent, repo.dir, 'new'), {
      branch: 'new',
      create: true,
      startPoint: 'main'
    })
    expect(fresh.branch).toBe('new')

    const list = await listWorktrees(repo.dir)
    expect(list.map((x) => x.branch)).toEqual(['main', 'feature', 'new'])
    expect(list[0]).toMatchObject({ main: true, current: true })

    await expect(removeWorktree(repo.dir, list[0].path, false)).rejects.toThrow(/main worktree/)
    await removeWorktree(repo.dir, w.path, false)
    expect(existsSync(w.path)).toBe(false)
    expect((await listWorktrees(repo.dir)).map((x) => x.branch)).toEqual(['main', 'new'])
  })
})

describe('ignore', () => {
  it('appends a pattern once and can stop tracking a file', async () => {
    repo = await makeRepo()
    await repo.commit('build/out.js', 'x\n', 'oops, committed build output')
    write('.gitignore', 'node_modules')
    const r = await addIgnore(repo.dir, {
      pattern: 'build/',
      target: 'gitignore',
      untrack: ['build']
    })
    expect(r.added).toBe(true)
    expect(readFileSync(join(repo.dir, '.gitignore'), 'utf8')).toBe('node_modules\nbuild/\n')
    expect(await repo.git(['ls-files', 'build'])).toBe('')
    expect(existsSync(join(repo.dir, 'build/out.js'))).toBe(true)

    const again = await addIgnore(repo.dir, { pattern: 'build/', target: 'gitignore', untrack: [] })
    expect(again.added).toBe(false)

    await addIgnore(repo.dir, { pattern: '*.log', target: 'exclude', untrack: [] })
    expect(readFileSync(join(repo.dir, '.git/info/exclude'), 'utf8')).toContain('*.log\n')
    await expect(
      addIgnore(repo.dir, { pattern: 'a\nb', target: 'gitignore', untrack: [] })
    ).rejects.toThrow(/single line/)
  })
})

describe('signing config', () => {
  it('reads and writes the repository signing setup', async () => {
    repo = await makeRepo()
    await repo.commit('a.txt', 'a\n', 'first')
    expect(await getSigning(repo.dir)).toMatchObject({
      format: 'openpgp',
      key: '',
      signCommits: false,
      signTags: false
    })
    await setSigning(repo.dir, 'local', {
      format: 'ssh',
      key: '/home/me/.ssh/id_ed25519.pub',
      signCommits: true,
      signTags: false,
      keyScope: null
    })
    expect(await getSigning(repo.dir)).toEqual({
      format: 'ssh',
      key: '/home/me/.ssh/id_ed25519.pub',
      signCommits: true,
      signTags: false,
      keyScope: 'local'
    })
  })
})

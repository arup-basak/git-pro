import { existsSync, realpathSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { WorktreeAddRequest, WorktreeInfo } from '../../shared/types'
import { git, gitOut } from './runner'
import { assertBranchName, refExists, resolveCommit } from './util'

function real(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/** Every worktree of the repository (`git worktree list --porcelain`). */
export async function listWorktrees(cwd: string): Promise<WorktreeInfo[]> {
  const out = await gitOut(cwd, ['worktree', 'list', '--porcelain'])
  const here = real(cwd)
  const list: WorktreeInfo[] = []
  for (const block of out.split('\n\n')) {
    const lines = block.split('\n').filter(Boolean)
    const path = lines.find((l) => l.startsWith('worktree '))?.slice(9)
    if (!path) continue
    const head = lines.find((l) => l.startsWith('HEAD '))?.slice(5) ?? null
    const branch = lines.find((l) => l.startsWith('branch '))?.slice(7) ?? null
    list.push({
      path,
      head,
      branch: branch?.replace(/^refs\/heads\//, '') ?? null,
      detached: lines.includes('detached'),
      bare: lines.includes('bare'),
      locked: lines.some((l) => l === 'locked' || l.startsWith('locked ')),
      prunable: lines.some((l) => l === 'prunable' || l.startsWith('prunable ')),
      current: real(path) === here,
      main: list.length === 0
    })
  }
  return list
}

/** A free folder name for a new worktree next to the repository: `<repo>-<branch>`. */
export function worktreePath(parent: string, repoTop: string, branch: string): string {
  const slug = branch.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'worktree'
  const base = join(parent, `${basename(repoTop)}-${slug}`)
  let path = base
  for (let n = 2; existsSync(path); n++) path = `${base}-${n}`
  return path
}

/** Creates a worktree at `path` with `branch` checked out (created first if asked). */
export async function addWorktree(
  cwd: string,
  path: string,
  req: WorktreeAddRequest
): Promise<WorktreeInfo> {
  await assertBranchName(cwd, req.branch)
  if (existsSync(path)) throw new Error(`${path} already exists`)
  const args = ['worktree', 'add']
  if (req.create) {
    if (await refExists(cwd, `refs/heads/${req.branch}`)) {
      throw new Error(`Branch "${req.branch}" already exists`)
    }
    const start = await resolveCommit(cwd, req.startPoint || 'HEAD')
    args.push('-b', req.branch, path, start)
  } else {
    if (!(await refExists(cwd, `refs/heads/${req.branch}`))) {
      throw new Error(`There is no branch "${req.branch}"`)
    }
    args.push(path, req.branch)
  }
  const r = await git(cwd, args, { write: true, allowFail: true })
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'git worktree add failed')
  const added = (await listWorktrees(cwd)).find((w) => real(w.path) === real(path))
  if (!added) throw new Error('The worktree was created but is not listed')
  return added
}

/** Checks that `path` is one of this repository's worktrees, and returns it. */
export async function findWorktree(cwd: string, path: string): Promise<WorktreeInfo> {
  const hit = (await listWorktrees(cwd)).find((w) => real(w.path) === real(path))
  if (!hit) throw new Error(`${path} is not a worktree of this repository`)
  return hit
}

export async function removeWorktree(cwd: string, path: string, force: boolean): Promise<void> {
  const w = await findWorktree(cwd, path)
  if (w.main) throw new Error('The main worktree cannot be removed')
  if (w.current) throw new Error('This worktree is open here; open another one first')
  const r = await git(cwd, ['worktree', 'remove', ...(force ? ['--force'] : []), w.path], {
    write: true,
    allowFail: true
  })
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'git worktree remove failed')
}

export async function pruneWorktrees(cwd: string): Promise<void> {
  await git(cwd, ['worktree', 'prune'], { write: true })
}

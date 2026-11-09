import { watch, type FSWatcher } from 'node:fs'
import { relative, sep } from 'node:path'

type Scope = 'refs' | 'worktree'

/**
 * Watches a repository and reports debounced changes:
 *  - "refs": HEAD, refs, packed-refs, sequencer state (the graph/branches must be reloaded)
 *  - "worktree": files or the index changed (only status needs reloading)
 */
export class RepoWatcher {
  private watchers: FSWatcher[] = []
  private timers = new Map<Scope, NodeJS.Timeout>()

  constructor(
    private readonly worktree: string,
    private readonly gitDir: string,
    private readonly onChange: (scope: Scope) => void
  ) {}

  start(): void {
    const roots = [this.worktree]
    if (relative(this.worktree, this.gitDir).startsWith('..')) roots.push(this.gitDir)
    for (const root of roots) {
      try {
        const w = watch(root, { recursive: true }, (_event, filename) => {
          if (!filename) return
          this.classify(root, filename.toString())
        })
        w.on('error', () => undefined)
        this.watchers.push(w)
      } catch {
        // recursive watch not available; the UI also refreshes on focus
      }
    }
  }

  private classify(root: string, filename: string): void {
    const abs = root + sep + filename
    const inGit = relative(this.gitDir, abs)
    if (!inGit.startsWith('..')) {
      const p = inGit.split(sep).join('/')
      if (
        p.endsWith('.lock') ||
        p.startsWith('objects/') ||
        p.startsWith('git-pro/') ||
        p.startsWith('logs/')
      )
        return
      if (p === 'index') return this.fire('worktree')
      return this.fire('refs')
    }
    if (filename.split(sep).includes('node_modules')) return
    this.fire('worktree')
  }

  private fire(scope: Scope): void {
    const t = this.timers.get(scope)
    if (t) clearTimeout(t)
    this.timers.set(
      scope,
      setTimeout(() => {
        this.timers.delete(scope)
        this.onChange(scope)
      }, 250)
    )
  }

  stop(): void {
    for (const w of this.watchers) w.close()
    this.watchers = []
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
  }
}

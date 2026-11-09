import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { configureGit, gitOut } from '../../src/main/git/runner'

// Isolate tests from the developer's global/system git config (signing, hooks, templates …).
const home = mkdtempSync(join(tmpdir(), 'gitpro-home-'))
const globalConfig = join(home, 'gitconfig')
writeFileSync(
  globalConfig,
  [
    '[user]',
    '  name = Test User',
    '  email = test@example.com',
    '[init]',
    '  defaultBranch = main',
    '[commit]',
    '  gpgsign = false',
    '[advice]',
    '  detachedHead = false'
  ].join('\n') + '\n'
)
configureGit({
  env: {
    ...process.env,
    HOME: home,
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: '1'
  }
})

export interface TestRepo {
  dir: string
  git(args: string[], env?: Record<string, string>): Promise<string>
  /** Writes a file and commits it with a fixed date (seconds since epoch, default tz +0000). */
  commit(file: string, content: string, message: string, ts?: number, tz?: string): Promise<string>
  cleanup(): void
}

let clock = 1_700_000_000

export async function makeRepo(opts: { bare?: boolean } = {}): Promise<TestRepo> {
  const dir = mkdtempSync(join(tmpdir(), 'gitpro-repo-'))
  const run = (args: string[], env?: Record<string, string>): Promise<string> =>
    gitOut(dir, args, { env })
  await run(opts.bare ? ['init', '--bare', '-q'] : ['init', '-q'])
  return {
    dir,
    git: run,
    async commit(file, content, message, ts, tz = '+0000') {
      const when = ts ?? (clock += 3600)
      const p = join(dir, file)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, content)
      await run(['add', '--', file])
      await run(['commit', '-q', '-m', message], {
        GIT_AUTHOR_DATE: `@${when} ${tz}`,
        GIT_COMMITTER_DATE: `@${when} ${tz}`
      })
      return run(['rev-parse', 'HEAD'])
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

/** "<author date> | <committer date> | <subject>" lines, newest first, raw dates. */
export async function datesOf(repo: TestRepo, rev: string): Promise<string[]> {
  const out = await repo.git(['log', '--format=%ad|%cd|%s', '--date=raw', rev])
  return out.split('\n')
}

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const root = resolve(__dirname, '../..')
const shots = process.env.GITPRO_SHOTS

const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'gitpro-e2e-')))
const home = join(tmp, 'home')
const repoDir = join(tmp, 'demo-repo')
const remoteDir = join(tmp, 'remote.git')
mkdirSync(home)
writeFileSync(
  join(home, 'gitconfig'),
  '[user]\n  name = E2E User\n  email = e2e@example.com\n[init]\n  defaultBranch = main\n[commit]\n  gpgsign = false\n'
)
const gitEnv = {
  ...process.env,
  HOME: home,
  GIT_CONFIG_GLOBAL: join(home, 'gitconfig'),
  GIT_CONFIG_NOSYSTEM: '1'
}
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8' }).trim()

function commit(file: string, content: string, msg: string, ts: number): void {
  writeFileSync(join(repoDir, file), content)
  git(repoDir, 'add', file)
  execFileSync('git', ['commit', '-q', '-m', msg], {
    cwd: repoDir,
    env: { ...gitEnv, GIT_AUTHOR_DATE: `@${ts} +0000`, GIT_COMMITTER_DATE: `@${ts} +0000` }
  })
}

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  mkdirSync(repoDir)
  git(repoDir, 'init', '-q')
  commit('a.txt', 'alpha\n', 'first commit', 1_700_000_000)
  commit('b.txt', 'bravo\n', 'second commit', 1_700_003_600)
  commit('c.txt', 'one\ntwo\nthree\n', 'third commit', 1_700_007_200)
  commit('d.txt', 'delta\n', 'fourth commit', 1_700_010_800)
  git(tmp, 'init', '-q', '--bare', remoteDir)
  git(repoDir, 'remote', 'add', 'origin', remoteDir)

  app = await electron.launch({
    args: ['.'],
    cwd: root,
    env: { ...gitEnv, GITPRO_USER_DATA: join(tmp, 'userdata'), GITPRO_SEED_REPO: repoDir }
  })
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1480, height: 900 })
})

test.afterAll(async () => {
  await app?.close()
})

const shot = async (name: string): Promise<void> => {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) })
}

test('opens a repository and shows the commit graph', async () => {
  await page.getByText(basename(repoDir), { exact: true }).click()
  await expect(page.getByText('fourth commit').first()).toBeVisible()
  await expect(page.getByText('first commit').first()).toBeVisible()
  await page.getByText('third commit').first().click()
  await expect(page.getByText('c.txt').first()).toBeVisible()
  await shot('01-graph')
})

test('retimes a commit into a new branch and pushes it to a separate remote branch', async () => {
  await page.getByText('second commit').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Edit date / author / message…' }).click()
  const sha = git(repoDir, 'rev-parse', 'HEAD~2')
  const row = page.locator(`#hrow-${sha}`)
  await expect(row).toBeVisible()
  await page.getByText('Shift later commits with date edits').click() // turn cascading off
  const dates = row.locator('input[data-date]')
  await dates.nth(0).fill('2021-05-04 10:20:30')
  await dates.nth(0).press('Enter')
  await dates.nth(1).fill('2021-05-04 11:00:00')
  await dates.nth(1).press('Enter')
  await expect(dates.nth(0)).toHaveValue('2021-05-04 10:20:30')
  await expect(page.getByText('1 commit edited — metadata only, conflict-free')).toBeVisible()
  await page.locator('input.mono[value^="main-edited-"]').fill('main-retimed')
  await shot('02-history-editor')
  await page.getByRole('button', { name: 'Create branch', exact: true }).click()

  const result = page.getByRole('dialog')
  await expect(result.getByText('Rewrote 3 commits on main-retimed')).toBeVisible()
  await shot('03-rewrite-result')
  await result.getByRole('button', { name: 'Push main-retimed…' }).click()
  const push = page.getByRole('dialog')
  await expect(push.getByText('Will create origin/main-retimed')).toBeVisible()
  await shot('04-push-dialog')
  await push.getByRole('button', { name: 'Push', exact: true }).click()
  await expect(page.getByText('Pushed to origin/main-retimed')).toBeVisible()
  await push.getByRole('button', { name: 'Close' }).click()

  expect(git(remoteDir, 'log', '--format=%ad|%cd|%s', '--date=raw', 'main-retimed')).toBe(
    [
      '1700010800 +0000|1700010800 +0000|fourth commit',
      '1700007200 +0000|1700007200 +0000|third commit',
      '1620123630 +0000|1620126000 +0000|second commit',
      '1700000000 +0000|1700000000 +0000|first commit'
    ].join('\n')
  )
  expect(git(repoDir, 'diff', 'main', 'main-retimed')).toBe('')
  expect(git(repoDir, 'rev-parse', 'main~1')).not.toBe(git(repoDir, 'rev-parse', 'main-retimed~1'))
})

test('stashes into a named app stash, previews and applies it', async () => {
  writeFileSync(join(repoDir, 'a.txt'), 'alpha edited\n')
  writeFileSync(join(repoDir, 'notes.md'), 'scratch\n')
  await page.getByRole('button', { name: 'Stash', exact: true }).click()
  const dlg = page.getByRole('dialog')
  await dlg.locator('input[data-autofocus]').fill('e2e stash')
  await dlg.locator('input[list="stash-groups"]').fill('experiments')
  await dlg.getByRole('button', { name: /^Stash 2 files/ }).click()
  await expect(page.getByText('Stashed “e2e stash”')).toBeVisible()
  expect(git(repoDir, 'status', '--porcelain')).toBe('')
  expect(git(repoDir, 'stash', 'list')).toBe('')

  await page.locator('aside').getByText('Stashes', { exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'e2e stash' })).toBeVisible()
  await shot('05-stashes')
  await page.getByRole('button', { name: 'Preview apply' }).click()
  await expect(page.getByText('Applies cleanly')).toBeVisible()
  await shot('06-stash-preview')
  await page.getByRole('button', { name: 'Apply & remove' }).click()
  await expect(page.getByText('Applied and removed “e2e stash”')).toBeVisible()
  expect(readFileSync(join(repoDir, 'a.txt'), 'utf8')).toBe('alpha edited\n')
  expect(readFileSync(join(repoDir, 'notes.md'), 'utf8')).toBe('scratch\n')
  expect(git(repoDir, 'for-each-ref', 'refs/git-pro/stashes')).toBe('')
  expect(git(repoDir, 'for-each-ref', '--format=%(refname)', 'refs/git-pro/stash-trash')).toMatch(
    /^refs\/git-pro\/stash-trash\//
  )
  git(repoDir, 'checkout', '--', 'a.txt')
  git(repoDir, 'clean', '-fq')
})

test('previews a conflicting stash and resolves it in the merge editor', async () => {
  writeFileSync(join(repoDir, 'c.txt'), 'one\nSTASHED\nthree\n')
  await page.getByRole('button', { name: 'Stash', exact: true }).click()
  const dlg = page.getByRole('dialog')
  await dlg.locator('input[data-autofocus]').fill('conflicting work')
  await dlg.getByRole('button', { name: /^Stash 1 file/ }).click()
  await expect(page.getByText('Stashed “conflicting work”')).toBeVisible()
  commit('c.txt', 'one\nCOMMITTED\nthree\n', 'conflicting commit', 1_700_020_000)

  await page.getByRole('heading', { name: 'conflicting work' }).waitFor()
  await page.getByRole('button', { name: 'Preview apply' }).click()
  await expect(page.getByText('1 conflict').first()).toBeVisible()
  await page.getByRole('button', { name: 'Preview merge' }).click()
  await expect(page.getByText('Preview only — nothing has been applied yet.')).toBeVisible()
  await expect(page.getByText('Conflict 1/1')).toBeVisible()
  await shot('07-merge-preview')
  expect(readFileSync(join(repoDir, 'c.txt'), 'utf8')).toBe('one\nCOMMITTED\nthree\n')
  await page.getByTitle('Close').first().click()

  await page.getByRole('button', { name: 'Apply', exact: true }).first().click()
  await expect(
    page.getByText('Resolving conflict').or(page.getByText('Stash apply · conflicting work'))
  ).toBeVisible()
  await page.getByRole('button', { name: 'Both' }).click()
  await shot('08-merge-live')
  await page.getByRole('button', { name: 'Save & mark resolved' }).click()
  await expect(page.getByText('Resolved c.txt')).toBeVisible()
  expect(readFileSync(join(repoDir, 'c.txt'), 'utf8')).toBe('one\nCOMMITTED\nSTASHED\nthree\n')
  expect(git(repoDir, 'diff', '--name-only', '--diff-filter=U')).toBe('')
})

test('highlights syntax and changed words in diffs, and can be switched off', async () => {
  writeFileSync(join(repoDir, 'hello.ts'), 'export const greeting: string = "hi"\n// a comment\n')
  writeFileSync(join(repoDir, 'd.txt'), 'delta prime\n')
  await page.locator('aside').getByText('Changes', { exact: true }).first().click()

  await page.getByText('hello.ts').first().click()
  await expect(page.getByText('typescript', { exact: true })).toBeVisible()
  const colored = page.locator('main td span[style*="color"]')
  await expect(colored.first()).toBeVisible()
  expect(await colored.count()).toBeGreaterThan(3)
  await shot('09-highlighted-diff')

  await page.getByText('d.txt').first().click()
  await expect(page.locator('main span[class*="bg-ok/30"]', { hasText: 'prime' })).toBeVisible()

  await page.getByText('hello.ts').first().click()
  await page.getByRole('button', { name: 'View' }).click()
  await expect(page.getByText('Code display')).toBeVisible()
  await shot('10-view-settings')
  await page.getByText('Syntax highlighting', { exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('main td span[style*="color"]')).toHaveCount(0)
  // Restore the (persisted) setting for the following tests.
  await page.getByRole('button', { name: 'View' }).click()
  await page.getByText('Syntax highlighting', { exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('main td span[style*="color"]').first()).toBeVisible()
})

test('resolves a TypeScript conflict with the highlighted merge editor', async () => {
  git(repoDir, 'add', '-A')
  git(repoDir, 'commit', '-q', '-m', 'checkpoint')
  writeFileSync(
    join(repoDir, 'hello.ts'),
    'export const greeting: string = "stashed"\n// a comment\n'
  )
  git(repoDir, 'stash', 'push', '-q', '-m', 'ts work')
  commit(
    'hello.ts',
    'export const greeting: string = "committed"\n// a comment\n',
    'ts change',
    1_700_030_000
  )

  await page.locator('aside').getByText('Stashes', { exact: true }).first().click()
  await page.getByText('ts work').first().click()
  await page.getByRole('button', { name: 'Apply', exact: true }).first().click()
  await expect(page.getByText('Conflict 1/1')).toBeVisible()
  // Both sides of the conflict are syntax highlighted.
  expect(
    await page.locator('main span[style*="color"]', { hasText: 'export' }).count()
  ).toBeGreaterThanOrEqual(2)

  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  const editor = page.locator('main textarea')
  await expect(editor).toBeVisible()
  await editor.fill('export const greeting: string = "merged by hand"\n')
  await expect(
    page.locator('main pre span[style*="color"]', { hasText: 'merged by hand' })
  ).toBeVisible()
  await shot('11-merge-edit-highlighted')
  await page.getByRole('button', { name: 'Save & mark resolved' }).click()
  await expect(page.getByText('Resolved hello.ts')).toBeVisible()
  expect(readFileSync(join(repoDir, 'hello.ts'), 'utf8')).toBe(
    'export const greeting: string = "merged by hand"\n// a comment\n'
  )
})

test('shows diffs side by side when switched on in View', async () => {
  writeFileSync(join(repoDir, 'd.txt'), 'delta second\nextra line\n')
  await page.locator('aside').getByText('Changes', { exact: true }).first().click()
  await page.getByText('d.txt').first().click()
  await expect(page.locator('main [data-diff-layout="unified"]')).toBeVisible()

  await page.getByRole('button', { name: 'View' }).click()
  await page.getByText('Side-by-side diffs', { exact: true }).click()
  await page.keyboard.press('Escape')
  const split = page.locator('main [data-diff-layout="split"]')
  await expect(split).toBeVisible()
  // The changed line sits next to its replacement: old text left, new text right.
  const row = split.locator('tr', { hasText: 'delta prime' })
  await expect(row).toContainText('delta second')
  await shot('12-side-by-side')

  // Back to unified for the following tests.
  await page.getByRole('button', { name: 'View' }).click()
  await page.getByText('Side-by-side diffs', { exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('main [data-diff-layout="unified"]')).toBeVisible()
})

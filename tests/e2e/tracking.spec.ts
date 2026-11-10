import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

/* Connecting local branches to remote branches: publish, track, stop tracking, create local. */

const root = resolve(__dirname, '../..')
const shots = process.env.GITPRO_SHOTS

const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'gitpro-e2e-tracking-')))
const home = join(tmp, 'home')
const repoDir = join(tmp, 'tracking-repo')
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
const upstream = (b: string): string =>
  git(repoDir, 'for-each-ref', '--format=%(upstream:short)', `refs/heads/${b}`)

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  mkdirSync(repoDir)
  git(repoDir, 'init', '-q')
  writeFileSync(join(repoDir, 'a.txt'), 'a\n')
  git(repoDir, 'add', 'a.txt')
  git(repoDir, 'commit', '-q', '-m', 'first commit')
  git(tmp, 'init', '-q', '--bare', remoteDir)
  git(repoDir, 'remote', 'add', 'origin', remoteDir)
  git(repoDir, 'push', '-q', '-u', 'origin', 'main')
  // unpublished: only here.
  git(repoDir, 'branch', 'local-only')
  // unlinked: same name on the remote, not tracked.
  git(repoDir, 'branch', 'linkme')
  git(repoDir, 'push', '-q', 'origin', 'linkme')
  // gone: tracked, then deleted on the remote and pruned.
  git(repoDir, 'branch', 'merged-pr')
  git(repoDir, 'push', '-q', '-u', 'origin', 'merged-pr')
  git(remoteDir, 'branch', '-D', 'merged-pr')
  git(repoDir, 'fetch', '-q', '--prune', 'origin')
  // remote-only: a teammate's branch.
  git(repoDir, 'push', '-q', 'origin', 'main:refs/heads/teammate')
  git(repoDir, 'fetch', '-q', 'origin')

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

const sidebarRow = (name: string): Locator =>
  page.locator('aside').locator('.group\\/row', { has: page.getByText(name, { exact: true }) })

test('marks branches that are not connected to a remote', async () => {
  await page.getByText(basename(repoDir), { exact: true }).click()
  await expect(page.getByText('first commit').first()).toBeVisible()
  const aside = page.locator('aside')
  // local-only, linkme and merged-pr need attention.
  await expect(aside.getByRole('button', { name: 'Branch tracking' })).toHaveText('3')
  await expect(sidebarRow('merged-pr').getByText('gone')).toBeVisible()
  await expect(sidebarRow('local-only').getByLabel('not published')).toBeVisible()
  await expect(sidebarRow('linkme').getByLabel('not tracking')).toBeVisible()
  await shot('tracking-01-sidebar')
})

test('publishes a local-only branch from the sidebar in one click', async () => {
  const row = sidebarRow('local-only')
  await row.hover()
  await row.getByRole('button', { name: 'Publish to origin/local-only and track it' }).click()
  await expect(page.getByText('Published local-only to origin/local-only')).toBeVisible()
  expect(upstream('local-only')).toBe('origin/local-only')
  expect(git(remoteDir, 'rev-parse', '--verify', 'refs/heads/local-only')).toMatch(/^[0-9a-f]{40}$/)
  await expect(page.locator('aside').getByRole('button', { name: 'Branch tracking' })).toHaveText(
    '2'
  )
})

test('fixes the rest in the Branch tracking dialog', async () => {
  await page.locator('aside').getByRole('button', { name: 'Branch tracking' }).click()
  const dlg = page.getByRole('dialog')
  await expect(dlg.getByText('On the remote, but not tracked')).toBeVisible()
  await expect(dlg.getByText('Upstream deleted on the remote')).toBeVisible()
  await expect(dlg.getByText('Only on the remote')).toBeVisible()
  await expect(dlg.getByText('same commit')).toBeVisible()
  await shot('tracking-02-dialog')

  await dlg.getByRole('button', { name: 'Track 1' }).click()
  await expect(dlg.getByText('On the remote, but not tracked')).toBeHidden()
  expect(upstream('linkme')).toBe('origin/linkme')

  await dlg.getByRole('button', { name: 'Stop tracking' }).click()
  await expect(dlg.getByText('Upstream deleted on the remote')).toBeHidden()
  expect(upstream('merged-pr')).toBe('')
  // merged-pr is now simply unpublished.
  await expect(dlg.getByText('Not on a remote')).toBeVisible()

  await dlg.getByLabel('Select all: Only on the remote').check()
  await dlg.getByRole('button', { name: 'Create 1 local branch' }).click()
  await expect(dlg.getByText('Only on the remote')).toBeHidden()
  expect(upstream('teammate')).toBe('origin/teammate')
  expect(git(repoDir, 'symbolic-ref', '--short', 'HEAD')).toBe('main')

  await dlg.getByRole('button', { name: 'Publish 1 to origin' }).click()
  await expect(dlg.getByText('Every local branch is connected to a remote branch.')).toBeVisible()
  expect(upstream('merged-pr')).toBe('origin/merged-pr')
  await shot('tracking-03-dialog-done')
  await dlg.getByRole('button', { name: 'Done' }).click()
})

test('offers Publish in the toolbar for a new checked-out branch', async () => {
  git(repoDir, 'switch', '-q', '-c', 'wip')
  await page.keyboard.press('Meta+r')
  const toolbar = page.locator('.titlebar')
  const publish = toolbar.getByRole('button', { name: 'Publish' })
  await expect(publish).toBeVisible()
  await shot('tracking-04-toolbar')
  await publish.click()
  await expect(page.getByText('Published wip to origin/wip')).toBeVisible()
  expect(upstream('wip')).toBe('origin/wip')
  await expect(publish).toBeHidden()
  await expect(toolbar.getByText('↑0 ↓0')).toBeVisible()
})

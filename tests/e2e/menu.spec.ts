import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '../..')
const shots = process.env.GITPRO_SHOTS
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'gitpro-menu-')))
const home = join(tmp, 'home')
const repoDir = join(tmp, 'menu-repo')
mkdirSync(home)
writeFileSync(
  join(home, 'gitconfig'),
  '[user]\n  name = Menu User\n  email = menu@example.com\n[init]\n  defaultBranch = main\n[commit]\n  gpgsign = false\n'
)
const gitEnv = {
  ...process.env,
  HOME: home,
  GIT_CONFIG_GLOBAL: join(home, 'gitconfig'),
  GIT_CONFIG_NOSYSTEM: '1'
}
const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: repoDir, env: gitEnv, encoding: 'utf8' }).trim()

let app: ElectronApplication
let page: Page

/** Reads a native menu item by id. */
const item = (id: string): Promise<{ enabled: boolean; checked: boolean; label: string } | null> =>
  app.evaluate(({ Menu }, id) => {
    const it = Menu.getApplicationMenu()?.getMenuItemById(id)
    return it ? { enabled: it.enabled, checked: it.checked, label: it.label } : null
  }, id)

/** Clicks a native menu item exactly as the menu bar would. */
const click = (id: string): Promise<void> =>
  app.evaluate(({ Menu, BrowserWindow }, id) => {
    const it = Menu.getApplicationMenu()?.getMenuItemById(id)
    if (!it) throw new Error(`menu item ${id} not found`)
    it.click(undefined, BrowserWindow.getAllWindows()[0], undefined)
  }, id)

test.beforeAll(async () => {
  mkdirSync(repoDir)
  git('init', '-q')
  writeFileSync(join(repoDir, 'a.txt'), 'a\n')
  git('add', 'a.txt')
  git('commit', '-q', '-m', 'first commit')
  writeFileSync(join(repoDir, 'b.txt'), 'b\n')
  git('add', 'b.txt')
  git('commit', '-q', '-m', 'second commit')
  git('branch', 'feature')
  git('remote', 'add', 'origin', join(tmp, 'nowhere.git'))
  app = await electron.launch({
    args: ['.'],
    cwd: root,
    env: { ...gitEnv, GITPRO_USER_DATA: join(tmp, 'userdata'), GITPRO_SEED_REPO: repoDir }
  })
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1400, height: 860 })
})

test.afterAll(async () => {
  await app?.close()
})

test('menu items are disabled until a repository is open', async () => {
  await expect.poll(() => item('repo.open')).toMatchObject({ enabled: true })
  expect(await item('remote.push')).toMatchObject({ enabled: false })
  expect(await item('commit.edit')).toMatchObject({ enabled: false })
  await expect.poll(async () => (await item(`repo.openRecent:${repoDir}`))?.enabled).toBe(true)
})

test('File → Open Recent opens the repository and updates the menu and title', async () => {
  await click(`repo.openRecent:${repoDir}`)
  await expect(page.getByText('second commit').first()).toBeVisible()
  await expect.poll(async () => (await item('remote.push'))?.enabled).toBe(true)
  expect(await item('view.graph')).toMatchObject({ checked: true })
  expect(await item('branch.checkout:main')).toMatchObject({ checked: true })
  expect(await item('branch.rename')).toMatchObject({ label: 'Rename “main”…' })
  expect(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())
  ).toBe('menu-repo — Git Pro')
})

test('View menu switches views and toggles settings', async () => {
  await click('view.stashes')
  await expect(page.getByPlaceholder('Filter stashes')).toBeVisible()
  await expect.poll(async () => (await item('view.stashes'))?.checked).toBe(true)
  await click('view.log')
  await expect(page.getByText('Command log')).toBeVisible()
  await click('view.log')
  await click('view.syntax')
  await expect.poll(async () => (await item('view.syntax'))?.checked).toBe(false)
  await click('view.syntax')
  await expect.poll(async () => (await item('view.syntax'))?.checked).toBe(true)
  await click('view.graph')
})

test('Commit menu acts on the selected commit', async () => {
  await page.getByText('first commit').first().click()
  await expect.poll(async () => (await item('commit.edit'))?.enabled).toBe(true)
  // The label gains the subject once the commit's details have loaded.
  await expect.poll(async () => (await item('commit.selected'))?.label).toContain('first commit')
  await click('commit.edit')
  const sha = git('rev-parse', 'HEAD~1')
  await expect(page.locator(`#hrow-${sha}`)).toBeVisible()
})

test('Changes menu stages and focuses the commit message', async () => {
  writeFileSync(join(repoDir, 'c.txt'), 'c\n')
  await expect.poll(async () => (await item('changes.stageAll'))?.enabled).toBe(true)
  await click('changes.stageAll')
  await expect.poll(() => git('status', '--porcelain')).toBe('A  c.txt')
  await click('changes.commit')
  await expect(page.locator('[data-commit-message]')).toBeFocused()
  await page.locator('[data-commit-message]').fill('third commit')
  await page.keyboard.press('Meta+Enter')
  await expect.poll(() => git('log', '-1', '--format=%s')).toBe('third commit')
})

test('Branch → Check Out switches branches', async () => {
  await click('branch.checkout:feature')
  await expect.poll(() => git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('feature')
  await expect.poll(async () => (await item('branch.checkout:feature'))?.checked).toBe(true)
})

test('Help → Keyboard Shortcuts shows the shortcut sheet', async () => {
  await click('app.shortcuts')
  const dlg = page.getByRole('dialog')
  await expect(dlg.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible()
  await expect(dlg.getByText('⇧⌘P')).toBeVisible()
  if (shots) await page.screenshot({ path: join(shots, '12-shortcuts.png') })
  await page.keyboard.press('Escape')
})

test('App → Settings opens the code display settings; File → Close Repository', async () => {
  await click('app.settings')
  await expect(page.getByText('Code display')).toBeVisible()
  await page.keyboard.press('Escape')
  await click('repo.close')
  await expect(page.getByText('Open repository…')).toBeVisible()
  await expect.poll(async () => (await item('remote.push'))?.enabled).toBe(false)
})

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
import { basename, join, resolve } from 'node:path'

/* The in-app terminal: a real login shell in the repository, in tabs at the bottom. */

const root = resolve(__dirname, '../..')
const shots = process.env.GITPRO_SHOTS

const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'gitpro-e2e-terminal-')))
const home = join(tmp, 'home')
const repoDir = join(tmp, 'term-repo')
mkdirSync(home)
writeFileSync(
  join(home, 'gitconfig'),
  '[user]\n  name = E2E User\n  email = e2e@example.com\n[init]\n  defaultBranch = main\n[commit]\n  gpgsign = false\n'
)
// A known prompt, and no zsh first-run wizard in the empty HOME.
writeFileSync(join(home, '.zshrc'), "PS1='e2e$ '\n")
const gitEnv = {
  ...process.env,
  HOME: home,
  // zsh reads its rc files from ZDOTDIR when set; keep the test away from the real profile.
  ZDOTDIR: home,
  SHELL: '/bin/zsh',
  GIT_CONFIG_GLOBAL: join(home, 'gitconfig'),
  GIT_CONFIG_NOSYSTEM: '1'
}
const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: repoDir, env: gitEnv, encoding: 'utf8' }).trim()

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  mkdirSync(repoDir)
  git('init', '-q')
  writeFileSync(join(repoDir, 'a.txt'), 'a\n')
  git('add', 'a.txt')
  git('commit', '-q', '-m', 'first commit')
  app = await electron.launch({
    args: ['.'],
    cwd: root,
    env: { ...gitEnv, GITPRO_USER_DATA: join(tmp, 'userdata'), GITPRO_SEED_REPO: repoDir }
  })
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.getByText(basename(repoDir), { exact: true }).click()
  await expect(page.getByText('first commit').first()).toBeVisible()
})

test.afterAll(async () => {
  await app?.close()
})

const panel = (): ReturnType<Page['getByRole']> => page.getByRole('region', { name: 'Terminal' })
const screen = (): ReturnType<Page['locator']> => panel().locator('.xterm-rows')
const tabs = (): ReturnType<Page['getByRole']> => panel().getByRole('tab')
const run = async (cmd: string): Promise<void> => {
  await page.keyboard.type(cmd)
  await page.keyboard.press('Enter')
}

test('opens a shell in the repository from the toolbar', async () => {
  await page.getByRole('button', { name: 'Terminal', exact: true }).click()
  await expect(tabs()).toHaveCount(1)
  await expect(tabs().first()).toHaveText('zsh')
  await expect(screen()).toContainText('e2e$')
  await run('pwd; echo "sum=$((40+2))"')
  await expect(screen()).toContainText(repoDir)
  await expect(screen()).toContainText('sum=42')
  if (shots) await page.screenshot({ path: join(shots, 'terminal-1.png') })
})

test('git commands run in the terminal show up in the app', async () => {
  await panel().locator('.xterm').click()
  await run('git commit -q --allow-empty -m "made in the terminal"')
  await expect(page.getByText('made in the terminal').first()).toBeVisible()
  expect(git('log', '-1', '--format=%s')).toBe('made in the terminal')
})

test('runs several terminals in tabs; exit closes one', async () => {
  await panel().getByRole('button', { name: 'New terminal' }).click()
  await expect(tabs()).toHaveCount(2)
  await expect(tabs().nth(1)).toHaveText('zsh 2')
  await expect(tabs().nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(screen()).toContainText('e2e$')
  await run('exit')
  await expect(tabs()).toHaveCount(1)
  // Back on the first tab, with its scrollback intact.
  await expect(screen()).toContainText('sum=42')
})

test('hiding the panel keeps the shell and its output', async () => {
  await panel().getByRole('button', { name: 'Hide terminal' }).click()
  await expect(panel()).toHaveCount(0)
  await page.getByRole('button', { name: 'Terminal', exact: true }).click()
  await expect(tabs()).toHaveCount(1)
  await expect(screen()).toContainText('sum=42')
  await run('echo still-here')
  await expect(screen()).toContainText('still-here')
})

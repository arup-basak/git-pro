import { execFileSync } from 'node:child_process'

/**
 * Apps launched from Finder get a minimal PATH, which hides Homebrew git, gpg, git-lfs and
 * ssh helpers. Load the PATH from the user's login shell once at startup.
 */
export function loadShellPath(): void {
  if (process.platform !== 'darwin' && process.platform !== 'linux') return
  const shell = process.env.SHELL || '/bin/zsh'
  try {
    const out = execFileSync(shell, ['-ilc', 'printf "__GITPRO_PATH__%s__GITPRO_PATH__" "$PATH"'], {
      encoding: 'utf8',
      timeout: 4000,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const m = /__GITPRO_PATH__(.*)__GITPRO_PATH__/.exec(out)
    if (m && m[1]) process.env.PATH = m[1]
  } catch {
    // keep the inherited PATH
  }
}

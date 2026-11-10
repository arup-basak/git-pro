import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { IgnoreRequest } from '../../shared/types'
import { insideWorktree } from './hunks'
import { git } from './runner'
import { commonDir } from './stashStore'

/**
 * Adds an ignore pattern to the repository's .gitignore (shared with everyone) or to
 * .git/info/exclude (this clone only). Lines already present are not added twice. Tracked
 * paths listed in `untrack` are removed from the index so the pattern takes effect; the files
 * stay on disk.
 */
export async function addIgnore(
  cwd: string,
  req: IgnoreRequest
): Promise<{ file: string; added: boolean }> {
  const pattern = req.pattern.trim()
  if (!pattern || /[\n\r\0]/.test(pattern)) throw new Error('The pattern must be a single line')
  if (pattern.startsWith('#')) throw new Error('A pattern cannot start with # (that is a comment)')
  const file =
    req.target === 'gitignore'
      ? join(cwd, '.gitignore')
      : join(await commonDir(cwd), 'info', 'exclude')
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    // new file
  }
  const added = !text.split(/\r?\n/).some((l) => l.trim() === pattern)
  if (added) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${pattern}\n`)
  }
  if (req.untrack.length) {
    for (const p of req.untrack) insideWorktree(cwd, p)
    await git(cwd, ['rm', '--cached', '-r', '-q', '--ignore-unmatch', '--', ...req.untrack], {
      write: true
    })
  }
  return { file, added }
}

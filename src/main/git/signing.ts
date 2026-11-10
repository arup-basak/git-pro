import { execFile } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ConfigScope, SigningConfig, SigningFormat, SigningKey } from '../../shared/types'
import { git, gitOut } from './runner'
import { tryResolve } from './util'

async function configGet(
  cwd: string,
  key: string
): Promise<{ value: string; scope: SigningConfig['keyScope'] } | null> {
  const r = await git(cwd, ['config', '--show-scope', '--get', key], { allowFail: true })
  if (r.code !== 0) return null
  const line = r.stdout.trim()
  const tab = line.indexOf('\t')
  return {
    scope: line.slice(0, tab) as SigningConfig['keyScope'],
    value: line.slice(tab + 1)
  }
}

const truthy = (v: string | undefined): boolean => /^(true|yes|on|1)$/i.test(v ?? '')

/** The signing setup in effect for this repository. */
export async function getSigning(cwd: string): Promise<SigningConfig> {
  const [format, key, commits, tags] = await Promise.all([
    configGet(cwd, 'gpg.format'),
    configGet(cwd, 'user.signingkey'),
    configGet(cwd, 'commit.gpgsign'),
    configGet(cwd, 'tag.gpgsign')
  ])
  const f = (format?.value ?? 'openpgp') as SigningFormat
  return {
    format: ['openpgp', 'ssh', 'x509'].includes(f) ? f : 'openpgp',
    key: key?.value ?? '',
    signCommits: truthy(commits?.value),
    signTags: truthy(tags?.value),
    keyScope: key?.scope ?? null
  }
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) =>
    execFile(cmd, args, { timeout: 5000 }, (err, stdout) => resolve(err ? '' : stdout))
  )
}

/** GPG secret keys and SSH public keys found on this machine. */
export async function listSigningKeys(): Promise<SigningKey[]> {
  const keys: SigningKey[] = []
  const gpg = await run('gpg', ['--list-secret-keys', '--with-colons'])
  let pending: string | null = null
  for (const line of gpg.split('\n')) {
    const f = line.split(':')
    if (f[0] === 'sec') pending = f[4]
    else if (f[0] === 'uid' && pending) {
      keys.push({ format: 'openpgp', id: pending, label: `${f[9]} (${pending})` })
      pending = null
    }
  }
  const sshDir = join(homedir(), '.ssh')
  try {
    for (const name of readdirSync(sshDir)) {
      if (!name.endsWith('.pub')) continue
      const path = join(sshDir, name)
      const comment = readFileSync(path, 'utf8').trim().split(/\s+/).slice(2).join(' ')
      keys.push({ format: 'ssh', id: path, label: `${name}${comment ? ` — ${comment}` : ''}` })
    }
  } catch {
    // no ~/.ssh
  }
  return keys
}

/** Writes the signing setup to this repository's config, or to the user's global config. */
export async function setSigning(cwd: string, scope: ConfigScope, c: SigningConfig): Promise<void> {
  if (scope !== 'local' && scope !== 'global') throw new Error('Unknown config scope')
  if (!['openpgp', 'ssh', 'x509'].includes(c.format)) throw new Error('Unknown signing format')
  if (/[\n\0]/.test(c.key)) throw new Error('The key must be a single line')
  const flag = `--${scope}`
  const set = (key: string, value: string): Promise<unknown> =>
    git(cwd, ['config', flag, key, value], { write: true })
  const unset = (key: string): Promise<unknown> =>
    git(cwd, ['config', flag, '--unset-all', key], { write: true, allowFail: true })
  if (c.format === 'openpgp') await unset('gpg.format')
  else await set('gpg.format', c.format)
  if (c.key.trim()) await set('user.signingkey', c.key.trim())
  else await unset('user.signingkey')
  await set('commit.gpgsign', String(c.signCommits))
  await set('tag.gpgsign', String(c.signTags))
}

/** Signs a throwaway commit object (never referenced) to check that signing works. */
export async function testSigning(cwd: string): Promise<{ ok: boolean; message: string }> {
  const tree = (await tryResolve(cwd, 'HEAD^{tree}')) ?? (await gitOut(cwd, ['write-tree']))
  const r = await git(cwd, ['commit-tree', '-S', tree, '-m', 'git-pro signing test'], {
    allowFail: true
  })
  if (r.code === 0) return { ok: true, message: 'Signing works.' }
  return { ok: false, message: r.stderr.trim() || 'Signing failed' }
}

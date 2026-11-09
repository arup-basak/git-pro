import type { PushSpec } from './types'

/** The exact `git push` arguments for a PushSpec (shared so the UI can preview the command). */
export function buildPushArgs(spec: PushSpec): string[] {
  const args = ['push', '--progress', '--porcelain']
  if (spec.dryRun) args.push('--dry-run')
  if (spec.setUpstream && spec.sourceKind === 'branch') args.push('--set-upstream')
  if (spec.followTags) args.push('--follow-tags')
  const dst = `refs/heads/${spec.dest}`
  if (spec.force === 'lease') {
    args.push(`--force-with-lease=${dst}:${spec.leaseExpect ?? '<remote-tracking sha>'}`)
  } else if (spec.force === 'force') {
    args.push('--force')
  }
  const src = spec.sourceKind === 'branch' ? `refs/heads/${spec.source}` : spec.source
  args.push(spec.remote, `${src}:${dst}`)
  return args
}

export function formatCommand(args: string[]): string {
  return (
    'git ' +
    args
      .map((a) => (/^[\w@%+=:,./{}^~-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`))
      .join(' ')
  )
}

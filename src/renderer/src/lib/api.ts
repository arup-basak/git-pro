import type { ApiMethod, GitProApi } from '@shared/api'

/** Typed call into the main process. */
export function call<K extends ApiMethod>(
  method: K,
  ...args: Parameters<GitProApi[K]>
): ReturnType<GitProApi[K]> {
  return window.gitPro.invoke(method, ...args)
}

/** Splits "message\n\ndetail" errors coming over the bridge. */
export function errorParts(e: unknown): { message: string; detail?: string } {
  const raw = e instanceof Error ? e.message : String(e)
  const cleaned = raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  const idx = cleaned.indexOf('\n\n')
  if (idx === -1) return { message: cleaned }
  return { message: cleaned.slice(0, idx), detail: cleaned.slice(idx + 2) }
}

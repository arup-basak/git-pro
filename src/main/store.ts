import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface Settings {
  recent: string[]
}

const file = (): string => join(app.getPath('userData'), 'settings.json')

let cache: Settings | null = null

export function loadSettings(): Settings {
  if (cache) return cache
  try {
    const parsed = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Settings>
    cache = {
      recent: Array.isArray(parsed.recent) ? parsed.recent.filter((p) => typeof p === 'string') : []
    }
  } catch {
    cache = { recent: [] }
  }
  return cache
}

function save(): void {
  try {
    writeFileSync(file(), JSON.stringify(cache, null, 2))
  } catch (e) {
    console.error('Failed to save settings', e)
  }
}

export function addRecent(path: string): void {
  const s = loadSettings()
  s.recent = [path, ...s.recent.filter((p) => p !== path)].slice(0, 20)
  save()
}

export function removeRecent(path: string): void {
  const s = loadSettings()
  s.recent = s.recent.filter((p) => p !== path)
  save()
}

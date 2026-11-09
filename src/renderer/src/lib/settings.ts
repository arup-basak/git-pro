import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export { SYNTAX_THEMES } from '../../../shared/themes'

export type DiffLayout = 'unified' | 'split'

export interface ViewSettings {
  /** Syntax highlighting in diffs, the merge editor and code views. */
  syntax: boolean
  /** Shiki theme id. */
  theme: string
  /** Emphasise the changed words inside modified lines. */
  wordDiff: boolean
  /** Soft-wrap long lines in diffs. */
  wrap: boolean
  /** Show diffs as one column (unified) or old and new side by side (split). */
  diffLayout: DiffLayout
  set(patch: Partial<Omit<ViewSettings, 'set'>>): void
}

const memory = new Map<string, string>()
const memoryStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k)
}

/** Per-machine display preferences (kept in this window's localStorage). */
export const useViewSettings = create<ViewSettings>()(
  persist(
    (set) => ({
      syntax: true,
      theme: 'github-dark-default',
      wordDiff: true,
      wrap: true,
      diffLayout: 'unified',
      set: (patch) => set(patch)
    }),
    {
      name: 'gitpro.view',
      // localStorage only exists in the renderer (tests import this module under Node).
      storage: createJSONStorage(() =>
        typeof window === 'undefined' ? memoryStorage : window.localStorage
      ),
      partialize: ({ syntax, theme, wordDiff, wrap, diffLayout }) => ({
        syntax,
        theme,
        wordDiff,
        wrap,
        diffLayout
      })
    }
  )
)

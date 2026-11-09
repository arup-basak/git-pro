import { createHighlighterCore, type HighlighterCore, type ThemedToken } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { bundledLanguagesInfo } from 'shiki/langs'
import { bundledThemes } from 'shiki/themes'
import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { useViewSettings } from './settings'

export type { ThemedToken }

/* ---------------- language detection ---------------- */

const langImports = new Map(bundledLanguagesInfo.map((l) => [l.id, l.import]))

const byExtension = new Map<string, string>()
for (const l of bundledLanguagesInfo) {
  byExtension.set(l.id, l.id)
  for (const a of l.aliases ?? []) byExtension.set(a, l.id)
}
const EXTRA_EXT: Record<string, string> = {
  h: 'c',
  hh: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  mts: 'typescript',
  cts: 'typescript',
  htm: 'html',
  xhtml: 'html',
  svg: 'xml',
  plist: 'xml',
  csproj: 'xml',
  pyw: 'python',
  pyi: 'python',
  kts: 'kotlin',
  gradle: 'groovy',
  tf: 'terraform',
  tfvars: 'terraform',
  mdx: 'mdx',
  jsonc: 'jsonc',
  json5: 'json5',
  lock: 'json',
  gitignore: 'ini',
  gitattributes: 'ini',
  editorconfig: 'ini',
  npmrc: 'ini',
  env: 'dotenv',
  conf: 'ini',
  cfg: 'ini',
  m: 'objective-c',
  mm: 'objective-cpp',
  ex: 'elixir',
  exs: 'elixir'
}
const BY_NAME: Record<string, string> = {
  dockerfile: 'docker',
  makefile: 'make',
  gnumakefile: 'make',
  'cmakelists.txt': 'cmake',
  gemfile: 'ruby',
  rakefile: 'ruby',
  podfile: 'ruby',
  brewfile: 'ruby',
  vagrantfile: 'ruby',
  jenkinsfile: 'groovy',
  commit_editmsg: 'git-commit',
  'git-rebase-todo': 'git-rebase'
}

/** Shiki language id for a path, or null for plain text / unknown. */
export function langFromPath(path: string | null | undefined): string | null {
  if (!path) return null
  const name = path.split('/').pop()!.toLowerCase()
  const known = BY_NAME[name] ?? (name.startsWith('dockerfile') ? 'docker' : undefined)
  if (known) return langImports.has(known) ? known : null
  const dot = name.lastIndexOf('.')
  if (dot === -1) return null
  const ext = name.slice(dot + 1)
  const id = EXTRA_EXT[ext] ?? byExtension.get(ext)
  return id && langImports.has(id) ? id : null
}

/* ---------------- lazy highlighter ---------------- */

let core: HighlighterCore | null = null
let corePromise: Promise<HighlighterCore> | null = null
const loaded = new Set<string>()
const failed = new Set<string>()

/** Bumped whenever a language or theme finishes loading, so tokenizers re-evaluate. */
const useLoadVersion = create<{ v: number }>(() => ({ v: 0 }))

function getCore(): Promise<HighlighterCore> {
  corePromise ??= createHighlighterCore({
    themes: [],
    langs: [],
    // The JS engine avoids WebAssembly (and a CSP exception for it).
    engine: createJavaScriptRegexEngine({ forgiving: true })
  }).then((h) => (core = h))
  return corePromise
}

const inflight = new Map<string, Promise<void>>()

function ensure(kind: 'lang' | 'theme', id: string): Promise<void> {
  const key = `${kind}:${id}`
  if (loaded.has(key) || failed.has(key)) return Promise.resolve()
  const existing = inflight.get(key)
  if (existing) return existing
  const p = getCore()
    .then(async (h) => {
      if (kind === 'lang') {
        const imp = langImports.get(id)
        if (!imp) throw new Error(`Unknown language ${id}`)
        await h.loadLanguage(imp)
      } else {
        const imp = bundledThemes[id as keyof typeof bundledThemes]
        if (!imp) throw new Error(`Unknown theme ${id}`)
        await h.loadTheme(imp)
      }
      loaded.add(key)
    })
    .catch(() => {
      failed.add(key)
    })
    .finally(() => {
      inflight.delete(key)
      useLoadVersion.setState((st) => ({ v: st.v + 1 }))
    })
  inflight.set(key, p)
  return p
}

/** One-off tokenization outside React (loads what it needs first). */
export async function tokenizeOnce(
  code: string,
  lang: string,
  theme: string
): Promise<ThemedToken[][] | null> {
  await Promise.all([ensure('lang', lang), ensure('theme', theme)])
  if (!core || !loaded.has(`lang:${lang}`) || !loaded.has(`theme:${theme}`)) return null
  return core.codeToTokensBase(code, { lang, theme, tokenizeMaxLineLength: 2000 })
}

/** Skip highlighting for very large inputs; the UI stays plain but responsive. */
const MAX_CHARS = 400_000

export type Tokenize = (code: string) => ThemedToken[][] | null

/**
 * Returns a synchronous tokenizer once the language and theme are loaded (null until then, or
 * when highlighting is off / the language is unknown). Components re-render when loading ends.
 */
export function useTokenizer(lang: string | null): Tokenize | null {
  const v = useLoadVersion((s) => s.v)
  const syntax = useViewSettings((s) => s.syntax)
  const theme = useViewSettings((s) => s.theme)
  useEffect(() => {
    if (syntax && lang) {
      void ensure('theme', theme)
      void ensure('lang', lang)
    }
  }, [syntax, lang, theme])
  return useMemo(() => {
    void v
    if (!syntax || !lang || !core) return null
    if (!loaded.has(`lang:${lang}`) || !loaded.has(`theme:${theme}`)) return null
    const h = core
    return (code: string) => {
      if (code.length > MAX_CHARS) return null
      try {
        return h.codeToTokensBase(code, { lang, theme, tokenizeMaxLineLength: 2000 })
      } catch {
        return null
      }
    }
  }, [v, syntax, lang, theme])
}

/** Tokens for a whole text, memoised. */
export function useTokens(text: string, lang: string | null): ThemedToken[][] | null {
  const tokenize = useTokenizer(lang)
  return useMemo(() => (tokenize ? tokenize(text) : null), [tokenize, text])
}

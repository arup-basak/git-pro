import { describe, expect, it } from 'vitest'
import { langFromPath, tokenizeOnce } from '../src/renderer/src/lib/highlight'
import { wordDiff } from '../src/renderer/src/lib/wordDiff'
import { compose, parseConflicts } from '../src/renderer/src/components/merge/conflicts'

describe('language detection', () => {
  it.each([
    ['src/main/index.ts', 'typescript'],
    ['App.tsx', 'tsx'],
    ['lib/util.mjs', 'javascript'],
    ['scripts/run.py', 'python'],
    ['go.mod', null],
    ['main.go', 'go'],
    ['src/lib.rs', 'rust'],
    ['include/x.h', 'c'],
    ['a/b.hpp', 'cpp'],
    ['README.md', 'markdown'],
    ['.github/workflows/ci.yml', 'yaml'],
    ['Dockerfile', 'docker'],
    ['Dockerfile.dev', 'docker'],
    ['Makefile', 'make'],
    ['package.json', 'json'],
    ['styles.scss', 'scss'],
    ['notes', null],
    ['archive.zzz', null]
  ])('%s → %s', (path, lang) => {
    expect(langFromPath(path)).toBe(lang)
  })
})

describe('syntax tokenizer', () => {
  it('produces coloured tokens per line with the JavaScript regex engine', async () => {
    const code = 'const answer: number = 42 // the answer\nexport default answer\n'
    const tokens = await tokenizeOnce(code, 'typescript', 'github-dark-default')
    expect(tokens).not.toBeNull()
    expect(tokens!).toHaveLength(3)
    expect(tokens![0].map((t) => t.content).join('')).toBe(
      'const answer: number = 42 // the answer'
    )
    const colors = new Set(tokens![0].map((t) => t.color))
    expect(colors.size).toBeGreaterThan(2) // keyword, number, comment … differ
  })
})

describe('word diff', () => {
  it('marks only the changed words', () => {
    expect(wordDiff('const a = 1', 'const b = 1')).toEqual({ a: [[6, 7]], b: [[6, 7]] })
    expect(wordDiff('foo(bar, baz)', 'foo(bar, qux, baz)')).toEqual({ a: [], b: [[9, 14]] })
  })

  it('gives up on lines that share almost nothing', () => {
    expect(wordDiff('import x from "a"', 'return 42')).toBeNull()
  })
})

describe('conflict parsing', () => {
  it('round-trips diff3 markers and resolves choices', () => {
    const text = 'a\n<<<<<<< ours\nX\n||||||| base\nB\n=======\nY\n>>>>>>> theirs\nz\n'
    const segs = parseConflicts(text)
    expect(segs.map((s) => s.kind)).toEqual(['text', 'conflict', 'text'])
    expect(compose(segs)).toEqual({ text, unresolved: 1 })
    const c = segs[1]
    if (c.kind !== 'conflict') throw new Error('expected conflict')
    c.choice = 'both'
    expect(compose(segs)).toEqual({ text: 'a\nX\nY\nz\n', unresolved: 0 })
  })
})

import { describe, expect, it } from 'vitest'
import { pairRuns, parsePatch, splitRows } from '../src/renderer/src/lib/patch'

const PATCH = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,6 +1,6 @@',
  ' keep 1',
  '-old 2',
  '-old 3',
  '+new 2',
  ' keep 4',
  '+added 5',
  ' keep 6',
  '-gone 7',
  '\\ No newline at end of file',
  ''
].join('\n')

describe('pairRuns', () => {
  it('pairs each removed run with the added run that follows it', () => {
    const [file] = parsePatch(PATCH).files
    const text = (i: number): string => file.lines[i].text
    expect(pairRuns(file.lines).map(([d, a]) => [text(d), text(a)])).toEqual([['old 2', 'new 2']])
  })
})

describe('splitRows', () => {
  it('lines up context, pairs changes and leaves gaps for unmatched lines', () => {
    const [file] = parsePatch(PATCH).files
    const show = (i: number | undefined): string | null =>
      i === undefined ? null : file.lines[i].text
    const rows = splitRows(file.lines).map((r) =>
      r.full !== undefined ? ['full', file.lines[r.full].text] : [show(r.left), show(r.right)]
    )
    expect(rows).toEqual([
      ['full', '@@ -1,6 +1,6 @@'],
      ['keep 1', 'keep 1'],
      ['old 2', 'new 2'],
      ['old 3', null],
      ['keep 4', 'keep 4'],
      [null, 'added 5'],
      ['keep 6', 'keep 6'],
      ['gone 7', null],
      ['full', '\\ No newline at end of file']
    ])
  })

  it('keeps old and new line numbers on their own side', () => {
    const [file] = parsePatch(PATCH).files
    const row = splitRows(file.lines).find(
      (r) => r.full === undefined && r.left === undefined && r.right !== undefined
    )
    // New side: keep 1 (1), new 2 (2), keep 4 (3), added 5 (4).
    expect(row && row.full === undefined && file.lines[row.right!].newNo).toBe(4)
  })
})

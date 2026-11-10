export interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'hunk' | 'meta'
  text: string
  oldNo?: number
  newNo?: number
  /** Index of the hunk this line belongs to (set on hunk headers and the lines below them). */
  hunk?: number
  /** For add/del lines: ordinal among the file's changed lines (what line selections use). */
  change?: number
}

export interface DiffHunk {
  /** Index of the `@@` line in `lines`. */
  header: number
  /** Change ordinals (see DiffLine.change) of the hunk's added and removed lines. */
  changes: number[]
}

export interface DiffFile {
  title: string
  /** Path on the new side (used for language detection). */
  path: string
  lines: DiffLine[]
  hunks: DiffHunk[]
  binary: boolean
}

/**
 * Pairs each run of removed lines with the run of added lines right after it, index by index.
 * Returns [delIndex, addIndex] pairs (indexes into `lines`). Used for word marks and for
 * lining up the two sides of a side-by-side diff.
 */
export function pairRuns(lines: DiffLine[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = []
  let k = 0
  while (k < lines.length) {
    if (lines[k].kind !== 'del') {
      k++
      continue
    }
    const delStart = k
    while (k < lines.length && lines[k].kind === 'del') k++
    const addStart = k
    while (k < lines.length && lines[k].kind === 'add') k++
    const n = Math.min(addStart - delStart, k - addStart)
    for (let p = 0; p < n; p++) pairs.push([delStart + p, addStart + p])
  }
  return pairs
}

/** One row of a side-by-side diff: line indexes for each side, or a full-width line. */
export type SplitRow = { left?: number; right?: number; full?: undefined } | { full: number }

/**
 * Lays out diff lines in two columns. Context lines appear on both sides; a run of removed
 * lines sits next to the run of added lines that follows it; unmatched lines get an empty
 * cell on the other side; hunk headers and meta lines span the full width.
 */
export function splitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = []
  let k = 0
  while (k < lines.length) {
    const kind = lines[k].kind
    if (kind === 'ctx') {
      rows.push({ left: k, right: k })
      k++
    } else if (kind === 'del' || kind === 'add') {
      const dels: number[] = []
      const adds: number[] = []
      while (k < lines.length && lines[k].kind === 'del') dels.push(k++)
      while (k < lines.length && lines[k].kind === 'add') adds.push(k++)
      for (let p = 0; p < Math.max(dels.length, adds.length); p++) {
        rows.push({ left: dels[p], right: adds[p] })
      }
    } else {
      rows.push({ full: k })
      k++
    }
  }
  return rows
}

const MAX_LINES = 20000

export function parsePatch(patch: string): { files: DiffFile[]; truncated: boolean } {
  const files: DiffFile[] = []
  let file: DiffFile | null = null
  let oldNo = 0
  let newNo = 0
  let count = 0
  let truncated = false
  let inHunk = false
  let change = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.*) b\/(.*)$/.exec(line)
      file = {
        title: m ? (m[1] === m[2] ? m[2] : `${m[1]} → ${m[2]}`) : line,
        path: m ? (m[2] === 'dev/null' ? m[1] : m[2]) : '',
        lines: [],
        hunks: [],
        binary: false
      }
      change = 0
      files.push(file)
      inHunk = false
      continue
    }
    if (!file) continue
    if (count++ > MAX_LINES) {
      truncated = true
      break
    }
    if (line.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      if (m) {
        oldNo = Number(m[1])
        newNo = Number(m[2])
      }
      inHunk = true
      file.hunks.push({ header: file.lines.length, changes: [] })
      file.lines.push({ kind: 'hunk', text: line, hunk: file.hunks.length - 1 })
      continue
    }
    if (!inHunk) {
      if (line.startsWith('Binary files')) file.binary = true
      if (
        /^(new file|deleted file|rename from|rename to|old mode|new mode|similarity)/.test(line)
      ) {
        file.lines.push({ kind: 'meta', text: line })
      }
      continue
    }
    const hunk = file.hunks.length - 1
    if (line.startsWith('+') || line.startsWith('-')) {
      const add = line[0] === '+'
      file.hunks[hunk].changes.push(change)
      file.lines.push({
        kind: add ? 'add' : 'del',
        text: line.slice(1),
        ...(add ? { newNo: newNo++ } : { oldNo: oldNo++ }),
        hunk,
        change: change++
      })
    } else if (line.startsWith(' '))
      file.lines.push({ kind: 'ctx', text: line.slice(1), oldNo: oldNo++, newNo: newNo++, hunk })
    else if (line.startsWith('\\')) file.lines.push({ kind: 'meta', text: line, hunk })
  }
  return { files, truncated }
}

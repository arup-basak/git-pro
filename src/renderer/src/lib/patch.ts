export interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'hunk' | 'meta'
  text: string
  oldNo?: number
  newNo?: number
}

export interface DiffFile {
  title: string
  /** Path on the new side (used for language detection). */
  path: string
  lines: DiffLine[]
  binary: boolean
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
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.*) b\/(.*)$/.exec(line)
      file = {
        title: m ? (m[1] === m[2] ? m[2] : `${m[1]} → ${m[2]}`) : line,
        path: m ? (m[2] === 'dev/null' ? m[1] : m[2]) : '',
        lines: [],
        binary: false
      }
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
      file.lines.push({ kind: 'hunk', text: line })
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
    if (line.startsWith('+')) file.lines.push({ kind: 'add', text: line.slice(1), newNo: newNo++ })
    else if (line.startsWith('-'))
      file.lines.push({ kind: 'del', text: line.slice(1), oldNo: oldNo++ })
    else if (line.startsWith(' '))
      file.lines.push({ kind: 'ctx', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ })
    else if (line.startsWith('\\')) file.lines.push({ kind: 'meta', text: line })
  }
  return { files, truncated }
}

/** [start, end) character ranges within a line. */
export type Range = [number, number]

const WORD = /\w+|\s+|[^\w\s]/g
const MAX_TOKENS = 400

function tokens(s: string): Array<{ t: string; at: number }> {
  const out: Array<{ t: string; at: number }> = []
  for (const m of s.matchAll(WORD)) out.push({ t: m[0], at: m.index ?? 0 })
  return out
}

/**
 * Word-level diff between an old and a new line (LCS over word/space/punctuation tokens).
 * Returns the changed ranges on each side, or null when the lines are too different (or too
 * long) for word marks to help.
 */
export function wordDiff(a: string, b: string): { a: Range[]; b: Range[] } | null {
  if (a === b) return { a: [], b: [] }
  const ta = tokens(a)
  const tb = tokens(b)
  const n = ta.length
  const m = tb.length
  if (n === 0 || m === 0 || n > MAX_TOKENS || m > MAX_TOKENS) return null
  // dp[i][j] = LCS length of ta[i:] and tb[j:]
  const w = m + 1
  const dp = new Uint16Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        ta[i].t === tb[j].t
          ? dp[(i + 1) * w + j + 1] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
    }
  }
  const keepA = new Array<boolean>(n).fill(false)
  const keepB = new Array<boolean>(m).fill(false)
  let i = 0
  let j = 0
  let same = 0
  while (i < n && j < m) {
    if (ta[i].t === tb[j].t) {
      keepA[i] = keepB[j] = true
      same += ta[i].t.trim() ? ta[i].t.length : 0
      i++
      j++
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++
    else j++
  }
  // Only worth marking when a meaningful part of the line is shared.
  const meaningful = Math.max(a.trim().length, b.trim().length)
  if (meaningful === 0 || same / meaningful < 0.35) return null
  return { a: toRanges(ta, keepA), b: toRanges(tb, keepB) }
}

function toRanges(toks: Array<{ t: string; at: number }>, keep: boolean[]): Range[] {
  const out: Range[] = []
  for (let k = 0; k < toks.length; k++) {
    if (keep[k]) continue
    const start = toks[k].at
    const end = start + toks[k].t.length
    const last = out[out.length - 1]
    // Merge with the previous range, bridging a single kept whitespace token.
    if (
      last &&
      (last[1] === start ||
        (k > 0 && keep[k - 1] && !toks[k - 1].t.trim() && last[1] === toks[k - 1].at))
    ) {
      last[1] = end
    } else out.push([start, end])
  }
  return out
}

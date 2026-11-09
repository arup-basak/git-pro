export interface LaneLine {
  from: number
  to: number
  half: 'top' | 'bottom' | 'full'
  color: number
}

export interface LaneRow {
  lane: number
  color: number
  lines: LaneLine[]
  width: number
}

function firstFree(lanes: Array<string | null>): number {
  const i = lanes.indexOf(null)
  return i === -1 ? lanes.length : i
}

/**
 * Assigns each commit (newest first, topo order) to a lane and computes the line segments
 * needed to draw the graph row by row.
 */
export function computeLanes(commits: Array<{ sha: string; parents: string[] }>): LaneRow[] {
  const lanes: Array<string | null> = []
  const colors: number[] = []
  let nextColor = 0
  const rows: LaneRow[] = []

  for (const c of commits) {
    let idx = lanes.indexOf(c.sha)
    if (idx === -1) {
      idx = firstFree(lanes)
      lanes[idx] = c.sha
      colors[idx] = nextColor++
    }
    const before = lanes.slice()
    const beforeColors = colors.slice()
    const myColor = colors[idx]
    const lines: LaneLine[] = []

    // Lanes converging into this commit (it is a parent of several children).
    for (let j = 0; j < before.length; j++) {
      if (before[j] === c.sha) {
        lines.push({ from: j, to: idx, half: 'top', color: beforeColors[j] })
        if (j !== idx) lanes[j] = null
      }
    }

    // Route parents.
    lanes[idx] = null
    c.parents.forEach((p, i) => {
      let k = lanes.indexOf(p)
      if (k === -1) {
        if (i === 0) {
          k = idx
          colors[k] = myColor
        } else {
          k = firstFree(lanes)
          colors[k] = nextColor++
        }
        lanes[k] = p
      }
      lines.push({ from: idx, to: k, half: 'bottom', color: colors[k] })
    })

    // Lanes passing straight through this row.
    for (let j = 0; j < before.length; j++) {
      if (before[j] !== null && before[j] !== c.sha && lanes[j] === before[j]) {
        lines.push({ from: j, to: j, half: 'full', color: beforeColors[j] })
      }
    }

    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop()
    rows.push({
      lane: idx,
      color: myColor,
      lines,
      width: Math.max(before.length, lanes.length, idx + 1)
    })
  }
  return rows
}

export const LANE_COLORS = [
  '#6ea8fe',
  '#4cc38a',
  '#f0b429',
  '#e879f9',
  '#f2665b',
  '#22d3ee',
  '#a78bfa',
  '#fb923c'
]

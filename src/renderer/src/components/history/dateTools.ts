/** Parses offsets like "+2h", "-1d 3h 30m", "90m", "+45s". Returns seconds or null. */
export function parseOffset(input: string): number | null {
  const s = input.trim()
  if (!s) return null
  const sign = s.startsWith('-') ? -1 : 1
  const body = s.replace(/^[+-]/, '')
  const re = /(\d+(?:\.\d+)?)\s*(w|d|h|m|s)/gi
  let total = 0
  let matched = ''
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    const n = Number(m[1])
    const unit = m[2].toLowerCase()
    total +=
      n *
      (unit === 'w' ? 604800 : unit === 'd' ? 86400 : unit === 'h' ? 3600 : unit === 'm' ? 60 : 1)
    matched += m[0]
  }
  if (!matched || matched.replace(/\s/g, '') !== body.replace(/\s/g, '')) return null
  return Math.round(sign * total)
}

export function formatOffset(seconds: number): string {
  const sign = seconds < 0 ? '−' : '+'
  let s = Math.abs(seconds)
  const parts: string[] = []
  for (const [u, n] of [
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
    ['s', 1]
  ] as Array<[string, number]>) {
    if (s >= n) {
      parts.push(`${Math.floor(s / n)}${u}`)
      s %= n
    }
  }
  return sign + (parts.join(' ') || '0s')
}

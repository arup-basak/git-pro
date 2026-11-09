import { describe, expect, it } from 'vitest'
import {
  formatGitDate,
  fromInputValue,
  parseRawDate,
  spreadEvenly,
  spreadRandom,
  toGitDateArg,
  toInputValue,
  tzToMinutes,
  withTz
} from '../src/shared/dates'
import { buildPushArgs } from '../src/shared/push'

describe('dates', () => {
  it('round-trips wall-clock values in arbitrary offsets', () => {
    const d = fromInputValue('2024-03-10T09:15:30', '+0530')
    expect(d).toEqual({ ts: 1710042330, tz: '+0530' })
    expect(toInputValue(d)).toBe('2024-03-10T09:15:30')
    expect(formatGitDate(withTz(d, '-0800'))).toBe('2024-03-09 19:45:30 -0800')
  })

  it('parses and formats raw git dates', () => {
    expect(parseRawDate('1700000000 -0345')).toEqual({ ts: 1700000000, tz: '-0345' })
    expect(toGitDateArg({ ts: 5, tz: '+0000' })).toBe('@5 +0000')
    expect(tzToMinutes('-0930')).toBe(-570)
    expect(() => toGitDateArg({ ts: 1, tz: '0530' })).toThrow()
  })

  it('spreads timestamps evenly and randomly while keeping order', () => {
    expect(spreadEvenly(100, 400, 4)).toEqual([100, 200, 300, 400])
    const r = spreadRandom(0, 1000, 20)
    expect([...r].sort((a, b) => a - b)).toEqual(r)
    expect(r.every((t) => t >= 0 && t <= 1000)).toBe(true)
  })
})

describe('push args', () => {
  it('builds a refspec for pushing a commit to a new remote branch with a lease', () => {
    expect(
      buildPushArgs({
        remote: 'origin',
        sourceKind: 'commit',
        source: 'abc123',
        dest: 'feature/x',
        force: 'lease',
        leaseExpect: '',
        setUpstream: true,
        followTags: false,
        dryRun: true
      })
    ).toEqual([
      'push',
      '--progress',
      '--porcelain',
      '--dry-run',
      '--force-with-lease=refs/heads/feature/x:',
      'origin',
      'abc123:refs/heads/feature/x'
    ])
  })
})

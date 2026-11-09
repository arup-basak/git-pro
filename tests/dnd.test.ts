import { describe, expect, it } from 'vitest'
import { dropActions } from '../src/renderer/src/lib/dnd'

const SHA = '0123456789abcdef0123456789abcdef01234567'

describe('dropActions', () => {
  it('offers cherry-pick, rebase and move for a commit dropped on a branch', () => {
    const choices = dropActions(
      { kind: 'commit', sha: SHA },
      { kind: 'branch', name: 'topic', current: false }
    )
    expect(choices.map((c) => c.label)).toEqual([
      'Cherry-pick 01234567 onto topic',
      'Rebase topic onto 01234567…',
      'Move topic to 01234567…'
    ])
    expect(choices[0].action).toEqual({
      kind: 'cherry-pick',
      sha: SHA,
      branch: 'topic',
      current: false
    })
  })

  it('says Reset for the checked-out branch', () => {
    const [, , move] = dropActions(
      { kind: 'commit', sha: SHA },
      { kind: 'branch', name: 'main', current: true }
    )
    expect(move.label).toBe('Reset main to 01234567…')
    expect(move.danger).toBe(true)
  })

  it('offers merge and both rebases for a branch dropped on a branch', () => {
    const choices = dropActions(
      { kind: 'branch', name: 'feature', remote: false },
      { kind: 'branch', name: 'main', current: true }
    )
    expect(choices.map((c) => c.action)).toEqual([
      { kind: 'merge', source: 'feature', target: 'main' },
      { kind: 'rebase', branch: 'feature', onto: 'main' },
      { kind: 'rebase', branch: 'main', onto: 'feature' }
    ])
  })

  it('does not offer to rebase a remote branch', () => {
    const choices = dropActions(
      { kind: 'branch', name: 'origin/feature', remote: true },
      { kind: 'branch', name: 'main', current: true }
    )
    expect(choices.map((c) => c.label)).toEqual([
      'Merge origin/feature into main…',
      'Rebase main onto origin/feature…'
    ])
  })

  it('offers push when dropping on a remote branch', () => {
    expect(
      dropActions({ kind: 'commit', sha: SHA }, { kind: 'remote', short: 'origin/release/1.0' })
    ).toEqual([
      {
        label: 'Push 01234567 to origin/release/1.0…',
        action: {
          kind: 'push',
          sourceKind: 'commit',
          source: SHA,
          remote: 'origin',
          dest: 'release/1.0'
        }
      }
    ])
    expect(
      dropActions(
        { kind: 'branch', name: 'main', remote: false },
        { kind: 'remote', short: 'origin/x' }
      )[0].action
    ).toMatchObject({ kind: 'push', sourceKind: 'branch', source: 'main', dest: 'x' })
  })

  it('rejects dropping a ref on itself or a remote branch on a remote branch', () => {
    expect(
      dropActions(
        { kind: 'branch', name: 'main', remote: false },
        { kind: 'branch', name: 'main', current: true }
      )
    ).toEqual([])
    expect(
      dropActions(
        { kind: 'branch', name: 'origin/a', remote: true },
        { kind: 'remote', short: 'origin/b' }
      )
    ).toEqual([])
  })
})

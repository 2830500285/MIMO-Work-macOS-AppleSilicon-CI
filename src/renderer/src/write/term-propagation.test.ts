import { describe, expect, it } from 'vitest'
import {
  buildWriteCanonicalTermPropagationChanges,
  buildWriteTermPropagationChanges
} from './term-propagation'

function applyChanges(
  content: string,
  changes: Array<{ from: number; to: number; insert: string }>
): string {
  let next = content
  for (const change of [...changes].sort((a, b) => b.from - a.from)) {
    next = `${next.slice(0, change.from)}${change.insert}${next.slice(change.to)}`
  }
  return next
}

describe('write term propagation', () => {
  it('propagates a case-only phrase replacement within the same paragraph', () => {
    const content = [
      'i build MIMO Work, li is amazing ui production.',
      'mimo gui can write paper, also can code. mimo gui is use',
      'mimo api, but it not only that.',
      '',
      'mimo gui in another paragraph stays untouched.'
    ].join('\n')
    const seedFrom = content.indexOf('MIMO Work')

    const changes = buildWriteTermPropagationChanges(content, {
      from: seedFrom,
      to: seedFrom + 'MIMO Work'.length,
      deletedText: 'mimo gui',
      insertedText: 'MIMO Work'
    })

    expect(changes).toHaveLength(2)
    expect(applyChanges(content, changes)).toBe([
      'i build MIMO Work, li is amazing ui production.',
      'MIMO Work can write paper, also can code. MIMO Work is use',
      'mimo api, but it not only that.',
      '',
      'mimo gui in another paragraph stays untouched.'
    ].join('\n'))
  })

  it('propagates a term rename such as mimo gui to DXGUI', () => {
    const content = 'DXGUI is here. mimo gui is there. mimo gui again.'
    const changes = buildWriteTermPropagationChanges(content, {
      from: 0,
      to: 'DXGUI'.length,
      deletedText: 'mimo gui',
      insertedText: 'DXGUI'
    })

    expect(applyChanges(content, changes)).toBe('DXGUI is here. DXGUI is there. DXGUI again.')
  })

  it('does not replace partial word matches', () => {
    const content = 'MIMO Work works. mymimo gui should not. mimo gui should.'
    const seedFrom = content.indexOf('MIMO Work')

    const changes = buildWriteTermPropagationChanges(content, {
      from: seedFrom,
      to: seedFrom + 'MIMO Work'.length,
      deletedText: 'mimo gui',
      insertedText: 'MIMO Work'
    })

    expect(applyChanges(content, changes)).toBe(
      'MIMO Work works. mymimo gui should not. MIMO Work should.'
    )
  })

  it('propagates canonical casing after an incremental case edit', () => {
    const content = 'MIMO Work works. mimo work should follow. mimo api should not.'
    const seedFrom = content.indexOf('MIMO Work')

    const changes = buildWriteCanonicalTermPropagationChanges(content, {
      from: seedFrom,
      to: seedFrom + 1,
      deletedText: 'm',
      insertedText: 'M'
    })

    expect(applyChanges(content, changes)).toBe(
      'MIMO Work works. MIMO Work should follow. mimo api should not.'
    )
  })
})

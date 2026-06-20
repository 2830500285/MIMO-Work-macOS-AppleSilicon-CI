import { describe, expect, it } from 'vitest'
import { writeInlineCompletionModelOptions } from './settings-section-write'

describe('write inline completion model options', () => {
  it('keeps the writing model list scoped to the inherited provider', () => {
    const options = writeInlineCompletionModelOptions([
      'MIMO-M2',
      'MIMO-M3',
      'MIMO-M2'
    ])

    expect(options).toEqual(['MIMO-M2', 'MIMO-M3'])
    expect(options).not.toContain('mimo-v2.5-pro')
    expect(options).not.toContain('mimo-v2-flash')
  })

  it('uses built-in defaults only when the provider has no models', () => {
    expect(writeInlineCompletionModelOptions([])).toEqual([
      'mimo-v2.5-pro',
      'mimo-v2-flash'
    ])
  })
})

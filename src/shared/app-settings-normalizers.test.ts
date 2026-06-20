import { describe, expect, it } from 'vitest'
import { normalizeLogRetentionDays } from './app-settings-normalizers'

describe('normalizeLogRetentionDays', () => {
  it('keeps zero as forever and clamps custom day counts', () => {
    expect(normalizeLogRetentionDays(0)).toBe(0)
    expect(normalizeLogRetentionDays(3)).toBe(3)
    expect(normalizeLogRetentionDays(30.9)).toBe(30)
    expect(normalizeLogRetentionDays(9000)).toBe(3650)
  })

  it('uses the fallback for invalid values', () => {
    expect(normalizeLogRetentionDays('forever')).toBe(7)
    expect(normalizeLogRetentionDays(Number.NaN, 30)).toBe(30)
    expect(normalizeLogRetentionDays(-1, 30)).toBe(30)
  })
})

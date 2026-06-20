import { describe, expect, it } from 'vitest'
import { redactSecrets, redactSecretText } from './secret-redaction'

describe('secret redaction', () => {
  it('redacts secret-like object keys recursively', () => {
    expect(redactSecrets({
      apiKey: 'sk-test',
      nested: { Authorization: 'Bearer token-value' },
      safe: 'visible'
    })).toEqual({
      apiKey: '<redacted>',
      nested: { Authorization: '<redacted>' },
      safe: 'visible'
    })
  })

  it('redacts inline bearer and token text', () => {
    expect(redactSecretText('Authorization: Bearer abc123 token=secret-value')).toBe(
      'Authorization=<redacted> token=<redacted>'
    )
  })

  it('redacts naked MiMo Tokenplan keys', () => {
    expect(redactSecretText('failed with tp-123456789012345678901234')).toBe(
      'failed with <redacted>'
    )
  })
})

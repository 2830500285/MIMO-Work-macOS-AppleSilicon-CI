import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MIMO_RECHARGE_BASE_URL,
  DEFAULT_MIMO_TOKENPLAN_REGION,
  DEFAULT_MIMO_MODEL,
  MIMO_TOKENPLAN_REGION_BASE_URLS,
  defaultMimoCredentialSettings,
  isMimoTokenplanApiKey,
  mimoCredentialAuthContent,
  mimoCredentialProviderConfigPatch,
  normalizeMimoCredentialSettings
} from './mimo-credentials'

describe('MiMo credential settings', () => {
  it('defaults to Tokenplan cn without a stored key', () => {
    expect(defaultMimoCredentialSettings()).toMatchObject({
      mode: 'tokenplan',
      apiKey: '',
      region: DEFAULT_MIMO_TOKENPLAN_REGION,
      baseUrl: MIMO_TOKENPLAN_REGION_BASE_URLS.cn,
      model: DEFAULT_MIMO_MODEL,
      metadata: {
        mode: 'tokenplan',
        region: 'cn',
        base_url: MIMO_TOKENPLAN_REGION_BASE_URLS.cn
      }
    })
  })

  it('normalizes recharge mode to the recharge endpoint', () => {
    expect(normalizeMimoCredentialSettings({ mode: 'recharge', baseUrl: '' })).toMatchObject({
      mode: 'recharge',
      region: 'cn',
      baseUrl: DEFAULT_MIMO_RECHARGE_BASE_URL,
      metadata: {
        mode: 'recharge',
        base_url: DEFAULT_MIMO_RECHARGE_BASE_URL
      }
    })
  })

  it('uses Tokenplan region endpoints when no custom base URL is set', () => {
    expect(normalizeMimoCredentialSettings({ mode: 'tokenplan', region: 'ams' }).baseUrl).toBe(
      MIMO_TOKENPLAN_REGION_BASE_URLS.ams
    )
  })

  it('detects Tokenplan key shape without exposing a real key', () => {
    expect(isMimoTokenplanApiKey('tp-123456789012345678901234')).toBe(true)
    expect(isMimoTokenplanApiKey('sk-123456789012345678901234')).toBe(false)
  })

  it('builds MiMo auth content and provider config from normalized settings', () => {
    const credential = {
      mode: 'tokenplan' as const,
      apiKey: 'tp-test-key-for-unit-tests',
      region: 'sgp' as const,
      model: 'mimo-v2.5-pro-ultraspeed'
    }
    expect(mimoCredentialAuthContent(credential)).toEqual({
      xiaomi: {
        type: 'api',
        key: credential.apiKey,
        metadata: {
          mode: 'tokenplan',
          region: 'sgp',
          base_url: MIMO_TOKENPLAN_REGION_BASE_URLS.sgp
        }
      }
    })
    expect(mimoCredentialProviderConfigPatch(credential)).toMatchObject({
      provider: {
        xiaomi: {
          name: 'MiMo',
          api: MIMO_TOKENPLAN_REGION_BASE_URLS.sgp,
          options: {
            baseURL: MIMO_TOKENPLAN_REGION_BASE_URLS.sgp,
            setCacheKey: true
          }
        }
      },
      model: 'xiaomi/mimo-v2.5-pro-ultraspeed'
    })
  })
})

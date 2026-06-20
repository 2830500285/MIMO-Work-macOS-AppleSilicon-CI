import { describe, expect, it } from 'vitest'
import {
  getActiveAgentApiKey,
  getKunRuntimeSettings,
  getModelProviderSettings,
  normalizeAppSettings,
  resolveKunSpeechToTextSettings,
  resolveKunTextToSpeechSettings,
  type AppSettingsV1
} from '@shared/app-settings'
import {
  buildInitialSetupSettings,
  INITIAL_SETUP_PROVIDER_PRESETS,
  initialSetupAutoWirePlan,
  initialSetupDrafts,
  initialSetupProfileId,
  initialSetupSelection
} from './initial-setup-save'

function settings(patch: Record<string, unknown> = {}): AppSettingsV1 {
  return normalizeAppSettings(patch as AppSettingsV1)
}

function settingsWithActiveXiaomiWithoutKey(): AppSettingsV1 {
  return settings({
    provider: {
      apiKey: 'sk-mimo-key',
      baseUrl: 'https://api.mimo.com',
      providers: [
        { id: 'xiaomi', name: 'Xiaomi', baseUrl: 'https://api.xiaomimimo.com/v1', models: ['mimo-v2.5'] }
      ]
    },
    agents: { kun: { providerId: 'xiaomi' } }
  })
}

describe('initialSetupSelection', () => {
  it('preselects the active provider card when it is a known preset', () => {
    const selection = initialSetupSelection(settingsWithActiveXiaomiWithoutKey())
    expect(selection).toEqual({ presetId: 'xiaomi', mode: 'api' })
  })

  it('preselects the token plan mode for token plan profiles', () => {
    const current = settings({ agents: { kun: { providerId: 'xiaomi-token-plan' } } })
    expect(initialSetupSelection(current)).toEqual({ presetId: 'xiaomi', mode: 'token-plan' })
  })

  it('falls back to xiaomi token plan for unknown or empty active providers', () => {
    expect(initialSetupSelection(settings())).toEqual({ presetId: 'xiaomi', mode: 'token-plan' })
    expect(initialSetupSelection(settings({ agents: { kun: { providerId: 'custom-provider-2' } } })))
      .toEqual({ presetId: 'xiaomi', mode: 'token-plan' })
    expect(initialSetupSelection(settings({ agents: { kun: { providerId: 'litellm' } } })))
      .toEqual({ presetId: 'xiaomi', mode: 'token-plan' })
  })
})

describe('initialSetupDrafts', () => {
  it('seeds drafts from saved profiles and preset defaults', () => {
    const drafts = initialSetupDrafts(settingsWithActiveXiaomiWithoutKey())
    expect(drafts.xiaomi).toEqual({ apiKey: '', baseUrl: 'https://api.xiaomimimo.com/v1' })
    expect(drafts['xiaomi-token-plan']).toEqual({
      apiKey: 'sk-mimo-key',
      baseUrl: 'https://api.mimo.com'
    })
  })

  it('does not seed LiteLLM as an onboarding provider', () => {
    expect(initialSetupDrafts(settings()).litellm).toBeUndefined()
  })

  it('keeps coding and Moonshot presets out of onboarding', () => {
    const excludedIds = [
      'litellm',
      'zhipu-coding-plan',
      'zai-coding-plan',
      'kimi-code',
      'moonshot-cn',
      'moonshot-global'
    ]
    const drafts = initialSetupDrafts(settings())

    expect(INITIAL_SETUP_PROVIDER_PRESETS.map((preset) => preset.id)).toEqual(['xiaomi'])
    for (const id of excludedIds) {
      expect(drafts[id]).toBeUndefined()
      expect(initialSetupSelection(settings({ agents: { kun: { providerId: id } } })))
        .toEqual({ presetId: 'xiaomi', mode: 'token-plan' })
    }
  })
})

describe('buildInitialSetupSettings', () => {
  it('activates xiaomi so the boot gate sees the key the user typed', () => {
    const current = settings()
    const drafts = initialSetupDrafts(current)
    drafts.xiaomi = { ...drafts.xiaomi, apiKey: 'sk-mimo-key' }
    const next = buildInitialSetupSettings(current, drafts, { presetId: 'xiaomi', mode: 'api' })

    expect(getKunRuntimeSettings(next).providerId).toBe('xiaomi')
    expect(getActiveAgentApiKey(next)).toBe('sk-mimo-key')
  })

  it('syncs the xiaomi draft into the provider profile used by settings', () => {
    const current = settings({
      provider: {
        apiKey: 'sk-old',
        baseUrl: 'https://old.example/v1'
      },
      agents: { kun: { providerId: 'xiaomi' } }
    })
    const drafts = initialSetupDrafts(current)
    drafts.xiaomi = {
      apiKey: 'sk-new',
      baseUrl: 'https://new.example/v1'
    }

    const next = buildInitialSetupSettings(current, drafts, { presetId: 'xiaomi', mode: 'api' })
    const provider = getModelProviderSettings(next)
    const xiaomi = provider.providers.find((profile) => profile.id === 'xiaomi')

    expect(provider.apiKey).toBe('sk-old')
    expect(provider.baseUrl).toBe('https://old.example/v1')
    expect(xiaomi?.apiKey).toBe('sk-new')
    expect(xiaomi?.baseUrl).toBe('https://new.example/v1')
  })

  it('creates a token plan profile and activates it', () => {
    const current = settings()
    const drafts = initialSetupDrafts(current)
    drafts['xiaomi-token-plan'] = {
      apiKey: 'tp-subscription-key',
      baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1'
    }
    const next = buildInitialSetupSettings(current, drafts, { presetId: 'xiaomi', mode: 'token-plan' })

    const profile = getModelProviderSettings(next).providers.find((p) => p.id === 'xiaomi-token-plan')
    expect(profile?.apiKey).toBe('tp-subscription-key')
    expect(profile?.baseUrl).toBe('https://token-plan-sgp.xiaomimimo.com/v1')
    expect(profile?.endpointFormat).toBe('chat_completions')
    expect(profile?.speech).toEqual({
      protocol: 'mimo-asr',
      baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1',
      models: ['mimo-v2.5-asr']
    })
    expect(profile?.modelProfiles['mimo-v2.5']).toEqual(expect.objectContaining({
      inputModalities: expect.arrayContaining(['image']),
      messageParts: expect.arrayContaining(['image_url'])
    }))
    const runtime = getKunRuntimeSettings(next)
    expect(runtime.providerId).toBe('xiaomi-token-plan')
    expect(runtime.model).toBe('mimo-v2.5-pro')
    expect(getActiveAgentApiKey(next)).toBe('tp-subscription-key')
  })

  it('auto-wires speech to a filled pay-as-you-go profile', () => {
    const current = settings()
    const drafts = initialSetupDrafts(current)
    drafts.xiaomi = { ...drafts.xiaomi, apiKey: 'sk-mimo-key' }
    const next = buildInitialSetupSettings(current, drafts, { presetId: 'xiaomi', mode: 'api' })

    const runtime = getKunRuntimeSettings(next)
    expect(runtime.speechToText.enabled).toBe(true)
    expect(runtime.speechToText.providerId).toBe('xiaomi')
    expect(runtime.imageGeneration.enabled).toBe(true)
    expect(runtime.imageGeneration.providerId).toBe('')
    expect(getModelProviderSettings(next).providers.find((p) => p.id === 'xiaomi')?.speech?.protocol)
      .toBe('mimo-asr')
  })

  it('keeps media features enabled and resolves them from provider capabilities by default', () => {
    const current = settings({
      provider: { apiKey: 'tp-key' }
    })
    const runtime = getKunRuntimeSettings(current)
    expect(runtime.imageGeneration.enabled).toBe(true)
    expect(runtime.speechToText.enabled).toBe(true)
    expect(runtime.textToSpeech.enabled).toBe(true)
    expect(runtime.musicGeneration.enabled).toBe(true)
    expect(runtime.videoGeneration.enabled).toBe(true)

    expect(resolveKunSpeechToTextSettings(current)).toEqual(expect.objectContaining({
      providerId: 'xiaomi-token-plan',
      apiKey: 'tp-key',
      model: 'mimo-v2.5-asr'
    }))
    expect(resolveKunTextToSpeechSettings(current)).toEqual(expect.objectContaining({
      providerId: 'xiaomi-token-plan',
      apiKey: 'tp-key',
      model: 'mimo-v2.5-tts'
    }))
  })

  it('wires speech from a xiaomi token plan key', () => {
    const tokenPlanOnly = initialSetupDrafts(settings())
    tokenPlanOnly['xiaomi-token-plan'] = { ...tokenPlanOnly['xiaomi-token-plan'], apiKey: 'tp-key' }
    expect(initialSetupAutoWirePlan(settings(), tokenPlanOnly))
      .toEqual({ speechProviderId: 'xiaomi-token-plan', imageProviderId: '' })
  })

  it('never overrides existing speech or image generation config while auto-wiring', () => {
    const configured = settings({ agents: { kun: { speechToText: { providerId: 'custom' } } } })
    const drafts = initialSetupDrafts(configured)
    drafts.xiaomi = { ...drafts.xiaomi, apiKey: 'sk-mimo-key' }
    const next = buildInitialSetupSettings(configured, drafts, { presetId: 'xiaomi', mode: 'api' })
    expect(getKunRuntimeSettings(next).speechToText.providerId).toBe('custom')

    const imageConfigured = settings({ agents: { kun: { imageGeneration: { providerId: 'custom-image' } } } })
    const imageDrafts = initialSetupDrafts(imageConfigured)
    imageDrafts.xiaomi = { ...imageDrafts.xiaomi, apiKey: 'sk-mimo-key' }
    const nextImage = buildInitialSetupSettings(imageConfigured, imageDrafts, { presetId: 'xiaomi', mode: 'api' })
    expect(getKunRuntimeSettings(nextImage).imageGeneration.providerId).toBe('custom-image')
  })

  it('prefers the pay-as-you-go profile for speech when both keys are filled', () => {
    const drafts = initialSetupDrafts(settings())
    drafts.xiaomi = { ...drafts.xiaomi, apiKey: 'sk-mimo-key' }
    drafts['xiaomi-token-plan'] = { ...drafts['xiaomi-token-plan'], apiKey: 'tp-key' }
    expect(initialSetupAutoWirePlan(settings(), drafts).speechProviderId).toBe('xiaomi')
  })

  it('keeps the model override when the provider does not change', () => {
    const current = settings({
      provider: { apiKey: 'sk-mimo-key' },
      agents: { kun: { providerId: 'xiaomi', model: 'mimo-v2.5' } }
    })
    const next = buildInitialSetupSettings(current, initialSetupDrafts(current), {
      presetId: 'xiaomi',
      mode: 'api'
    })
    expect(getKunRuntimeSettings(next).model).toBe('mimo-v2.5')
  })

  it('preserves unrelated custom providers', () => {
    const current = settings({
      provider: {
        apiKey: 'sk-mimo-key',
        providers: [
          { id: 'custom-provider-2', name: 'zenmux', apiKey: 'z-key', baseUrl: 'https://zenmux.ai/api' }
        ]
      }
    })
    const next = buildInitialSetupSettings(current, initialSetupDrafts(current), {
      presetId: 'xiaomi',
      mode: 'api'
    })
    const zenmux = getModelProviderSettings(next).providers.find((p) => p.id === 'custom-provider-2')
    expect(zenmux?.apiKey).toBe('z-key')
  })
})

describe('initialSetupProfileId', () => {
  it('maps selection to profile ids', () => {
    expect(initialSetupProfileId({ presetId: 'xiaomi', mode: 'api' })).toBe('xiaomi')
    expect(initialSetupProfileId({ presetId: 'xiaomi', mode: 'token-plan' })).toBe('xiaomi-token-plan')
  })
})

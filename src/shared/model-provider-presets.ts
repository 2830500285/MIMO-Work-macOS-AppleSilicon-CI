import type {
  ImageGenerationProtocol,
  MusicGenerationProtocol,
  ModelEndpointFormat,
  ModelProviderImageCapabilityV1,
  ModelProviderMusicCapabilityV1,
  ModelProviderModelProfileV1,
  ModelProviderProfileV1,
  ModelProviderReasoningCapabilityV1,
  ModelProviderSpeechCapabilityV1,
  ModelProviderTextToSpeechCapabilityV1,
  ModelProviderVideoCapabilityV1,
  SpeechToTextProtocol,
  TextToSpeechProtocol,
  VideoGenerationProtocol
} from './app-settings-types'

export type ModelProviderPresetId = 'xiaomi'

export const TOKEN_PLAN_PROVIDER_ID_SUFFIX = '-token-plan'

export type ModelProviderTokenPlanRegion = {
  id: string
  baseUrl: string
}

export type ModelProviderTokenPlanPreset = {
  baseUrl: string
  /** Regional clusters. When present, baseUrl must equal the first region's baseUrl. */
  regions?: ModelProviderTokenPlanRegion[]
  endpointFormat: ModelEndpointFormat
  models: string[]
  modelProfiles?: Record<string, ModelProviderModelProfileV1>
  /** Speech capability served by the plan endpoint itself (baseUrl follows the plan baseUrl). */
  speech?: {
    protocol: SpeechToTextProtocol
    models: string[]
  }
  image?: {
    protocol: ImageGenerationProtocol
    baseUrl: string
    models: string[]
  }
  textToSpeech?: {
    protocol: TextToSpeechProtocol
    baseUrl?: string
    models: string[]
  }
  music?: {
    protocol: MusicGenerationProtocol
    baseUrl: string
    models: string[]
  }
  video?: {
    protocol: VideoGenerationProtocol
    baseUrl: string
    models: string[]
  }
  /** Expected key prefix, e.g. "tp-". Hint only, never enforced. */
  keyPrefix?: string
  apiKeyUrl: string
}

export type ModelProviderPreset = {
  id: ModelProviderPresetId
  name: string
  baseUrl: string
  endpointFormat: ModelEndpointFormat
  models: string[]
  modelProfiles?: Record<string, ModelProviderModelProfileV1>
  image?: {
    protocol: ImageGenerationProtocol
    baseUrl: string
    models: string[]
  }
  speech?: {
    protocol: SpeechToTextProtocol
    baseUrl: string
    models: string[]
  }
  textToSpeech?: {
    protocol: TextToSpeechProtocol
    baseUrl: string
    models: string[]
  }
  music?: {
    protocol: MusicGenerationProtocol
    baseUrl: string
    models: string[]
  }
  video?: {
    protocol: VideoGenerationProtocol
    baseUrl: string
    models: string[]
  }
  tokenPlan?: ModelProviderTokenPlanPreset
  docsUrl: string
  apiKeyUrl: string
}

const XIAOMI_REASONING: ModelProviderReasoningCapabilityV1 = {
  supportedEfforts: ['off', 'low', 'medium', 'high'],
  defaultEffort: 'high',
  requestProtocol: 'mimo-chat-completions'
}

export const MODEL_PROVIDER_PRESETS: ModelProviderPreset[] = [
  {
    id: 'xiaomi',
    name: 'MIMO',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    endpointFormat: 'chat_completions',
    models: [
      'mimo-v2.5-pro-ultraspeed',
      'mimo-v2.5-pro',
      'mimo-v2.5',
      'mimo-v2-pro',
      'mimo-v2-omni',
      'mimo-v2-flash'
    ],
    modelProfiles: {
      'mimo-v2.5-pro-ultraspeed': xiaomiTextChatProfile(1_000_000),
      'mimo-v2.5-pro': xiaomiTextChatProfile(1_000_000),
      'mimo-v2.5': xiaomiVisionChatProfile(1_000_000),
      'mimo-v2-pro': xiaomiTextChatProfile(1_000_000),
      'mimo-v2-omni': xiaomiVisionChatProfile(256_000),
      'mimo-v2-flash': xiaomiTextChatProfile(256_000)
    },
    speech: {
      protocol: 'mimo-asr',
      baseUrl: 'https://api.xiaomimimo.com/v1',
      models: ['mimo-v2.5-asr']
    },
    textToSpeech: {
      protocol: 'mimo-tts',
      baseUrl: 'https://api.xiaomimimo.com/v1',
      models: ['mimo-v2.5-tts', 'mimo-v2.5-tts-voicedesign', 'mimo-v2.5-tts-voiceclone']
    },
    tokenPlan: {
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
      regions: [
        { id: 'cn', baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1' },
        { id: 'sgp', baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1' },
        { id: 'ams', baseUrl: 'https://token-plan-ams.xiaomimimo.com/v1' }
      ],
      endpointFormat: 'chat_completions',
      models: [
        'mimo-v2.5-pro-ultraspeed',
        'mimo-v2.5-pro',
        'mimo-v2.5',
        'mimo-v2-pro',
        'mimo-v2-omni',
        'mimo-v2-flash'
      ],
      modelProfiles: {
        'mimo-v2.5-pro-ultraspeed': xiaomiTextChatProfile(1_000_000),
        'mimo-v2.5-pro': xiaomiTextChatProfile(1_000_000),
        'mimo-v2.5': xiaomiVisionChatProfile(1_000_000),
        'mimo-v2-pro': xiaomiTextChatProfile(1_000_000),
        'mimo-v2-omni': xiaomiVisionChatProfile(256_000),
        'mimo-v2-flash': xiaomiTextChatProfile(256_000)
      },
      speech: {
        protocol: 'mimo-asr',
        models: ['mimo-v2.5-asr']
      },
      textToSpeech: {
        protocol: 'mimo-tts',
        models: ['mimo-v2.5-tts', 'mimo-v2.5-tts-voicedesign', 'mimo-v2.5-tts-voiceclone']
      },
      keyPrefix: 'tp-',
      apiKeyUrl: 'https://platform.xiaomimimo.com/docs/en-US/price/tokenplan/quick-access'
    },
    docsUrl: 'https://platform.xiaomimimo.com/#/docs',
    apiKeyUrl: 'https://platform.xiaomimimo.com/#/console/api-keys'
  }
]

export function getModelProviderPreset(id: string): ModelProviderPreset | null {
  return MODEL_PROVIDER_PRESETS.find((preset) => preset.id === id) ?? null
}

export function modelProviderPresetProfile(
  preset: ModelProviderPreset,
  apiKey = ''
): ModelProviderProfileV1 {
  return {
    id: preset.id,
    name: preset.name,
    apiKey: apiKey.trim(),
    baseUrl: preset.baseUrl,
    endpointFormat: preset.endpointFormat,
    models: [...preset.models],
    modelProfiles: copyModelProfiles(preset.modelProfiles),
    ...(preset.image ? { image: modelProviderPresetImageCapability(preset.image) } : {}),
    ...(preset.speech ? { speech: modelProviderPresetSpeechCapability(preset.speech) } : {}),
    ...(preset.textToSpeech
      ? { textToSpeech: modelProviderPresetTextToSpeechCapability(preset.textToSpeech) }
      : {}),
    ...(preset.music ? { music: modelProviderPresetMusicCapability(preset.music) } : {}),
    ...(preset.video ? { video: modelProviderPresetVideoCapability(preset.video) } : {})
  }
}

export function tokenPlanProviderId(presetId: string): string {
  return `${presetId}${TOKEN_PLAN_PROVIDER_ID_SUFFIX}`
}

export function modelProviderTokenPlanProfile(
  preset: ModelProviderPreset,
  apiKey = '',
  baseUrl = ''
): ModelProviderProfileV1 | null {
  const tokenPlan = preset.tokenPlan
  if (!tokenPlan) return null
  const resolvedBaseUrl = baseUrl.trim() || tokenPlan.baseUrl
  return {
    id: tokenPlanProviderId(preset.id),
    name: `${preset.name} Token Plan`,
    apiKey: apiKey.trim(),
    baseUrl: resolvedBaseUrl,
    endpointFormat: tokenPlan.endpointFormat,
    models: [...tokenPlan.models],
    modelProfiles: copyModelProfiles(tokenPlan.modelProfiles),
    ...(tokenPlan.image
      ? {
          image: {
            protocol: tokenPlan.image.protocol,
            baseUrl: tokenPlanCapabilityBaseUrl(tokenPlan, resolvedBaseUrl, tokenPlan.image.baseUrl),
            models: [...tokenPlan.image.models]
          }
        }
      : {}),
    ...(tokenPlan.speech
      ? {
          speech: {
            protocol: tokenPlan.speech.protocol,
            baseUrl: resolvedBaseUrl,
            models: [...tokenPlan.speech.models]
          }
        }
      : {}),
    ...(tokenPlan.textToSpeech
      ? {
          textToSpeech: {
            protocol: tokenPlan.textToSpeech.protocol,
            baseUrl: tokenPlanCapabilityBaseUrl(tokenPlan, resolvedBaseUrl, tokenPlan.textToSpeech.baseUrl),
            models: [...tokenPlan.textToSpeech.models]
          }
        }
      : {}),
    ...(tokenPlan.music
      ? {
          music: {
            protocol: tokenPlan.music.protocol,
            baseUrl: tokenPlanCapabilityBaseUrl(tokenPlan, resolvedBaseUrl, tokenPlan.music.baseUrl),
            models: [...tokenPlan.music.models]
          }
        }
      : {}),
    ...(tokenPlan.video
      ? {
          video: {
            protocol: tokenPlan.video.protocol,
            baseUrl: tokenPlanCapabilityBaseUrl(tokenPlan, resolvedBaseUrl, tokenPlan.video.baseUrl),
            models: [...tokenPlan.video.models]
          }
        }
      : {})
  }
}

function tokenPlanCapabilityBaseUrl(
  tokenPlan: ModelProviderTokenPlanPreset,
  resolvedBaseUrl: string,
  capabilityBaseUrl: string | undefined
): string {
  const fallback = capabilityBaseUrl?.trim() || resolvedBaseUrl
  if (!capabilityBaseUrl?.trim()) return resolvedBaseUrl
  const resolvedOrigin = urlOrigin(resolvedBaseUrl)
  const capabilityOrigin = urlOrigin(capabilityBaseUrl)
  if (!resolvedOrigin || !capabilityOrigin) return fallback
  const planOrigins = [
    tokenPlan.baseUrl,
    ...(tokenPlan.regions?.map((region) => region.baseUrl) ?? [])
  ].map(urlOrigin).filter((origin): origin is string => Boolean(origin))
  if (!planOrigins.includes(capabilityOrigin)) return fallback
  return replaceUrlOrigin(capabilityBaseUrl, resolvedOrigin)
}

function urlOrigin(value: string | undefined): string | null {
  if (!value?.trim()) return null
  try {
    return new URL(value.trim()).origin
  } catch {
    return null
  }
}

function replaceUrlOrigin(value: string, origin: string): string {
  try {
    const url = new URL(value.trim())
    const path = url.pathname.replace(/\/+$/, '')
    return `${origin}${path === '/' ? '' : path}${url.search}`
  } catch {
    return value.trim()
  }
}

function xiaomiTextChatProfile(contextWindowTokens: number): ModelProviderModelProfileV1 {
  return textChatProfile(contextWindowTokens, XIAOMI_REASONING)
}

function xiaomiVisionChatProfile(contextWindowTokens: number): ModelProviderModelProfileV1 {
  return visionChatProfile(contextWindowTokens, XIAOMI_REASONING)
}

function textChatProfile(
  contextWindowTokens?: number,
  reasoning?: ModelProviderReasoningCapabilityV1
): ModelProviderModelProfileV1 {
  return {
    ...(contextWindowTokens ? { contextWindowTokens } : {}),
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportsToolCalling: true,
    messageParts: ['text'],
    ...(reasoning ? { reasoning } : {})
  }
}

function visionChatProfile(
  contextWindowTokens?: number,
  reasoning?: ModelProviderReasoningCapabilityV1
): ModelProviderModelProfileV1 {
  return {
    ...(contextWindowTokens ? { contextWindowTokens } : {}),
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    supportsToolCalling: true,
    messageParts: ['text', 'image_url'],
    ...(reasoning ? { reasoning } : {})
  }
}

function copyModelProfiles(
  profiles: Record<string, ModelProviderModelProfileV1> | undefined
): Record<string, ModelProviderModelProfileV1> {
  if (!profiles) return {}
  return Object.fromEntries(
    Object.entries(profiles).map(([modelId, profile]) => [
      modelId,
      {
        ...profile,
        ...(profile.aliases ? { aliases: [...profile.aliases] } : {}),
        inputModalities: [...profile.inputModalities],
        outputModalities: [...profile.outputModalities],
        messageParts: [...profile.messageParts],
        ...(profile.reasoning
          ? {
              reasoning: {
                supportedEfforts: [...profile.reasoning.supportedEfforts],
                defaultEffort: profile.reasoning.defaultEffort,
                requestProtocol: profile.reasoning.requestProtocol
              }
            }
          : {})
      }
    ])
  )
}

function modelProviderPresetImageCapability(
  capability: NonNullable<ModelProviderPreset['image']>
): ModelProviderImageCapabilityV1 {
  return {
    protocol: capability.protocol,
    baseUrl: capability.baseUrl,
    models: [...capability.models]
  }
}

function modelProviderPresetSpeechCapability(
  capability: NonNullable<ModelProviderPreset['speech']>
): ModelProviderSpeechCapabilityV1 {
  return {
    protocol: capability.protocol,
    baseUrl: capability.baseUrl,
    models: [...capability.models]
  }
}

function modelProviderPresetTextToSpeechCapability(
  capability: NonNullable<ModelProviderPreset['textToSpeech']>
): ModelProviderTextToSpeechCapabilityV1 {
  return {
    protocol: capability.protocol,
    baseUrl: capability.baseUrl,
    models: [...capability.models]
  }
}

function modelProviderPresetMusicCapability(
  capability: NonNullable<ModelProviderPreset['music']>
): ModelProviderMusicCapabilityV1 {
  return {
    protocol: capability.protocol,
    baseUrl: capability.baseUrl,
    models: [...capability.models]
  }
}

function modelProviderPresetVideoCapability(
  capability: NonNullable<ModelProviderPreset['video']>
): ModelProviderVideoCapabilityV1 {
  return {
    protocol: capability.protocol,
    baseUrl: capability.baseUrl,
    models: [...capability.models]
  }
}

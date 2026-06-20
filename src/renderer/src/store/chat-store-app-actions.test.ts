import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type i18next from 'i18next'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import {
  fallbackComposerModel,
  mergeComposerPickList,
  persistComposerModel,
  readStoredComposerModel
} from './chat-store-helpers'
import { createAppActions } from './chat-store-app-actions'

const COMPOSER_MODEL_STORAGE_KEY = 'kun.composerModel'
const COMPOSER_PROVIDER_STORAGE_KEY = 'kun.composerProviderId'

function createMemoryStorage(): Storage {
  const items = new Map<string, string>()
  return {
    get length() {
      return items.size
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key)
    },
    setItem: (key, value) => {
      items.set(key, value)
    }
  }
}

type FetchModelsResult =
  | {
    ok: true
    modelIds: string[]
    defaultModelId?: string
    defaultProviderId?: string
    modelGroups?: ChatState['composerModelGroups']
  }
  | { ok: false; message: string }

function buildHarness(fetchModelsResult: FetchModelsResult): {
  actions: ReturnType<typeof createAppActions>
  state: ChatState
} {
  let state = {
    composerModel: '',
    composerProviderId: '',
    composerPickList: mergeComposerPickList(false, []),
    composerModelGroups: []
  } as unknown as ChatState
  let loadPromise: Promise<void> | null = null
  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state

  vi.stubGlobal('window', {
    kunGui: {
      fetchUpstreamModels: vi.fn(async () => fetchModelsResult),
      saveSettingsSilent: vi.fn(async () => state)
    }
  })

  return {
    state,
    actions: createAppActions({
      set,
      get,
      i18n: { t: (key: string) => key, changeLanguage: vi.fn(async () => undefined) } as unknown as typeof i18next,
      persistComposerModel,
      readStoredComposerModel,
      mergeComposerPickList,
      fallbackComposerModel,
      getComposerModelLoadPromise: () => loadPromise,
      setComposerModelLoadPromise: (promise) => {
        loadPromise = promise
      },
      applyTheme: () => undefined,
      applyUiFontScale: () => undefined,
      applyDocumentLocale: () => undefined,
      workspaceLabelFromPath: (workspaceRoot) => workspaceRoot,
      normalizeWorkspaceRoot: (workspaceRoot) => workspaceRoot?.trim() ?? ''
    })
  }
}

describe('chat-store app actions composer model loading', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('restores the previously selected custom model after the full model list loads', async () => {
    localStorage.setItem(COMPOSER_MODEL_STORAGE_KEY, 'MIMO-M2')
    const { actions, state } = buildHarness({
      ok: true,
      modelIds: ['MIMO-M2'],
      defaultModelId: 'mimo-v2.5-pro',
      modelGroups: [{
        providerId: 'mimo',
        label: 'MIMO',
        modelIds: ['MIMO-M2']
      }]
    })

    await actions.loadComposerModels()

    expect(state.composerModel).toBe('MIMO-M2')
    expect(state.composerProviderId).toBe('mimo')
    expect(localStorage.getItem(COMPOSER_MODEL_STORAGE_KEY)).toBe('MIMO-M2')
    expect(localStorage.getItem(COMPOSER_PROVIDER_STORAGE_KEY)).toBe('mimo')
  })

  it('updates the composer provider when the picker supplies a provider id', () => {
    const { actions, state } = buildHarness({
      ok: true,
      modelIds: ['MIMO-M2'],
      defaultModelId: 'mimo-v2.5-pro',
      modelGroups: [{
        providerId: 'mimo',
        label: 'MIMO',
        modelIds: ['MIMO-M2']
      }]
    })
    state.composerModelGroups = [{
      providerId: 'mimo',
      label: 'MIMO',
      modelIds: ['MIMO-M2']
    }]

    actions.setComposerModel('MIMO-M2', 'mimo')

    expect(state.composerModel).toBe('MIMO-M2')
    expect(state.composerProviderId).toBe('mimo')
    expect(localStorage.getItem(COMPOSER_PROVIDER_STORAGE_KEY)).toBe('mimo')
    expect(window.kunGui.saveSettingsSilent).toHaveBeenCalledWith({
      agents: { kun: { model: 'MIMO-M2', providerId: 'mimo' } }
    })
  })

  it('follows the runtime default provider from settings instead of an older composer cache', async () => {
    localStorage.setItem(COMPOSER_MODEL_STORAGE_KEY, 'mimo-v2.5-pro')
    localStorage.setItem(COMPOSER_PROVIDER_STORAGE_KEY, 'mimo')
    const { actions, state } = buildHarness({
      ok: true,
      modelIds: ['mimo-v2.5-pro', 'due/default'],
      defaultModelId: 'due/default',
      defaultProviderId: 'custom-provider-2',
      modelGroups: [
        {
          providerId: 'mimo',
          label: 'MIMO',
          modelIds: ['mimo-v2.5-pro']
        },
        {
          providerId: 'custom-provider-2',
          label: '自定义供应商 2',
          modelIds: ['due/default']
        }
      ]
    })
    state.composerModel = 'mimo-v2.5-pro'
    state.composerProviderId = 'mimo'

    await actions.loadComposerModels()

    expect(state.composerModel).toBe('due/default')
    expect(state.composerProviderId).toBe('custom-provider-2')
    expect(localStorage.getItem(COMPOSER_MODEL_STORAGE_KEY)).toBe('due/default')
    expect(localStorage.getItem(COMPOSER_PROVIDER_STORAGE_KEY)).toBe('custom-provider-2')
  })

  it('does not overwrite a stored custom model when only fallback models are available', async () => {
    localStorage.setItem(COMPOSER_MODEL_STORAGE_KEY, 'MIMO-M2')
    const { actions, state } = buildHarness({
      ok: false,
      message: 'upstream unavailable'
    })

    await actions.loadComposerModels()

    expect(state.composerModel).toBe('mimo-v2.5-pro')
    expect(localStorage.getItem(COMPOSER_MODEL_STORAGE_KEY)).toBe('MIMO-M2')
  })
})

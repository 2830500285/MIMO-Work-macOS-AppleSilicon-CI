import {
  DEFAULT_GUI_UPDATE_CHANNEL,
  normalizeGuiUpdateChannel,
  type AppBehaviorConfigV1,
  type AppSettingsV1,
  type ClawSettingsPatchV1,
  type GuiUpdateConfigV1,
  type NotificationConfigV1,
  type ScheduleSettingsPatchV1,
  type WriteSettingsPatchV1
} from './app-settings-types'
import { normalizeKeyboardShortcuts, type KeyboardShortcutsConfigV1 } from './keyboard-shortcuts'
import {
  defaultKunRuntimeSettings,
  getKunRuntimeSettings,
  kunSettingsEnvelope,
  mergeKunRuntimeSettings
} from './app-settings-kun'
import { normalizeModelProviderSettings } from './app-settings-provider'
import { normalizeEnvironmentProjects, normalizeLogRetentionDays, normalizeMimoBaseUrl } from './app-settings-normalizers'
import { normalizeClawSettings } from './app-settings-claw'
import { normalizeScheduleSettings } from './app-settings-schedule'
import { normalizeWriteSettings } from './app-settings-write'

export function normalizeAppSettings(settings: AppSettingsV1): AppSettingsV1 {
  const migrated = settings
  const maybeSettings = migrated as AppSettingsV1 & {
    appBehavior?: Partial<AppBehaviorConfigV1>
    keyboardShortcuts?: Partial<KeyboardShortcutsConfigV1>
    notifications?: Partial<NotificationConfigV1>
    provider?: Parameters<typeof normalizeModelProviderSettings>[0]
    environmentProjects?: unknown
    write?: WriteSettingsPatchV1
    claw?: ClawSettingsPatchV1
    schedule?: ScheduleSettingsPatchV1
    guiUpdate?: Partial<GuiUpdateConfigV1>
  }
  const providerSettings = normalizeModelProviderSettings(maybeSettings.provider)
  const runtime = getKunRuntimeSettings(maybeSettings)
  return {
    ...migrated,
    version: 1,
    locale: maybeSettings.locale === 'zh' ? 'zh' : 'en',
    theme:
      maybeSettings.theme === 'light' || maybeSettings.theme === 'dark' || maybeSettings.theme === 'system'
        ? maybeSettings.theme
        : 'system',
    uiFontScale:
      maybeSettings.uiFontScale === 'small' ||
      maybeSettings.uiFontScale === 'medium' ||
      maybeSettings.uiFontScale === 'large'
        ? maybeSettings.uiFontScale
        : 'small',
    provider: providerSettings,
    agents: kunSettingsEnvelope(mergeKunRuntimeSettings(defaultKunRuntimeSettings(), {
      ...runtime,
      baseUrl: runtime.baseUrl.trim() ? normalizeMimoBaseUrl(runtime.baseUrl) : ''
    })),
    workspaceRoot: typeof maybeSettings.workspaceRoot === 'string' ? maybeSettings.workspaceRoot : '',
    environmentProjects: normalizeEnvironmentProjects(maybeSettings.environmentProjects),
    log: {
      enabled: maybeSettings.log?.enabled !== false,
      retentionDays: normalizeLogRetentionDays(maybeSettings.log?.retentionDays)
    },
    notifications: {
      turnComplete: maybeSettings.notifications?.turnComplete !== false
    },
    appBehavior: normalizeAppBehaviorSettings(maybeSettings.appBehavior),
    keyboardShortcuts: normalizeKeyboardShortcuts(maybeSettings.keyboardShortcuts),
    write: normalizeWriteSettings(maybeSettings.write),
    claw: normalizeClawSettings(maybeSettings.claw),
    schedule: normalizeScheduleSettings(maybeSettings.schedule),
    guiUpdate: {
      channel: normalizeGuiUpdateChannel(
        maybeSettings.guiUpdate?.channel ?? DEFAULT_GUI_UPDATE_CHANNEL
      )
    },
    codePromptPrefix: typeof maybeSettings.codePromptPrefix === 'string' ? maybeSettings.codePromptPrefix : '',
    disabledSkillIds: normalizeDisabledSkillIds(maybeSettings.disabledSkillIds)
  }
}

function normalizeDisabledSkillIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((id): id is string => typeof id === 'string')
    .map((id) => id.trim().replace(/^\/?skill:/i, '').trim())
    .filter(Boolean))]
}

export function normalizeAppBehaviorSettings(
  settings?: Partial<AppBehaviorConfigV1>
): AppBehaviorConfigV1 {
  const openAtLogin = settings?.openAtLogin === true
  return {
    openAtLogin,
    startMinimized: openAtLogin && settings?.startMinimized === true,
    closeToTray: settings?.closeToTray === true
  }
}

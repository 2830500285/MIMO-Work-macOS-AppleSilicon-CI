import { readBrowserStorageItem, writeBrowserStorageItem } from './browser-storage'
import { IKUN_MODE_STORAGE_KEY } from './ikun-mode'

/**
 * 形象模式偏好:'default' | <UI 插件 id>。
 * 旧版主题开关读取时回落到默认模式,避免重新点亮已退役皮肤。
 */
export const UI_MODE_STORAGE_KEY = 'kun.uiMode'

export const UI_MODE_DEFAULT = 'default'
export const UI_MODE_IKUN = 'ikun'

const UI_MODE_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/

export function readUiModePreference(): string {
  const stored = readBrowserStorageItem(UI_MODE_STORAGE_KEY)?.trim().toLowerCase()
  if (stored === UI_MODE_IKUN) return UI_MODE_DEFAULT
  if (stored && (stored === UI_MODE_DEFAULT || UI_MODE_PATTERN.test(stored))) {
    return stored
  }
  return UI_MODE_DEFAULT
}

export function writeUiModePreference(mode: string): void {
  const normalized = mode.trim().toLowerCase() === UI_MODE_IKUN ? UI_MODE_DEFAULT : mode
  writeBrowserStorageItem(UI_MODE_STORAGE_KEY, normalized)
  // 同步旧键,兼容尚未迁移的读取方
  writeBrowserStorageItem(IKUN_MODE_STORAGE_KEY, '0')
}

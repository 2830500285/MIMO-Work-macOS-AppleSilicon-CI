import {
  DEFAULT_MIMO_BASE_URL,
  type ClawImProvider,
  type ClawRunMode,
  type EnvironmentProjectV1,
  type ScheduleKind,
  type ScheduleModel,
  type ScheduleReasoningEffort,
  type ScheduleTaskStatus
} from './app-settings-types'

export function normalizeMimoBaseUrl(baseUrl: string | null | undefined): string {
  const trimmed = typeof baseUrl === 'string' ? baseUrl.trim() : ''
  return trimmed || DEFAULT_MIMO_BASE_URL
}

export function compactStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

export function normalizeEnvironmentProjects(value: unknown): EnvironmentProjectV1[] {
  if (!Array.isArray(value)) return []
  const out: EnvironmentProjectV1[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const path = typeof item === 'object' && item !== null && 'path' in item
      ? String((item as { path?: unknown }).path ?? '').trim()
      : typeof item === 'string'
        ? item.trim()
        : ''
    if (!path || seen.has(path)) continue
    seen.add(path)
    out.push({
      path,
      setupCommand: typeof item === 'object' && item !== null && 'setupCommand' in item
        ? String((item as { setupCommand?: unknown }).setupCommand ?? '').trim()
        : ''
    })
  }
  return out
}

export function normalizeLogRetentionDays(value: unknown, fallback = 7): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const days = Math.trunc(value)
  if (days === 0) return 0
  if (days < 0) return fallback
  return Math.min(days, 3650)
}

export function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function normalizePositiveInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

export function normalizeRunMode(value: unknown): ClawRunMode {
  return value === 'plan' ? 'plan' : 'agent'
}

export function normalizeImProvider(value: unknown): ClawImProvider {
  return value === 'weixin' ? 'weixin' : 'feishu'
}

export function normalizeClawModel(value: unknown): string {
  if (typeof value !== 'string') return 'auto'
  const trimmed = value.trim()
  return trimmed || 'auto'
}

export function normalizeScheduleModel(value: unknown): ScheduleModel {
  return value === 'mimo-v2-flash' ? 'mimo-v2-flash' : 'mimo-v2.5-pro'
}

export function normalizeScheduleReasoningEffort(value: unknown): ScheduleReasoningEffort {
  if (value === 'auto' || value === 'off' || value === 'low' || value === 'medium' || value === 'high' || value === 'max') return value
  return 'medium'
}

export function normalizeScheduleKind(value: unknown): ScheduleKind {
  if (value === 'interval' || value === 'daily' || value === 'at') return value
  return 'manual'
}

export function normalizeTimeOfDay(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : '09:00'
}

export function normalizeAtTime(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return ''
  const parsed = new Date(raw)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : ''
}

export function normalizePathSegment(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return '/claw/im'
  return raw.startsWith('/') ? raw : `/${raw}`
}

export function normalizeStatus(value: unknown): ScheduleTaskStatus {
  if (value === 'running' || value === 'success' || value === 'error') return value
  return 'idle'
}

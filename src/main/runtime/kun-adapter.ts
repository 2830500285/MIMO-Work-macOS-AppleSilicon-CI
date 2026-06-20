import { homedir } from 'node:os'
import {
  DEFAULT_KUN_DATA_DIR,
  getKunRuntimeSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import { mimoWorkRuntimeAdapter } from './mimo-work-adapter'

export type ManagedRuntimeAdapter = {
  id: 'mimo-work'
  resolveExecutable(settings: AppSettingsV1): Promise<string>
  ensureRunning(settings: AppSettingsV1): Promise<void>
  stopAndWait(): Promise<void>
  isChildRunning(): boolean
  getBaseUrl(settings: AppSettingsV1): string
  reclaimPort(port: number): Promise<{ ok: true } | { ok: false; message: string }>
  resolveAvailablePort(port: number): Promise<{ port: number; changed: boolean; message?: string }>
}

export const kunRuntimeAdapter: ManagedRuntimeAdapter = mimoWorkRuntimeAdapter

export function managedRuntimeAdapterForSettings(settings: AppSettingsV1): ManagedRuntimeAdapter {
  void settings
  return mimoWorkRuntimeAdapter
}

export function getRuntimeBaseUrlForSettings(settings: AppSettingsV1): string {
  return managedRuntimeAdapterForSettings(settings).getBaseUrl(settings)
}

/** Build the bearer-token authorization header for the local MIMO Work runtime. */
export function runtimeAuthHeaders(settings: AppSettingsV1): Headers {
  const runtime = getKunRuntimeSettings(settings)
  const headers = new Headers()
  if (runtime.runtimeToken.trim()) {
    headers.set('Authorization', `Bearer ${runtime.runtimeToken.trim()}`)
  }
  return headers
}

export type RuntimeRequestInit = {
  method?: string
  body?: string
  headers?: Record<string, string>
}

export async function runtimeRequestViaHost(
  settings: AppSettingsV1,
  pathAndQuery: string,
  init: RuntimeRequestInit,
  ensureRuntime: (settings: AppSettingsV1) => Promise<AppSettingsV1 | void>
): Promise<{ ok: boolean; status: number; body: string }> {
  const ensuredSettings = await ensureRuntime(settings)
  const requestSettings = ensuredSettings ?? settings
  const base = getRuntimeBaseUrlForSettings(requestSettings)
  const pathNorm = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`
  const url = `${base}${pathNorm}`
  const hdrs = runtimeAuthHeaders(requestSettings)
  for (const [key, value] of Object.entries(init.headers ?? {})) {
    hdrs.set(key, value)
  }
  hdrs.set('Accept', 'application/json')
  if (init.body && !hdrs.has('Content-Type')) {
    hdrs.set('Content-Type', 'application/json')
  }
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: hdrs,
    body: init.body,
    signal: AbortSignal.timeout(init.method === 'POST' ? 60_000 : 15_000)
  })
  const text = await res.text()
  return { ok: res.ok, status: res.status, body: text }
}

/**
 * Default data directory used when the user has not provided one.
 * The path lives under the app user-data directory so packaged
 * installs do not need write access to the install folder.
 */
export function defaultKunDataDir(): string {
  return DEFAULT_KUN_DATA_DIR.replace(/^~(?=$|[\\/])/, homedir())
}

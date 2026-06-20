import type { BrowserWindow } from 'electron'

export type NavigationDecision = 'allow' | 'deny' | 'external'

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

function parseUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl)
  } catch {
    return null
  }
}

function normalizeFilePathname(url: URL): string {
  return decodeURIComponent(url.pathname).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function isSafeExternalNavigationUrl(rawUrl: string): boolean {
  const parsed = parseUrl(rawUrl)
  return !!parsed && EXTERNAL_PROTOCOLS.has(parsed.protocol)
}

export function isAllowedAppShellNavigation(rawUrl: string, appShellUrl: string): boolean {
  const target = parseUrl(rawUrl)
  const shellUrl = parseUrl(appShellUrl)
  if (!target || !shellUrl) return false

  if (shellUrl.protocol === 'http:' || shellUrl.protocol === 'https:') {
    return target.origin === shellUrl.origin
  }

  if (shellUrl.protocol === 'file:') {
    return target.protocol === 'file:' &&
      normalizeFilePathname(target) === normalizeFilePathname(shellUrl)
  }

  return false
}

export function decideMainWindowNavigation(rawUrl: string, appShellUrl: string): NavigationDecision {
  if (isAllowedAppShellNavigation(rawUrl, appShellUrl)) return 'allow'
  if (isSafeExternalNavigationUrl(rawUrl)) return 'external'
  return 'deny'
}

export function installMainWindowNavigationGuard(
  window: BrowserWindow,
  appShellUrl: string,
  openExternal?: (url: string) => Promise<void>
): void {
  const handleExternal = (url: string): void => {
    const opener = openExternal ?? (async (target: string) => {
      const electron = await import('electron')
      await electron.shell.openExternal(target)
    })
    void opener(url).catch(() => undefined)
  }

  window.webContents.on('will-navigate', (event, navigationUrl) => {
    const decision = decideMainWindowNavigation(navigationUrl, appShellUrl)
    if (decision === 'allow') return
    event.preventDefault()
    if (decision === 'external') handleExternal(navigationUrl)
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    const decision = decideMainWindowNavigation(url, appShellUrl)
    if (decision === 'external') handleExternal(url)
    return { action: 'deny' }
  })
}

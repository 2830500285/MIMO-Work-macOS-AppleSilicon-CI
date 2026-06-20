import { describe, expect, it } from 'vitest'
import {
  decideMainWindowNavigation,
  isAllowedAppShellNavigation,
  isSafeExternalNavigationUrl
} from './navigation-guard'

describe('main window navigation guard', () => {
  const appShell = 'file:///Applications/MIMO%20Work.app/Contents/Resources/app.asar/out/renderer/index.html'

  it('allows the packaged app shell itself', () => {
    expect(isAllowedAppShellNavigation(appShell, appShell)).toBe(true)
    expect(decideMainWindowNavigation(appShell, appShell)).toBe('allow')
  })

  it('blocks packaged renderer assets from becoming top-level pages', () => {
    const rawAsset = 'file:///Applications/MIMO%20Work.app/Contents/Resources/app.asar/out/renderer/assets/yaml-B_vW5iTY.js'

    expect(isAllowedAppShellNavigation(rawAsset, appShell)).toBe(false)
    expect(decideMainWindowNavigation(rawAsset, appShell)).toBe('deny')
  })

  it('routes safe external URLs outside Electron', () => {
    expect(isSafeExternalNavigationUrl('https://github.com/NousResearch/hermes-agent')).toBe(true)
    expect(isSafeExternalNavigationUrl('mailto:hello@example.com')).toBe(true)
    expect(decideMainWindowNavigation('https://github.com/NousResearch/hermes-agent', appShell)).toBe('external')
  })

  it('rejects unsafe or non-page protocols', () => {
    expect(isSafeExternalNavigationUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalNavigationUrl('file:///tmp/secret.txt')).toBe(false)
    expect(decideMainWindowNavigation('javascript:alert(1)', appShell)).toBe('deny')
    expect(decideMainWindowNavigation('about:blank', appShell)).toBe('deny')
  })

  it('allows dev-server same-origin navigation during development', () => {
    const devShell = 'http://127.0.0.1:5173/'

    expect(decideMainWindowNavigation('http://127.0.0.1:5173/assets/index.js', devShell)).toBe('allow')
    expect(decideMainWindowNavigation('http://127.0.0.1:4173/assets/index.js', devShell)).toBe('external')
  })
})

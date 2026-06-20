import type { ReactElement } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  CheckCircle2,
  ChevronLeft,
  Loader2,
  LogOut,
  MessageSquare,
  Plus,
  QrCode,
  RefreshCw,
  Settings
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  ClawImAgentProfileV1,
  ClawImChannelV1,
  ClawImPlatformCredentialV1,
  ClawImProvider,
  ClawImSettingsV1,
  ClawModel
} from '@shared/app-settings'
import type { ClawImInstallPollResult, ClawImInstallQrResult } from '@shared/kun-gui-api'
import { confirmDialog } from '../../lib/confirm-dialog'
import {
  type ClawInstallQrState,
  type ClawInstallTarget,
  clawInstallTargetLabel,
  formatClawInstallError
} from './SidebarClawDialogHelpers'
import { ClawProviderLogo } from './SidebarClaw'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'

type AddClawPhoneChannel = (
  provider: ClawImProvider,
  agentProfile: ClawImAgentProfileV1,
  platformCredential: ClawImPlatformCredentialV1,
  options: {
    model: ClawModel
    enabled: boolean
    im: Partial<ClawImSettingsV1>
    preserveRoute?: boolean
  }
) => Promise<void>

type Props = {
  channels: ClawImChannelV1[]
  onAddProvider: AddClawPhoneChannel
  leftSidebarCollapsed: boolean
  onToggleSidebar: () => void
  onBack: () => void
}

type FeishuInstallRequest = {
  provider: 'feishu'
  options: { isLark: boolean }
}

type WeixinInstallRequest = {
  provider: 'weixin'
  options?: { isLark?: boolean }
}

type ConnectPhoneInstallRequest = FeishuInstallRequest | WeixinInstallRequest

const CONNECT_PHONE_TARGETS: readonly ClawInstallTarget[] = ['feishu', 'lark', 'weixin']

type ConnectPhoneRelayTarget = {
  id: string
  label: string
  badgeKey: string
  guideStepKeys: [string, string, string]
}

const CONNECT_PHONE_RELAY_TARGETS: readonly ConnectPhoneRelayTarget[] = [
  {
    id: 'wecom',
    label: 'WeCom',
    badgeKey: 'connectPhoneRelayBadge',
    guideStepKeys: ['clawAddImGuideWecom1', 'clawAddImGuideWecom2', 'clawAddImGuideWecom3']
  },
  {
    id: 'dingtalk',
    label: 'DingTalk',
    badgeKey: 'connectPhoneRelayBadge',
    guideStepKeys: ['clawAddImGuideDingtalkOfficial1', 'clawAddImGuideDingtalkOfficial2', 'clawAddImGuideDingtalkOfficial3']
  },
  {
    id: 'qq',
    label: 'QQ',
    badgeKey: 'connectPhoneBotBadge',
    guideStepKeys: ['clawAddImGuideQq1', 'clawAddImGuideQq2', 'clawAddImGuideQq3']
  },
  {
    id: 'nim',
    label: 'NIM',
    badgeKey: 'connectPhoneRelayBadge',
    guideStepKeys: ['clawAddImGuideNim1', 'clawAddImGuideNim2', 'clawAddImGuideNim3']
  },
  {
    id: 'popo',
    label: 'POPO',
    badgeKey: 'connectPhoneRelayBadge',
    guideStepKeys: ['clawAddImGuidePopo1', 'clawAddImGuidePopo2', 'clawAddImGuidePopo3']
  },
  {
    id: 'netease-bee',
    label: 'Netease Bee',
    badgeKey: 'connectPhoneRelayBadge',
    guideStepKeys: ['clawAddImGuideNeteaseBee1', 'clawAddImGuideNeteaseBee2', 'clawAddImGuideNeteaseBee3']
  },
  {
    id: 'telegram',
    label: 'Telegram',
    badgeKey: 'connectPhoneBotBadge',
    guideStepKeys: ['clawAddImGuideTelegram1', 'clawAddImGuideTelegram2', 'clawAddImGuideTelegram3']
  },
  {
    id: 'slack',
    label: 'Slack',
    badgeKey: 'connectPhoneBotBadge',
    guideStepKeys: ['clawAddImGuideSlack1', 'clawAddImGuideSlack2', 'clawAddImGuideSlack3']
  },
  {
    id: 'discord',
    label: 'Discord',
    badgeKey: 'connectPhoneBotBadge',
    guideStepKeys: ['clawAddImGuideDiscord1', 'clawAddImGuideDiscord2', 'clawAddImGuideDiscord3']
  },
  {
    id: 'webhook',
    label: 'Webhook',
    badgeKey: 'connectPhoneWebhookBadge',
    guideStepKeys: ['clawAddImGuideWebhook1', 'clawAddImGuideWebhook2', 'clawAddImGuideWebhook3']
  }
]

const INITIAL_QR_STATE: ClawInstallQrState = {
  status: 'idle',
  url: '',
  deviceCode: '',
  userCode: '',
  timeLeft: 0,
  error: ''
}

export function connectPhoneProviderForTarget(target: ClawInstallTarget): ClawImProvider {
  return target === 'weixin' ? 'weixin' : 'feishu'
}

export function hasEnabledClawPhoneChannel(
  channels: ClawImChannelV1[],
  provider?: ClawImProvider
): boolean {
  return channels.some((channel) =>
    (provider ? channel.provider === provider : true) && channel.enabled
  )
}

export function hasClawPhoneChannel(
  channels: ClawImChannelV1[],
  provider?: ClawImProvider
): boolean {
  return provider
    ? channels.some((channel) => channel.provider === provider)
    : channels.length > 0
}

export function connectPhoneInstallRequestOptions(
  target: ClawInstallTarget
): ConnectPhoneInstallRequest {
  if (target === 'weixin') {
    return { provider: 'weixin' }
  }
  return {
    provider: 'feishu',
    options: { isLark: target === 'lark' }
  }
}

export function createConnectPhoneAgentProfile(): ClawImAgentProfileV1 {
  return {
    name: 'kun',
    description: '',
    identity: '',
    personality: '',
    userContext: '',
    replyRules: ''
  }
}

export function createConnectPhoneChannelOptions(provider: ClawImProvider = 'feishu'): {
  model: ClawModel
  enabled: boolean
  im: Partial<ClawImSettingsV1>
} {
  return {
    model: 'auto',
    enabled: true,
    im: {
      enabled: true,
      provider
    }
  }
}

export function createConnectPhoneCredential(
  poll: Extract<ClawImInstallPollResult, { done: true }>,
  createdAt: string = new Date().toISOString()
): ClawImPlatformCredentialV1 {
  if (poll.kind === 'weixin') {
    return {
      kind: poll.kind,
      accountId: poll.accountId,
      sessionKey: poll.sessionKey,
      createdAt
    }
  }
  return {
    kind: poll.kind,
    appId: poll.appId,
    appSecret: poll.appSecret,
    domain: poll.domain,
    createdAt
  }
}

export function formatConnectPhoneUserCode(userCode: string, deviceCode: string): string {
  const source = userCode.trim() || deviceCode
  const compact = source.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8)
  if (compact.length <= 4) return compact
  return `${compact.slice(0, 4)}-${compact.slice(4)}`
}

export function ConnectPhoneView({
  channels,
  onAddProvider,
  leftSidebarCollapsed,
  onToggleSidebar,
  onBack
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const [target, setTarget] = useState<ClawInstallTarget>('feishu')
  const [relayTargetId, setRelayTargetId] = useState(CONNECT_PHONE_RELAY_TARGETS[0].id)
  const [installQr, setInstallQr] = useState<ClawInstallQrState>(INITIAL_QR_STATE)
  const [saving, setSaving] = useState(false)
  const installPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const installCountdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const installRequestInFlightRef = useRef(false)
  const installAttemptRef = useRef(0)
  const targetProvider = connectPhoneProviderForTarget(target)
  const hasExistingChannel = hasClawPhoneChannel(channels, targetProvider)
  const relayTarget = CONNECT_PHONE_RELAY_TARGETS.find((item) => item.id === relayTargetId)
    ?? CONNECT_PHONE_RELAY_TARGETS[0]

  const clearInstallTimers = (): void => {
    if (installPollTimerRef.current) {
      clearInterval(installPollTimerRef.current)
      installPollTimerRef.current = null
    }
    if (installCountdownTimerRef.current) {
      clearInterval(installCountdownTimerRef.current)
      installCountdownTimerRef.current = null
    }
  }

  const cancelInstallAttempt = (): void => {
    installAttemptRef.current += 1
    installRequestInFlightRef.current = false
    clearInstallTimers()
  }

  useEffect(() => {
    return cancelInstallAttempt
  }, [])

  useEffect(() => {
    cancelInstallAttempt()
    setSaving(false)
    setInstallQr(INITIAL_QR_STATE)
  }, [target])

  useEffect(() => {
    if (!hasExistingChannel) return
    cancelInstallAttempt()
    setSaving(false)
    setInstallQr(INITIAL_QR_STATE)
  }, [hasExistingChannel])

  const addConnectedChannel = async (
    poll: Extract<ClawImInstallPollResult, { done: true }>
  ): Promise<void> => {
    const provider = poll.kind
    if (hasClawPhoneChannel(channels, provider)) {
      setInstallQr({
        ...INITIAL_QR_STATE,
        status: 'error',
        error: t('connectPhoneProviderAlreadyConnected', {
          provider: provider === 'weixin' ? clawInstallTargetLabel(t, 'weixin') : 'Feishu / Lark'
        })
      })
      return
    }
    setSaving(true)
    try {
      await onAddProvider(
        provider,
        createConnectPhoneAgentProfile(),
        createConnectPhoneCredential(poll),
        createConnectPhoneChannelOptions(provider)
      )
    } catch (error) {
      setInstallQr((current) => ({
        ...current,
        status: 'error',
        error: formatClawInstallError(error instanceof Error ? error.message : String(error), t)
      }))
    } finally {
      setSaving(false)
    }
  }

  const startOfficialInstallQr = async (): Promise<void> => {
    if (hasExistingChannel) {
      setInstallQr({
        ...INITIAL_QR_STATE,
        status: 'error',
        error: t('connectPhoneProviderAlreadyConnected', {
          provider: targetProvider === 'weixin' ? clawInstallTargetLabel(t, 'weixin') : 'Feishu / Lark'
        })
      })
      return
    }
    if (
      saving ||
      installRequestInFlightRef.current ||
      installQr.status === 'loading' ||
      installQr.status === 'showing'
    ) {
      return
    }
    if (
      typeof window === 'undefined' ||
      typeof window.kunGui?.startClawImInstallQr !== 'function'
    ) {
      setInstallQr({
        ...INITIAL_QR_STATE,
        status: 'error',
        error: t('clawAddImOfficialQrUnavailable')
      })
      return
    }

    clearInstallTimers()
    const installAttempt = installAttemptRef.current + 1
    installAttemptRef.current = installAttempt
    installRequestInFlightRef.current = true
    setSaving(false)
    setInstallQr({ ...INITIAL_QR_STATE, status: 'loading' })
    const request = connectPhoneInstallRequestOptions(target)
    let result: ClawImInstallQrResult
    try {
      result = await window.kunGui.startClawImInstallQr(request.provider, request.options)
    } catch (error) {
      if (installAttempt !== installAttemptRef.current) return
      setInstallQr({
        ...INITIAL_QR_STATE,
        status: 'error',
        error: formatClawInstallError(error instanceof Error ? error.message : String(error), t)
      })
      return
    } finally {
      if (installAttempt === installAttemptRef.current) {
        installRequestInFlightRef.current = false
      }
    }
    if (installAttempt !== installAttemptRef.current) return
    if (!result.ok) {
      setInstallQr({
        ...INITIAL_QR_STATE,
        status: 'error',
        error: formatClawInstallError(result.message, t)
      })
      return
    }

    setInstallQr({
      status: 'showing',
      url: result.url,
      deviceCode: result.deviceCode,
      userCode: result.userCode,
      timeLeft: result.expireIn,
      error: ''
    })
    installCountdownTimerRef.current = setInterval(() => {
      setInstallQr((current) => {
        if (current.status !== 'showing') return current
        if (current.timeLeft <= 1) {
          installAttemptRef.current += 1
          clearInstallTimers()
          return {
            ...current,
            status: 'error',
            timeLeft: 0,
            error: t('clawAddImOfficialQrExpired')
          }
        }
        return { ...current, timeLeft: current.timeLeft - 1 }
      })
    }, 1000)
    const waitForInstall = async (): Promise<void> => {
      try {
        if (
          typeof window === 'undefined' ||
          typeof window.kunGui?.pollClawImInstall !== 'function'
        ) {
          throw new Error(t('clawAddImOfficialQrUnavailable'))
        }
        const poll = await window.kunGui.pollClawImInstall(request.provider, result.deviceCode)
        if (installAttempt !== installAttemptRef.current) return
        if (poll.done) {
          clearInstallTimers()
          setInstallQr((current) => ({
            ...current,
            status: 'success',
            error: '',
            timeLeft: 0
          }))
          await addConnectedChannel(poll)
          return
        }
        if (poll.error) {
          installAttemptRef.current += 1
          clearInstallTimers()
          setInstallQr((current) => ({
            ...current,
            status: 'error',
            error: formatClawInstallError(poll.error ?? t('clawAddImOfficialQrFailed'), t)
          }))
        }
      } catch (error) {
        if (installAttempt !== installAttemptRef.current) return
        installAttemptRef.current += 1
        clearInstallTimers()
        setInstallQr((current) => ({
          ...current,
          status: 'error',
          error: formatClawInstallError(error instanceof Error ? error.message : String(error), t)
        }))
      }
    }
    if (request.provider === 'weixin') {
      void waitForInstall()
    } else {
      installPollTimerRef.current = setInterval(() => {
        void waitForInstall()
      }, Math.max(result.interval, 3) * 1000)
    }
  }

  const hasDisabledChannels = hasExistingChannel && !hasEnabledClawPhoneChannel(channels, targetProvider)
  const displayUserCode = targetProvider === 'weixin'
    ? ''
    : formatConnectPhoneUserCode(installQr.userCode, installQr.deviceCode)
  const installQrIsImage = installQr.url.startsWith('data:image/')

  return (
    <section className="ds-no-drag relative flex min-h-0 flex-1 overflow-hidden bg-transparent">
      <div className="absolute left-4 top-4 z-20 flex items-center gap-2">
        {leftSidebarCollapsed ? (
          <SidebarTitlebarToggleButton
            onClick={onToggleSidebar}
            title={t('sidebarExpand')}
            ariaLabel={t('sidebarExpand')}
          />
        ) : null}
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card/85 px-2.5 py-1.5 text-[12.5px] font-medium text-ds-muted shadow-sm backdrop-blur transition hover:bg-ds-hover hover:text-ds-ink"
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.9} />
          {t('back')}
        </button>
      </div>

      <div className="flex min-h-0 w-full justify-center overflow-y-auto px-5 py-8 lg:px-8">
        <div className="flex min-h-full w-full max-w-[760px] items-center justify-center pb-4 pt-8">
          <div className="w-full text-center">
            <h1 className="text-[28px] font-semibold tracking-normal text-ds-ink">
              {t('connectPhoneTitle')}
            </h1>
            <p className="mx-auto mt-2 max-w-[460px] text-[14px] leading-6 text-[#9299a3] dark:text-white/40">
              {t('connectPhoneSubtitle')}
            </p>

            <div className="mt-7 inline-flex rounded-full bg-[#f0f1ef] p-1 shadow-inner dark:bg-white/[0.08]">
              {CONNECT_PHONE_TARGETS.map((item) => {
                const active = target === item
                const provider = connectPhoneProviderForTarget(item)
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setTarget(item)}
                    className={`inline-flex h-8 min-w-[92px] items-center justify-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition ${
                      active
                        ? 'bg-white text-ds-ink shadow-sm dark:bg-white/[0.14] dark:text-white'
                        : 'text-[#727985] hover:text-ds-ink dark:hover:text-white'
                    }`}
                    aria-pressed={active}
                  >
                    <ClawProviderLogo provider={provider} className="h-4 w-4" />
                    {clawInstallTargetLabel(t, item)}
                  </button>
                )
              })}
            </div>

            <div className="mx-auto mt-9 flex h-[226px] w-[226px] flex-col items-center justify-center rounded-[14px] border border-[#ececea] bg-white p-3 shadow-[0_18px_38px_rgba(32,37,43,0.05)]">
              {installQr.status === 'idle' ? (
                <div className="grid justify-items-center gap-4">
                  <div className="flex h-20 w-20 items-center justify-center rounded-[18px] bg-[#f3f4f2] text-[#9aa2ad]">
                    <QrCode className="h-9 w-9" strokeWidth={1.7} />
                  </div>
                  <button
                    type="button"
                    onClick={() => void startOfficialInstallQr()}
                    disabled={hasExistingChannel}
                    className="inline-flex min-h-[36px] items-center justify-center gap-2 rounded-xl bg-[#222323] px-3.5 py-2 text-[12.5px] font-semibold text-white shadow-sm transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-55 dark:bg-white dark:text-black"
                  >
                    {t('connectPhoneGenerateQr')}
                  </button>
                </div>
              ) : null}

              {installQr.status === 'loading' ? (
                <div className="grid justify-items-center gap-2 text-ds-faint">
                  <Loader2 className="h-6 w-6 animate-spin" strokeWidth={2} />
                  <span className="text-[12px]">{t('connectPhoneQrLoading')}</span>
                </div>
              ) : null}

              {installQr.url && installQr.status !== 'loading' ? (
                installQrIsImage ? (
                  <img
                    src={installQr.url}
                    alt={t('connectPhoneGenerateQr')}
                    className="h-[204px] w-[204px] object-contain"
                  />
                ) : (
                  <QRCodeSVG value={installQr.url} size={204} marginSize={1} />
                )
              ) : null}

              {installQr.status === 'showing' ? (
                <div className="mt-3 text-center text-[12px] text-[#8d95a1]">
                  {t('clawAddImOfficialQrTimeLeft', { seconds: installQr.timeLeft })}
                </div>
              ) : null}

              {installQr.status === 'success' ? (
                <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-[12px] font-semibold text-emerald-600 dark:text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                  {saving ? t('connectPhoneBinding') : t('clawAddImOfficialQrSuccess')}
                </div>
              ) : null}

              {installQr.status === 'error' ? (
                <div className="mt-3 grid justify-items-center gap-2">
                  <div className="max-w-[220px] text-center text-[12px] leading-5 text-red-600 dark:text-red-300">
                    {installQr.error || t('clawAddImOfficialQrFailed')}
                  </div>
                  {!hasExistingChannel ? (
                    <button
                      type="button"
                      onClick={() => void startOfficialInstallQr()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-2.5 py-1.5 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                    >
                      <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
                      {t('clawAddImOfficialQrRetry')}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="mt-4 text-center text-[12.5px] leading-5 text-[#a1a7af]">
              <div className="inline-flex items-center justify-center gap-1.5 font-medium text-[#68707c] dark:text-white/55">
                <ClawProviderLogo provider={targetProvider} className="h-4 w-4" />
                {t(targetProvider === 'weixin' ? 'connectPhoneScanHintWeixin' : 'connectPhoneScanHint')}
              </div>
              <div className="mt-1">{t('connectPhoneAutoBindHint')}</div>
              {displayUserCode ? (
                <div className="mt-3 font-mono text-[13px] tracking-normal text-ds-ink">
                  {t('connectPhoneUserCode', { code: displayUserCode })}
                </div>
              ) : null}
              {hasDisabledChannels ? (
                <div className="mt-1">{t('connectPhoneDisabledConnectionHint')}</div>
              ) : null}
            </div>

            <div className="mx-auto mt-9 w-full max-w-[720px] text-left">
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ds-border-muted pb-3">
                <div>
                  <h2 className="text-[16px] font-semibold text-ds-ink">
                    {t('connectPhoneMoreTitle')}
                  </h2>
                  <p className="mt-1 text-[12.5px] leading-5 text-ds-faint">
                    {t('connectPhoneMoreSubtitle')}
                  </p>
                </div>
                <span className="rounded-full border border-ds-border-muted bg-ds-main/60 px-2.5 py-1 text-[11px] font-medium text-ds-faint">
                  {t('connectPhoneOfficialQrBadge')}
                </span>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {CONNECT_PHONE_RELAY_TARGETS.map((item) => {
                  const active = relayTarget.id === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setRelayTargetId(item.id)}
                      className={`rounded-[12px] border px-3 py-2.5 text-left transition ${
                        active
                          ? 'border-accent/35 bg-accent/10 text-ds-ink'
                          : 'border-ds-border-muted bg-ds-card/70 text-ds-muted hover:border-ds-border hover:bg-ds-hover hover:text-ds-ink'
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-semibold">{item.label}</span>
                        <span className="shrink-0 rounded-md bg-ds-hover px-1.5 py-0.5 text-[10.5px] font-medium text-ds-faint">
                          {t(item.badgeKey)}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>

              <div className="mt-3 rounded-[14px] border border-ds-border bg-ds-card/85 px-4 py-3 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[13px] font-semibold text-ds-ink">
                    {t('connectPhoneGuideTitle', { name: relayTarget.label })}
                  </div>
                  <span className="rounded-md bg-ds-hover px-1.5 py-0.5 text-[10.5px] font-medium text-ds-faint">
                    {t(relayTarget.badgeKey)}
                  </span>
                </div>
                <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-[12.5px] leading-5 text-ds-muted">
                  {relayTarget.guideStepKeys.map((key) => (
                    <li key={key}>{t(key)}</li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export function ConnectPhoneSidebarPanel({
  channels,
  onAddProvider,
  onDisconnect,
  onOpenSettings
}: {
  channels: ClawImChannelV1[]
  onAddProvider: AddClawPhoneChannel
  onDisconnect: (channelId: string) => Promise<void>
  onOpenSettings: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [target, setTarget] = useState<ClawInstallTarget>('feishu')
  const [installQr, setInstallQr] = useState<ClawInstallQrState>(INITIAL_QR_STATE)
  const [saving, setSaving] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [disconnectError, setDisconnectError] = useState('')
  const installPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const installCountdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const installRequestInFlightRef = useRef(false)
  const installAttemptRef = useRef(0)
  const targetProvider = connectPhoneProviderForTarget(target)
  const connectedChannel = channels.find((channel) => channel.provider === targetProvider) ?? null
  const hasExistingChannel = Boolean(connectedChannel)
  const displayUserCode = targetProvider === 'weixin'
    ? ''
    : formatConnectPhoneUserCode(installQr.userCode, installQr.deviceCode)
  const installQrIsImage = installQr.url.startsWith('data:image/')
  const sortedChannels = useMemo(
    () => [...channels].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    [channels]
  )
  const firstAvailableTarget = CONNECT_PHONE_TARGETS.find(
    (item) => !hasClawPhoneChannel(channels, connectPhoneProviderForTarget(item))
  ) ?? null

  const clearInstallTimers = (): void => {
    if (installPollTimerRef.current) {
      clearInterval(installPollTimerRef.current)
      installPollTimerRef.current = null
    }
    if (installCountdownTimerRef.current) {
      clearInterval(installCountdownTimerRef.current)
      installCountdownTimerRef.current = null
    }
  }

  const cancelInstallAttempt = (): void => {
    installAttemptRef.current += 1
    installRequestInFlightRef.current = false
    clearInstallTimers()
  }

  useEffect(() => {
    return cancelInstallAttempt
  }, [])

  useEffect(() => {
    cancelInstallAttempt()
    setSaving(false)
    setInstallQr(INITIAL_QR_STATE)
    setDisconnectError('')
  }, [target])

  useEffect(() => {
    if (!hasExistingChannel) return
    cancelInstallAttempt()
    setSaving(false)
    setInstallQr(INITIAL_QR_STATE)
  }, [hasExistingChannel])

  const addConnectedChannel = async (
    poll: Extract<ClawImInstallPollResult, { done: true }>
  ): Promise<void> => {
    const provider = poll.kind
    if (hasClawPhoneChannel(channels, provider)) {
      setInstallQr({
        ...INITIAL_QR_STATE,
        status: 'error',
        error: t('connectPhoneProviderAlreadyConnected', {
          provider: provider === 'weixin' ? clawInstallTargetLabel(t, 'weixin') : 'Feishu / Lark'
        })
      })
      return
    }
    setSaving(true)
    try {
      await onAddProvider(
        provider,
        createConnectPhoneAgentProfile(),
        createConnectPhoneCredential(poll),
        {
          ...createConnectPhoneChannelOptions(provider),
          preserveRoute: true
        }
      )
    } catch (error) {
      setInstallQr((current) => ({
        ...current,
        status: 'error',
        error: formatClawInstallError(error instanceof Error ? error.message : String(error), t)
      }))
    } finally {
      setSaving(false)
    }
  }

  const startOfficialInstallQr = async (): Promise<void> => {
    if (hasExistingChannel) {
      setInstallQr({
        ...INITIAL_QR_STATE,
        status: 'error',
        error: t('connectPhoneProviderAlreadyConnected', {
          provider: targetProvider === 'weixin' ? clawInstallTargetLabel(t, 'weixin') : 'Feishu / Lark'
        })
      })
      return
    }
    if (
      saving ||
      installRequestInFlightRef.current ||
      installQr.status === 'loading' ||
      installQr.status === 'showing'
    ) {
      return
    }
    if (
      typeof window === 'undefined' ||
      typeof window.kunGui?.startClawImInstallQr !== 'function'
    ) {
      setInstallQr({
        ...INITIAL_QR_STATE,
        status: 'error',
        error: t('clawAddImOfficialQrUnavailable')
      })
      return
    }

    clearInstallTimers()
    const installAttempt = installAttemptRef.current + 1
    installAttemptRef.current = installAttempt
    installRequestInFlightRef.current = true
    setSaving(false)
    setInstallQr({ ...INITIAL_QR_STATE, status: 'loading' })
    const request = connectPhoneInstallRequestOptions(target)
    let result: ClawImInstallQrResult
    try {
      result = await window.kunGui.startClawImInstallQr(request.provider, request.options)
    } catch (error) {
      if (installAttempt !== installAttemptRef.current) return
      setInstallQr({
        ...INITIAL_QR_STATE,
        status: 'error',
        error: formatClawInstallError(error instanceof Error ? error.message : String(error), t)
      })
      return
    } finally {
      if (installAttempt === installAttemptRef.current) {
        installRequestInFlightRef.current = false
      }
    }
    if (installAttempt !== installAttemptRef.current) return
    if (!result.ok) {
      setInstallQr({
        ...INITIAL_QR_STATE,
        status: 'error',
        error: formatClawInstallError(result.message, t)
      })
      return
    }

    setInstallQr({
      status: 'showing',
      url: result.url,
      deviceCode: result.deviceCode,
      userCode: result.userCode,
      timeLeft: result.expireIn,
      error: ''
    })
    installCountdownTimerRef.current = setInterval(() => {
      setInstallQr((current) => {
        if (current.status !== 'showing') return current
        if (current.timeLeft <= 1) {
          installAttemptRef.current += 1
          clearInstallTimers()
          return {
            ...current,
            status: 'error',
            timeLeft: 0,
            error: t('clawAddImOfficialQrExpired')
          }
        }
        return { ...current, timeLeft: current.timeLeft - 1 }
      })
    }, 1000)
    const waitForInstall = async (): Promise<void> => {
      try {
        if (
          typeof window === 'undefined' ||
          typeof window.kunGui?.pollClawImInstall !== 'function'
        ) {
          throw new Error(t('clawAddImOfficialQrUnavailable'))
        }
        const poll = await window.kunGui.pollClawImInstall(request.provider, result.deviceCode)
        if (installAttempt !== installAttemptRef.current) return
        if (poll.done) {
          clearInstallTimers()
          setInstallQr((current) => ({
            ...current,
            status: 'success',
            error: '',
            timeLeft: 0
          }))
          await addConnectedChannel(poll)
          return
        }
        if (poll.error) {
          installAttemptRef.current += 1
          clearInstallTimers()
          setInstallQr((current) => ({
            ...current,
            status: 'error',
            error: formatClawInstallError(poll.error ?? t('clawAddImOfficialQrFailed'), t)
          }))
        }
      } catch (error) {
        if (installAttempt !== installAttemptRef.current) return
        installAttemptRef.current += 1
        clearInstallTimers()
        setInstallQr((current) => ({
          ...current,
          status: 'error',
          error: formatClawInstallError(error instanceof Error ? error.message : String(error), t)
        }))
      }
    }
    if (request.provider === 'weixin') {
      void waitForInstall()
    } else {
      installPollTimerRef.current = setInterval(() => {
        void waitForInstall()
      }, Math.max(result.interval, 3) * 1000)
    }
  }

  const disconnectChannel = async (): Promise<void> => {
    if (!connectedChannel || disconnecting) return
    const confirmed = await confirmDialog(
      t('connectPhoneDisconnectConfirm', { name: connectedChannel.label })
    )
    if (!confirmed) return

    setDisconnectError('')
    setDisconnecting(true)
    try {
      await onDisconnect(connectedChannel.id)
    } catch (error) {
      setDisconnectError(error instanceof Error ? error.message : String(error))
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div className="ds-no-drag flex min-h-0 flex-1 flex-col gap-3 px-2 pt-2">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-[#9aa5b5] dark:text-white/35">
            {t('clawSidebarIm')}
          </span>
          <span className="flex items-center gap-1">
            <button
              type="button"
              disabled={!firstAvailableTarget}
              onClick={() => {
                if (firstAvailableTarget) setTarget(firstAvailableTarget)
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={t('clawAddIm')}
              title={t('clawAddIm')}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
              aria-label={t('clawSettings')}
              title={t('clawSettings')}
            >
              <Settings className="h-3.5 w-3.5" strokeWidth={1.9} />
            </button>
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-0.5 pb-2">
          {sortedChannels.length === 0 ? (
            <div className="mx-1 rounded-[14px] border border-dashed border-ds-border-muted bg-ds-main/35 px-3 py-4">
              <p className="text-[13.5px] font-medium text-ds-muted">{t('clawNoImTitle')}</p>
              <p className="mt-1 text-[12px] leading-5 text-ds-faint">
                {t('clawNoImSub')}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {sortedChannels.map((channel) => {
                const providerTarget: ClawInstallTarget = channel.provider === 'weixin' ? 'weixin' : 'feishu'
                const active = channel.provider === targetProvider
                const disabled = !channel.enabled
                const sortedConversations = [...channel.conversations].sort(
                  (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
                )
                const latestConversation = sortedConversations[0] ?? null
                const providerLabel = channel.provider === 'weixin' ? 'WeChat' : 'Feishu / Lark'
                const secondaryLabel = latestConversation?.senderName.trim()
                  || latestConversation?.chatId.trim()
                  || `${providerLabel} · ${channel.model}`
                return (
                  <button
                    key={channel.id}
                    type="button"
                    onClick={() => setTarget(providerTarget)}
                    className={`group flex min-h-[64px] w-full items-center gap-2 rounded-[12px] border px-2.5 py-2 text-left transition ${
                      active
                        ? 'border-accent/20 bg-accent/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.62)]'
                        : 'border-transparent hover:border-ds-border hover:bg-ds-hover/70'
                    } ${disabled ? 'opacity-55' : ''}`}
                    title={disabled ? t('clawImDisabledSidebar') : channel.label}
                  >
                    <MessageSquare className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.75} />
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-ds-card/75">
                      <ClawProviderLogo provider={channel.provider} className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-ds-ink">
                        {channel.label}
                      </span>
                      <span className="mt-0.5 block truncate text-[12px] text-ds-faint">
                        {secondaryLabel}
                      </span>
                    </span>
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        disabled ? 'bg-ds-faint' : 'bg-emerald-400'
                      }`}
                    />
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="mx-1 shrink-0 border-t border-ds-border-muted/70 pt-3">
        <div className="mb-3 flex items-center gap-2 px-1 text-[12px] font-semibold text-[#9aa5b5] dark:text-white/40">
          <ClawProviderLogo provider={targetProvider} className="h-4 w-4" />
          <span>{t('claw')}</span>
        </div>

        <div className="grid grid-cols-3 gap-1 rounded-[14px] border border-ds-border bg-ds-card p-1 shadow-sm">
          {CONNECT_PHONE_TARGETS.map((item) => {
            const active = target === item
            const provider = connectPhoneProviderForTarget(item)
            return (
              <button
                key={item}
                type="button"
                onClick={() => setTarget(item)}
                className={`inline-flex min-h-[30px] items-center justify-center gap-1 rounded-[10px] px-2 text-[11.5px] font-semibold transition ${
                  active
                    ? 'bg-accent/10 text-accent'
                    : 'text-ds-faint hover:bg-ds-hover hover:text-ds-ink'
                }`}
                aria-pressed={active}
              >
                <ClawProviderLogo provider={provider} className="h-3.5 w-3.5" />
                {clawInstallTargetLabel(t, item)}
              </button>
            )
          })}
        </div>

        {connectedChannel ? (
          <div className="mt-3 rounded-[14px] border border-ds-border bg-ds-card px-3 py-3 shadow-sm">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-emerald-500/12 text-emerald-600 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" strokeWidth={1.9} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-ds-ink">
                  {connectedChannel.label}
                </span>
                <span className="mt-1 block truncate text-[12px] text-ds-faint">
                  {connectedChannel.enabled
                    ? t('clawManageImConnected')
                    : t('clawImDisabledSidebar')}
                </span>
              </span>
            </div>
            <div className="mt-3 grid gap-2">
              <button
                type="button"
                onClick={onOpenSettings}
                className="inline-flex min-h-[30px] w-full items-center justify-center gap-1.5 rounded-[8px] border border-ds-border bg-ds-main/55 px-2.5 py-1.5 text-[12.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
              >
                <Settings className="h-3.5 w-3.5" strokeWidth={1.8} />
                {t('clawSettings')}
              </button>
              <button
                type="button"
                onClick={() => void disconnectChannel()}
                disabled={disconnecting}
                className="inline-flex min-h-[30px] w-full items-center justify-center gap-1.5 rounded-[8px] border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[12.5px] font-medium text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-200 dark:hover:bg-rose-500/15"
              >
                {disconnecting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
                ) : (
                  <LogOut className="h-3.5 w-3.5" strokeWidth={1.8} />
                )}
                {disconnecting ? t('connectPhoneDisconnecting') : t('connectPhoneDisconnect')}
              </button>
            </div>
            {disconnectError ? (
              <div className="mt-2 rounded-[8px] bg-red-500/10 px-2.5 py-2 text-[12px] leading-relaxed text-red-600 dark:text-red-300">
                {disconnectError}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-3 flex flex-col items-center rounded-[14px] border border-ds-border bg-ds-card px-3 py-4 shadow-sm">
            <div className="flex h-[156px] w-full items-center justify-center rounded-[10px] border border-[#ececea] bg-white p-2">
              {installQr.status === 'idle' ? (
                <div className="grid justify-items-center gap-3">
                  <div className="flex h-14 w-14 items-center justify-center rounded-[14px] bg-[#f3f4f2] text-[#9aa2ad]">
                    <QrCode className="h-7 w-7" strokeWidth={1.7} />
                  </div>
                  <button
                    type="button"
                    onClick={() => void startOfficialInstallQr()}
                    className="inline-flex min-h-[32px] items-center justify-center gap-1.5 rounded-[8px] bg-[#222323] px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-black dark:bg-white dark:text-black"
                  >
                    {t('connectPhoneGenerateQr')}
                  </button>
                </div>
              ) : null}

              {installQr.status === 'loading' ? (
                <div className="grid justify-items-center gap-2 text-ds-faint">
                  <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2} />
                  <span className="text-[12px]">{t('connectPhoneQrLoading')}</span>
                </div>
              ) : null}

              {installQr.url && installQr.status !== 'loading' ? (
                installQrIsImage ? (
                  <img
                    src={installQr.url}
                    alt={t('connectPhoneGenerateQr')}
                    className="h-[136px] w-[136px] object-contain"
                  />
                ) : (
                  <QRCodeSVG value={installQr.url} size={136} marginSize={1} />
                )
              ) : null}
            </div>

            {installQr.status === 'showing' ? (
              <div className="mt-3 text-center text-[12px] text-[#8d95a1]">
                {t('clawAddImOfficialQrTimeLeft', { seconds: installQr.timeLeft })}
              </div>
            ) : null}

            {installQr.status === 'success' ? (
              <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-[12px] font-semibold text-emerald-600 dark:text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                {saving ? t('connectPhoneBinding') : t('clawAddImOfficialQrSuccess')}
              </div>
            ) : null}

            {installQr.status === 'error' ? (
              <div className="mt-3 grid justify-items-center gap-2">
                <div className="max-w-[220px] text-center text-[12px] leading-5 text-red-600 dark:text-red-300">
                  {installQr.error || t('clawAddImOfficialQrFailed')}
                </div>
                {!hasExistingChannel ? (
                  <button
                    type="button"
                    onClick={() => void startOfficialInstallQr()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-2.5 py-1.5 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                  >
                    <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
                    {t('clawAddImOfficialQrRetry')}
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="mt-4 text-center text-[12px] leading-5 text-[#8d95a1]">
              <div className="inline-flex items-center justify-center gap-1.5 font-medium text-[#68707c] dark:text-white/55">
                <ClawProviderLogo provider={targetProvider} className="h-4 w-4" />
                {clawInstallTargetLabel(t, target)}
              </div>
              <div className="mt-1">{t('connectPhoneAutoBindHint')}</div>
              {displayUserCode ? (
                <div className="mt-2 font-mono text-[13px] tracking-normal text-ds-ink">
                  {t('connectPhoneUserCode', { code: displayUserCode })}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

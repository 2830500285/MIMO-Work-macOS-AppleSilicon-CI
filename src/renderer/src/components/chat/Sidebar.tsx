import type { ReactElement, ReactPortal } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  ChevronLeft,
  Clock3,
  Gift,
  LayoutGrid,
  LogOut,
  MessageSquarePlus,
  Search,
  Settings,
  Smartphone,
  User,
  UserCircle
} from 'lucide-react'
import type { NormalizedThread } from '../../agent/types'
import { useChatStore, type SettingsRouteSection } from '../../store/chat-store'
import type { SddDraft } from '../../sdd/sdd-draft-store'
import type {
  ClawImChannelV1,
} from '@shared/app-settings'
import {
  ClawSidebarContent
} from './SidebarClaw'
import type { ClawImDialogMode } from './SidebarClawDialogHelpers'
import { ClawAddImDialog } from './SidebarClawDialog'
import { AccountUsageOverviewPanel } from './InitialSessionUsageHeatmap'
import { SidebarProjectsSection } from './SidebarProjectsSection'
import {
  SidebarCommandRow,
  SidebarFrame
} from '../sidebar/SidebarPrimitives'

type Props = {
  threads: NormalizedThread[]
  activeThreadId: string | null
  activeView: 'chat' | 'write' | 'claw' | 'schedule'
  connectPhoneSidebarOpen: boolean
  pluginsActive: boolean
  runtimeReady: boolean
  threadSearch: string
  showArchivedThreads: boolean
  onThreadSearchChange: (query: string) => void
  onShowArchivedThreadsChange: (show: boolean) => void
  onSelectThread: (id: string) => void
  onRenameThread: (id: string, title: string) => Promise<void>
  onArchiveThread: (id: string) => Promise<void>
  onDeleteThread: (id: string) => Promise<void>
  onRestoreThread: (id: string) => Promise<void>
  onNewChat: () => void
  onNewChatInWorkspace: (workspaceRoot: string) => void
  onOpenRequirementDraft: (draft: SddDraft) => void
  onOpenSettings: (section?: SettingsRouteSection) => void
  onOpenPlugins: () => void
  onToggleConnectPhone: () => void
  onScheduleOpen: () => void
  onToggleSidebar: () => void
}

export function Sidebar({
  threads,
  activeThreadId,
  activeView,
  connectPhoneSidebarOpen,
  pluginsActive,
  runtimeReady,
  threadSearch,
  showArchivedThreads,
  onThreadSearchChange,
  onShowArchivedThreadsChange,
  onSelectThread,
  onRenameThread,
  onArchiveThread,
  onDeleteThread,
  onRestoreThread,
  onNewChat,
  onNewChatInWorkspace,
  onOpenRequirementDraft,
  onOpenSettings,
  onOpenPlugins,
  onToggleConnectPhone,
  onScheduleOpen,
  onToggleSidebar
}: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const codeWorkspaceRoots = useChatStore((s) => s.codeWorkspaceRoots)
  const chooseWorkspace = useChatStore((s) => s.chooseWorkspace)
  const deleteWorkspace = useChatStore((s) => s.deleteWorkspace)
  const busy = useChatStore((s) => s.busy)
  const watchTurnCompletion = useChatStore((s) => s.watchTurnCompletion)
  const unreadThreadIds = useChatStore((s) => s.unreadThreadIds)
  const clawChannels = useChatStore((s) => s.clawChannels)
  const activeClawChannelId = useChatStore((s) => s.activeClawChannelId)
  const selectClawChannel = useChatStore((s) => s.selectClawChannel)
  const addClawChannel = useChatStore((s) => s.addClawChannel)
  const deleteClawChannel = useChatStore((s) => s.deleteClawChannel)
  const resetClawChannelSession = useChatStore((s) => s.resetClawChannelSession)

  const [imDialogMode, setImDialogMode] = useState<ClawImDialogMode | null>(null)
  const [searchToggleSignal, setSearchToggleSignal] = useState(0)
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false)
  const settingsMenuRef = useRef<HTMLDivElement>(null)

  const activeClawChannel = useMemo(
    () => clawChannels.find((channel) => channel.id === activeClawChannelId) ?? clawChannels[0] ?? null,
    [clawChannels, activeClawChannelId]
  )

  useEffect(() => {
    if (!settingsMenuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && settingsMenuRef.current?.contains(target)) return
      if (target instanceof Element && target.closest('[data-settings-menu-popover="true"]')) return
      setSettingsMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSettingsMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [settingsMenuOpen])

  const openSettingsFromMenu = (section: SettingsRouteSection): void => {
    setSettingsMenuOpen(false)
    onOpenSettings(section)
  }

  return (
    <>
    <SidebarFrame
      title={t('appName')}
      onCollapse={onToggleSidebar}
      footer={
        <div ref={settingsMenuRef} className="relative space-y-1">
          {settingsMenuOpen ? (
            <SettingsQuickMenu
              onOpenKnowledgeBase={() => openSettingsFromMenu('memory')}
              onOpenSettings={() => openSettingsFromMenu('general')}
              t={t}
            />
          ) : null}
          <SidebarCommandRow
            icon={<Settings className="h-4 w-4" strokeWidth={1.75} />}
            label={t('settings')}
            onClick={() => setSettingsMenuOpen((open) => !open)}
            active={settingsMenuOpen}
            variant="footer"
          />
        </div>
      }
    >
      <div className="ds-no-drag flex flex-col px-1">
        <SidebarCommandRow
          icon={<MessageSquarePlus className="h-4 w-4" strokeWidth={1.9} />}
          label={t('newChat')}
          onClick={runtimeReady ? onNewChat : undefined}
          disabled={!runtimeReady}
          disabledHint={t('runtimeActionNeedsConnection')}
          variant="accent"
        />
        <SidebarCommandRow
          icon={<Search className="h-4 w-4" strokeWidth={1.8} />}
          label={t('search')}
          onClick={() => setSearchToggleSignal((value) => value + 1)}
          active={threadSearch.trim().length > 0}
        />
        <SidebarCommandRow
          icon={<LayoutGrid className="h-4 w-4" strokeWidth={1.75} />}
          label={t('plugins')}
          onClick={onOpenPlugins}
          active={pluginsActive}
        />
        <SidebarCommandRow
          icon={<Clock3 className="h-4 w-4" strokeWidth={1.75} />}
          label={t('automations')}
          onClick={onScheduleOpen}
          active={activeView === 'schedule'}
        />
        <SidebarCommandRow
          icon={<Smartphone className="h-4 w-4" strokeWidth={1.75} />}
          label={t('mimoMobile')}
          onClick={onToggleConnectPhone}
          active={connectPhoneSidebarOpen}
        />
      </div>

      <div className="ds-no-drag mx-1 my-1" />

      {activeView === 'claw' ? (
        <ClawSidebarContent
          channels={clawChannels}
          activeChannelId={activeClawChannelId}
          activeThreadId={activeThreadId}
          runtimeReady={runtimeReady}
          onSelectChannel={(channelId) => void selectClawChannel(channelId)}
          onAddChannel={() => setImDialogMode('add')}
          onResetChannel={(channelId) => void resetClawChannelSession(channelId)}
          onOpenSettings={() => setImDialogMode('edit')}
          t={t}
        />
      ) : activeView === 'schedule' ? (
        <SidebarProjectsSection
          threads={threads}
          activeView="chat"
          activeThreadId={activeThreadId}
          runtimeReady={runtimeReady}
          searchQuery={threadSearch}
          showArchived={showArchivedThreads}
          searchToggleSignal={searchToggleSignal}
          workspaceRoot={workspaceRoot}
          workspaceRoots={codeWorkspaceRoots}
          busy={busy}
          watchTurnCompletion={watchTurnCompletion}
          unreadThreadIds={unreadThreadIds}
          locale={i18n.language}
          onPickWorkspace={() => void chooseWorkspace()}
          onRemoveWorkspace={deleteWorkspace}
          onCreateThreadInWorkspace={onNewChatInWorkspace}
          onOpenRequirementDraft={onOpenRequirementDraft}
          onSelectThread={onSelectThread}
          onRenameThread={onRenameThread}
          onArchiveThread={onArchiveThread}
          onDeleteThread={onDeleteThread}
          onRestoreThread={onRestoreThread}
          onSearchQueryChange={onThreadSearchChange}
          onShowArchivedChange={onShowArchivedThreadsChange}
          t={t}
        />
      ) : (
      <SidebarProjectsSection
        threads={threads}
        activeView={activeView === 'write' ? 'write' : 'chat'}
        activeThreadId={activeThreadId}
        runtimeReady={runtimeReady}
        searchQuery={threadSearch}
        showArchived={showArchivedThreads}
        searchToggleSignal={searchToggleSignal}
        workspaceRoot={workspaceRoot}
        workspaceRoots={codeWorkspaceRoots}
        busy={busy}
        watchTurnCompletion={watchTurnCompletion}
        unreadThreadIds={unreadThreadIds}
        locale={i18n.language}
        onPickWorkspace={() => void chooseWorkspace()}
        onRemoveWorkspace={deleteWorkspace}
        onCreateThreadInWorkspace={onNewChatInWorkspace}
        onOpenRequirementDraft={onOpenRequirementDraft}
        onSelectThread={onSelectThread}
        onRenameThread={onRenameThread}
        onArchiveThread={onArchiveThread}
        onDeleteThread={onDeleteThread}
        onRestoreThread={onRestoreThread}
        onSearchQueryChange={onThreadSearchChange}
        onShowArchivedChange={onShowArchivedThreadsChange}
        t={t}
      />
      )}

    </SidebarFrame>

    {imDialogMode ? (
      <ClawAddImDialog
        mode={imDialogMode}
        initialProvider={activeClawChannel?.provider}
        initialChannelId={imDialogMode === 'edit' ? activeClawChannel?.id : undefined}
        channels={clawChannels}
        onClose={() => setImDialogMode(null)}
        onAddProvider={(provider, agentProfile, platformCredential, options) =>
          addClawChannel(provider, agentProfile, platformCredential, options)
        }
        onDeleteChannel={(channelId) => deleteClawChannel(channelId)}
        t={t}
      />
    ) : null}
    </>
  )
}

function SettingsQuickMenu({
  onOpenKnowledgeBase,
  onOpenSettings,
  t
}: {
  onOpenKnowledgeBase: () => void
  onOpenSettings: () => void
  t: (key: string, opts?: Record<string, unknown>) => string
}): ReactElement | ReactPortal {
  const [view, setView] = useState<'menu' | 'account'>('menu')

  if (view === 'account') {
    const accountPanel = (
      <div
        data-settings-menu-popover="true"
        className="ds-card-strong fixed bottom-[70px] left-5 z-[90] w-[690px] max-w-[calc(100vw-40px)] overflow-hidden rounded-[18px] border border-ds-border p-3 shadow-[0_22px_64px_rgba(31,35,41,0.18)] backdrop-blur-xl dark:shadow-[0_24px_72px_rgba(0,0,0,0.42)]"
      >
        <div className="mb-2 flex min-w-0 items-center justify-between gap-3 px-1">
          <button
            type="button"
            className="inline-flex min-h-8 min-w-0 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-ds-muted transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink"
            onClick={() => setView('menu')}
          >
            <ChevronLeft className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
            <span className="truncate">{t('settingsMenuPersonalAccount')}</span>
          </button>
          <span className="min-w-0 truncate text-[11.5px] text-ds-faint">
            {t('accountUsageSubtitle')}
          </span>
        </div>
        <div className="max-h-[min(72vh,560px)] overflow-y-auto px-0.5 pb-0.5 [scrollbar-width:thin]">
          <AccountUsageOverviewPanel />
        </div>
      </div>
    )
    return typeof document === 'undefined' ? accountPanel : createPortal(accountPanel, document.body)
  }

  return (
    <div className="ds-card-strong absolute bottom-[42px] left-0 z-50 w-[230px] overflow-hidden rounded-[12px] border border-ds-border py-1.5 shadow-[0_18px_46px_rgba(31,35,41,0.16)] backdrop-blur-xl dark:shadow-[0_22px_58px_rgba(0,0,0,0.38)]">
      <div className="border-b border-ds-border-muted px-3 pb-2 pt-1.5">
        <div className="truncate text-[12px] font-medium text-ds-ink">{t('appName')}</div>
        <div className="truncate text-[11px] text-ds-faint">{t('settingsMenuPersonalAccount')}</div>
      </div>
      <SettingsQuickMenuRow
        icon={<User className="h-3.5 w-3.5" strokeWidth={1.8} />}
        label={t('settingsMenuPersonalAccount')}
        onClick={() => setView('account')}
        t={t}
      />
      <SettingsQuickMenuRow
        icon={<UserCircle className="h-3.5 w-3.5" strokeWidth={1.8} />}
        label={t('settingsMenuKnowledgeBase')}
        onClick={onOpenKnowledgeBase}
        t={t}
      />
      <SettingsQuickMenuRow
        icon={<Settings className="h-3.5 w-3.5" strokeWidth={1.8} />}
        label={t('settings')}
        onClick={onOpenSettings}
        shortcut="⌘,"
        t={t}
      />
      <div className="my-1 border-t border-ds-border-muted" />
      <SettingsQuickMenuRow
        icon={<Gift className="h-3.5 w-3.5" strokeWidth={1.8} />}
        label={t('settingsMenuInviteFriend')}
        disabled
        t={t}
      />
      <SettingsQuickMenuRow
        icon={<LogOut className="h-3.5 w-3.5" strokeWidth={1.8} />}
        label={t('settingsMenuLogOut')}
        disabled
        t={t}
      />
    </div>
  )
}

function SettingsQuickMenuRow({
  icon,
  label,
  onClick,
  disabled,
  shortcut,
  t
}: {
  icon: ReactElement
  label: string
  onClick?: () => void
  disabled?: boolean
  shortcut?: string
  t: (key: string, opts?: Record<string, unknown>) => string
}): ReactElement {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={disabled ? t('comingSoon') : label}
      className="flex min-h-[32px] w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] text-ds-muted transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-55"
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-ds-faint">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut ? (
        <span className="shrink-0 rounded-md bg-ds-hover px-1.5 py-0.5 font-mono text-[10.5px] text-ds-faint">
          {shortcut}
        </span>
      ) : null}
    </button>
  )
}

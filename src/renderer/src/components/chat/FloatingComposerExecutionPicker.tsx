import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Check, ChevronDown, Hand, Shield, ShieldAlert, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ApprovalPolicy, SandboxMode } from '@shared/app-settings'

export type ComposerExecutionSettings = {
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
}

type Props = {
  value: ComposerExecutionSettings
  applying?: boolean
  disabled?: boolean
  onChange: (patch: Partial<ComposerExecutionSettings>) => void
}

type ExecutionPreset = {
  id: 'ask' | 'approve' | 'full' | 'custom'
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
  labelKey: string
  descriptionKey: string
  icon: LucideIcon
}

const EXECUTION_PRESETS: ExecutionPreset[] = [
  {
    id: 'ask',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    labelKey: 'composerExecutionAskApproval',
    descriptionKey: 'composerExecutionAskApprovalDesc',
    icon: Hand
  },
  {
    id: 'approve',
    approvalPolicy: 'untrusted',
    sandboxMode: 'workspace-write',
    labelKey: 'composerExecutionApproveForMe',
    descriptionKey: 'composerExecutionApproveForMeDesc',
    icon: ShieldCheck
  },
  {
    id: 'full',
    approvalPolicy: 'auto',
    sandboxMode: 'danger-full-access',
    labelKey: 'composerExecutionFullAccess',
    descriptionKey: 'composerExecutionFullAccessDesc',
    icon: ShieldAlert
  },
  {
    id: 'custom',
    approvalPolicy: 'auto',
    sandboxMode: 'external-sandbox',
    labelKey: 'composerExecutionCustom',
    descriptionKey: 'composerExecutionCustomDesc',
    icon: SlidersHorizontal
  }
]

function executionPresetForSettings(value: ComposerExecutionSettings): ExecutionPreset | undefined {
  return EXECUTION_PRESETS.find((preset) =>
    preset.approvalPolicy === value.approvalPolicy && preset.sandboxMode === value.sandboxMode
  )
}

export function FloatingComposerExecutionPicker({
  value,
  applying = false,
  disabled = false,
  onChange
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const fullAccess = value.sandboxMode === 'danger-full-access'
  const currentPreset = executionPresetForSettings(value)
  const Icon = fullAccess ? ShieldAlert : currentPreset?.icon ?? Shield
  const label = currentPreset ? t(currentPreset.labelKey) : t('composerExecutionCustom')
  const title = currentPreset
    ? `${t(currentPreset.labelKey)}: ${t(currentPreset.descriptionKey)}`
    : t('composerExecutionCustomDesc')

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const update = (patch: Partial<ComposerExecutionSettings>): void => {
    onChange(patch)
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="ds-no-drag relative shrink-0">
      <button
        type="button"
        disabled={disabled || applying}
        onClick={() => setOpen((current) => !current)}
        className={`inline-flex min-h-7 items-center gap-1.5 rounded-lg border px-2.5 py-0.5 text-[12.5px] font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-55 ${
          fullAccess
            ? 'border-orange-300/70 bg-orange-50 text-orange-700 hover:bg-orange-100 dark:border-orange-800/70 dark:bg-orange-950/30 dark:text-orange-200'
            : 'border-ds-border-muted bg-ds-card/72 text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
        }`}
        title={title}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('composerExecutionLabel')}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
        <span className="max-w-[132px] truncate">
          {applying ? t('composerExecutionApplying') : label}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-40 mb-2 w-[260px] overflow-hidden rounded-2xl border border-ds-border bg-white p-2 text-[13px] text-ds-muted shadow-[0_18px_48px_rgba(31,35,41,0.16)] dark:bg-ds-card"
        >
          <div className="px-2 pb-1 pt-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ds-faint">
            {t('composerExecutionApprovalQuestion')}
          </div>
          {EXECUTION_PRESETS.map((option) => (
            <ExecutionRow
              key={option.id}
              icon={option.icon}
              selected={currentPreset?.id === option.id}
              label={t(option.labelKey)}
              description={t(option.descriptionKey)}
              onClick={() => update({
                approvalPolicy: option.approvalPolicy,
                sandboxMode: option.sandboxMode
              })}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ExecutionRow({
  icon: Icon,
  selected,
  label,
  description,
  onClick
}: {
  icon: LucideIcon
  selected: boolean
  label: string
  description: string
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-xl px-2.5 py-2 text-left transition ${
        selected ? 'bg-ds-hover text-ds-ink' : 'hover:bg-ds-hover/70 hover:text-ds-ink'
      }`}
    >
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-ds-faint">
        <Icon className="h-4 w-4" strokeWidth={1.85} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label}</span>
        <span className="mt-0.5 block text-[11.5px] leading-4 text-ds-faint">{description}</span>
      </span>
      {selected ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} /> : null}
    </button>
  )
}

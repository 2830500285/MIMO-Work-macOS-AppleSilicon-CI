import type { ReactElement } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  formatCompactNumber,
  formatCost,
  formatPercent
} from '../../hooks/use-thread-usage'
import {
  type DailyUsageBucket,
  type DailyUsageState,
  useDailyUsageState
} from '../../hooks/use-daily-usage'
import {
  type ModelUsageState,
  useModelUsageState
} from '../../hooks/use-model-usage'
import { MimoWorkWordmarkHero } from './MimoWorkWordmarkHero'

type CalendarCell = DailyUsageBucket | null
type CalendarWeek = {
  key: string
  cells: CalendarCell[]
}
type UsageTotalsBucket = DailyUsageBucket & { days: number; activeDays: number }
type UsageViewMode = 'populated' | 'loading' | 'empty' | 'error'
type UsageRangeKey = 'all' | '90d' | '30d' | '7d'
type UsageTabKey = 'overview' | 'models'

const USAGE_HEATMAP_PREVIEW_CELLS = 14 * 7
const USAGE_HEATMAP_GRID_DAYS = 26 * 7
const USAGE_RANGE_DAYS: Record<UsageRangeKey, number> = {
  all: 365,
  '90d': 90,
  '30d': 30,
  '7d': 7
}
const USAGE_RANGE_KEYS: UsageRangeKey[] = ['all', '90d', '30d', '7d']
const MODEL_USAGE_COLORS = ['#1f2329', '#fb8147', '#fda83a', '#f3d7b7']
const MODEL_USAGE_BREAKDOWN_COLORS = {
  cachedInput: '#f3d7b7',
  uncachedInput: '#fda83a',
  output: '#fb8147'
} as const
const EMPTY_DAILY_USAGE_BUCKETS: DailyUsageBucket[] = []
export const USAGE_HEATMAP_INTENSITY_CLASSES = [
  'border-ds-border-muted bg-ds-subtle',
  'border-[rgba(251,129,71,0.28)] bg-[rgba(251,129,71,0.22)] dark:border-[rgba(251,129,71,0.32)] dark:bg-[rgba(251,129,71,0.22)]',
  'border-[#fda83a] bg-[#fda83a] dark:border-[#fda83a]/70 dark:bg-[#fda83a]',
  'border-[#fb8147] bg-[#fb8147] dark:border-[#fb8147]/80 dark:bg-[#fb8147]',
  'border-[#1f2329] bg-[#1f2329] dark:border-[#ffad7f] dark:bg-[#ffad7f]'
]

export const USAGE_HEATMAP_CONTRAST_COLORS = [
  { level: 0, light: '#f3eee8', dark: '#241f18' },
  { level: 1, light: '#f8c5aa', dark: '#5e2b19' },
  { level: 2, light: '#fda83a', dark: '#8a4a12' },
  { level: 3, light: '#fb8147', dark: '#fb8147' },
  { level: 4, light: '#1f2329', dark: '#ffad7f' }
] as const

function calendarWeeks(buckets: CalendarCell[]): CalendarWeek[] {
  const weeks: CalendarWeek[] = []
  for (let index = 0; index < buckets.length; index += 7) {
    const weekCells = buckets.slice(index, index + 7)
    while (weekCells.length < 7) weekCells.push(null)
    weeks.push({
      key: weekCells.find((cell) => cell)?.date ?? `week-${index / 7}`,
      cells: weekCells
    })
  }
  return weeks
}

export function usageHeatmapIntensityLevel(
  bucket: Pick<DailyUsageBucket, 'totalTokens' | 'turns'>,
  maxTokens: number,
  maxTurns: number
): number {
  const metric = maxTokens > 0 ? bucket.totalTokens : bucket.turns
  const max = maxTokens > 0 ? maxTokens : maxTurns
  if (metric <= 0 || max <= 0) return 0
  return Math.max(1, Math.min(4, Math.ceil((metric / max) * 4)))
}

function usageHasBucketActivity(bucket: Pick<DailyUsageBucket, 'totalTokens' | 'turns'>): boolean {
  return bucket.totalTokens > 0 || bucket.turns > 0
}

function usageStreaks(buckets: DailyUsageBucket[]): { current: number; longest: number } {
  let current = 0
  let longest = 0
  let running = 0
  for (const bucket of buckets) {
    if (usageHasBucketActivity(bucket)) {
      running += 1
      longest = Math.max(longest, running)
    } else {
      running = 0
    }
  }
  for (let index = buckets.length - 1; index >= 0; index -= 1) {
    if (!usageHasBucketActivity(buckets[index])) break
    current += 1
  }
  return { current, longest }
}

function usageRangeBuckets(buckets: DailyUsageBucket[], rangeKey: UsageRangeKey): DailyUsageBucket[] {
  if (rangeKey === 'all') return buckets
  return buckets.slice(-USAGE_RANGE_DAYS[rangeKey])
}

function usageTotalsFromBuckets(buckets: DailyUsageBucket[]): UsageTotalsBucket {
  let hasCny = false
  const totals = buckets.reduce<UsageTotalsBucket>(
    (acc, bucket) => {
      acc.inputTokens += bucket.inputTokens
      acc.outputTokens += bucket.outputTokens
      acc.reasoningTokens += bucket.reasoningTokens
      acc.cachedTokens += bucket.cachedTokens
      acc.cacheMissTokens += bucket.cacheMissTokens
      acc.totalTokens += bucket.totalTokens
      acc.costUsd += bucket.costUsd
      acc.costCny = (acc.costCny ?? 0) + (bucket.costCny ?? 0)
      acc.tokenEconomySavingsTokens += bucket.tokenEconomySavingsTokens
      acc.turns += bucket.turns
      acc.threadCount += bucket.threadCount
      if (bucket.costCny != null) hasCny = true
      if (usageHasBucketActivity(bucket)) acc.activeDays += 1
      return acc
    },
    {
      date: 'totals',
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedTokens: 0,
      cacheMissTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      costCny: 0,
      tokenEconomySavingsTokens: 0,
      turns: 0,
      threadCount: 0,
      cacheHitRate: null,
      days: buckets.length,
      activeDays: 0
    }
  )
  const cacheTotal = totals.cachedTokens + totals.cacheMissTokens
  return {
    ...totals,
    costCny: hasCny ? totals.costCny : null,
    cacheHitRate: cacheTotal > 0 ? totals.cachedTokens / cacheTotal : null
  }
}

function dailySummary(
  bucket: DailyUsageBucket,
  t: (key: string, values?: Record<string, unknown>) => string,
  locale: string
): string {
  return t('usageHeatmapDaySummary', {
    date: bucket.date,
    tokens: formatCompactNumber(bucket.totalTokens),
    cost: formatCost(bucket.costUsd, locale, bucket.costCny),
    saved: formatCompactNumber(bucket.cachedTokens),
    turns: bucket.turns,
    threads: bucket.threadCount,
    cache: formatPercent(bucket.cacheHitRate)
  })
}

function usageHasActivity(state: DailyUsageState): boolean {
  const usage = state.usage
  if (!usage) return false
  return usage.totals.activeDays > 0 || usage.buckets.some((bucket) => bucket.totalTokens > 0 || bucket.turns > 0)
}

function usageViewMode(state: DailyUsageState): UsageViewMode {
  if (usageHasActivity(state)) return 'populated'
  if (state.loading) return 'loading'
  if (state.error) return 'error'
  return 'empty'
}

function HeatmapGrid({
  buckets,
  loading,
  selected,
  onSelect
}: {
  buckets: DailyUsageBucket[]
  loading: boolean
  selected: DailyUsageBucket | null
  onSelect: (bucket: DailyUsageBucket) => void
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const weeks = useMemo(() => calendarWeeks(buckets), [buckets])
  const maxTokens = useMemo(() => Math.max(0, ...buckets.map((bucket) => bucket.totalTokens)), [buckets])
  const maxTurns = useMemo(() => Math.max(0, ...buckets.map((bucket) => bucket.turns)), [buckets])
  const skeletonWeeks = Array.from({ length: Math.ceil(USAGE_HEATMAP_GRID_DAYS / 7) }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => week * 7 + day)
  )
  const weekCount = loading ? skeletonWeeks.length : Math.max(weeks.length, 1)

  return (
    <div className="w-full min-w-0">
      <div className="max-w-full pb-1">
        <div
          className="grid w-full gap-1"
          style={{ gridTemplateColumns: `repeat(${weekCount}, minmax(0, 1fr))` }}
          aria-label={t('usageHeatmapGridLabel')}
        >
          {loading
            ? skeletonWeeks.map((week) => (
                <span key={week[0]} className="grid grid-rows-7 gap-1">
                  {week.map((cell) => (
                    <span
                      key={cell}
                      className="aspect-square w-full animate-pulse rounded-[3px] border border-ds-border-muted bg-ds-subtle"
                    />
                  ))}
                </span>
              ))
            : weeks.map((week) => (
                <span key={week.key} className="grid grid-rows-7 gap-1">
                  {week.cells.map((bucket, index) =>
                    bucket ? (
                      <button
                        key={bucket.date}
                        type="button"
                        title={dailySummary(bucket, t, i18n.language)}
                        aria-label={dailySummary(bucket, t, i18n.language)}
                        onMouseEnter={() => onSelect(bucket)}
                        onFocus={() => onSelect(bucket)}
                        onClick={() => onSelect(bucket)}
                        className={`aspect-square w-full rounded-[3px] border transition focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-ds-bg ${USAGE_HEATMAP_INTENSITY_CLASSES[usageHeatmapIntensityLevel(bucket, maxTokens, maxTurns)]} ${
                          selected?.date === bucket.date ? 'ring-2 ring-accent ring-offset-2 ring-offset-ds-bg' : ''
                        }`}
                      />
                    ) : (
                      <span
                        key={`blank-${week.key}-${index}`}
                        className="aspect-square w-full rounded-[3px] border border-ds-border-muted bg-ds-subtle"
                        aria-hidden
                      />
                    )
                  )}
                </span>
              ))}
        </div>
      </div>
    </div>
  )
}

function PreviewCalendar({ mode }: { mode: Exclude<UsageViewMode, 'populated'> }): ReactElement {
  const weeks = Array.from({ length: Math.ceil(USAGE_HEATMAP_PREVIEW_CELLS / 7) }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => week * 7 + day)
  )
  const activePattern = new Set([6, 12, 20, 24, 29, 33, 42, 57, 63, 78, 91])
  const strongPattern = new Set([24, 63, 91])
  return (
    <div className="mx-auto min-w-0 max-w-full" aria-hidden>
      <div className="max-w-full overflow-x-auto pb-1 [scrollbar-width:thin]">
        <div className="flex w-max gap-1">
          {weeks.map((week) => (
            <span key={week[0]} className="grid grid-rows-7 gap-1">
              {week.map((cell) => {
                const patterned = activePattern.has(cell)
                const strong = strongPattern.has(cell)
                const className =
                  mode === 'loading'
                    ? 'animate-pulse border-ds-border-muted bg-ds-subtle'
                    : patterned
                      ? strong
                        ? 'border-accent/35 bg-accent/35 dark:border-accent/45 dark:bg-accent/30'
                        : 'border-accent/18 bg-accent/16 dark:border-accent/25 dark:bg-accent/16'
                      : 'border-ds-border-muted bg-ds-subtle/70'
                return <span key={cell} className={`h-[13px] w-[13px] rounded-[3px] border ${className}`} />
              })}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-2 text-[10.5px] font-medium tracking-[0] text-ds-faint">
        <span className={mode === 'loading' ? 'animate-pulse' : ''}>--</span>
        <div className="flex items-center gap-1">
          {USAGE_HEATMAP_INTENSITY_CLASSES.map((className, index) => (
            <span
              key={className}
              className={`h-2.5 w-2.5 rounded-[3px] border ${index === 0 ? className : 'border-ds-border-muted bg-ds-subtle'} ${
                mode === 'loading' ? 'animate-pulse' : ''
              }`}
            />
          ))}
        </div>
        <span className={mode === 'loading' ? 'animate-pulse' : ''}>--</span>
      </div>
    </div>
  )
}

function WarmupStatePanel({
  mode,
  onRefresh
}: {
  mode: Exclude<UsageViewMode, 'populated'>
  onRefresh?: () => void
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const icon =
    mode === 'loading' ? (
      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.9} />
    ) : mode === 'error' ? (
      <AlertCircle className="h-4 w-4" strokeWidth={1.9} />
    ) : (
      <Sparkles className="h-4 w-4" strokeWidth={1.9} />
    )
  return (
    <div className="flex flex-col gap-5 border-t border-ds-border-muted pt-5 md:flex-row md:flex-wrap md:items-start md:justify-center md:gap-x-10 md:gap-y-5">
      <PreviewCalendar mode={mode} />
      <div className="w-full min-w-0 border-t border-ds-border-muted pt-5 sm:max-w-[310px] md:w-[310px] md:shrink-0 md:border-l md:border-t-0 md:pl-5 md:pt-0">
        <div
          className={`mb-3 inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12px] font-semibold ${
            mode === 'error'
              ? 'border-amber-300/35 bg-amber-50/70 text-amber-900 dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-100'
              : 'border-accent/15 bg-accent/8 text-accent'
          }`}
        >
          {icon}
          <span>{t(`usageHeatmapWarmupBadge.${mode}`)}</span>
        </div>
        <h2 className="text-[18px] font-semibold leading-7 tracking-[0] text-ds-ink">
          {t(`usageHeatmapWarmupTitle.${mode}`)}
        </h2>
        <p className="mt-2 text-[13.5px] leading-6 text-ds-muted">
          {t(`usageHeatmapWarmupSub.${mode}`)}
        </p>
        {mode === 'error' ? (
          <button
            type="button"
            className="mt-4 inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-ds-border-muted bg-ds-subtle px-3 py-1.5 text-[12.5px] font-medium text-ds-muted transition hover:text-ds-ink"
            onClick={onRefresh}
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
            <span>{t('usageHeatmapRefresh')}</span>
          </button>
        ) : null}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <span className="grid min-h-[52px] min-w-0 grid-rows-[auto_1fr] rounded-md bg-ds-subtle px-2.5 py-2">
      <span className="min-w-0 truncate whitespace-nowrap text-[12px] leading-4 text-ds-faint" title={label}>
        {label}
      </span>
      <span className="mt-0.5 min-w-0 truncate text-[15px] font-semibold leading-5 tabular-nums text-ds-ink" title={value}>
        {value}
      </span>
    </span>
  )
}

function formatChartDate(date: string, locale: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return date
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(parsed)
}

function formatTokenCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(Math.max(0, Math.round(value)))
}

function modelUsageBreakdownSummary(
  label: string,
  bucket: Pick<DailyUsageBucket, 'inputTokens' | 'outputTokens' | 'cachedTokens' | 'cacheMissTokens' | 'totalTokens'>,
  t: (key: string, values?: Record<string, unknown>) => string,
  locale: string
): string {
  return t('usageHeatmapModelTooltip', {
    label,
    total: formatTokenCount(bucket.totalTokens, locale),
    input: formatTokenCount(bucket.inputTokens, locale),
    output: formatTokenCount(bucket.outputTokens, locale),
    cacheHit: formatTokenCount(bucket.cachedTokens, locale),
    cacheMiss: formatTokenCount(bucket.cacheMissTokens, locale)
  })
}

function modelUsageChartBreakdown(
  bucket: Pick<DailyUsageBucket, 'inputTokens' | 'outputTokens' | 'cachedTokens' | 'cacheMissTokens' | 'totalTokens'>
): {
  cachedInput: number
  uncachedInput: number
  output: number
  total: number
} {
  const cachedInput = Math.max(0, bucket.cachedTokens)
  const uncachedInput = Math.max(
    0,
    bucket.cacheMissTokens > 0 ? bucket.cacheMissTokens : bucket.inputTokens - cachedInput
  )
  const output = Math.max(0, bucket.outputTokens)
  const total = Math.max(0, bucket.totalTokens, cachedInput + uncachedInput + output)
  return {
    cachedInput,
    uncachedInput,
    output,
    total
  }
}

function ModelUsagePanel({
  state,
  fallbackModel,
  locale,
  initialActiveDayIndex = null
}: {
  state: ModelUsageState
  fallbackModel: string
  locale: string
  initialActiveDayIndex?: number | null
}): ReactElement {
  const { t } = useTranslation('common')
  const usage = state.usage
  const modelBuckets = usage?.buckets ?? []
  const dayBuckets = usage?.days ?? []
  const activeDays = dayBuckets.filter((bucket) => bucket.totalTokens > 0)
  const chartDays = (activeDays.length > 0 ? activeDays : dayBuckets).slice(-5)
  const [activeDayIndex, setActiveDayIndex] = useState<number | null>(initialActiveDayIndex)
  const chartBreakdowns = useMemo(
    () => chartDays.map((bucket) => modelUsageChartBreakdown(bucket)),
    [chartDays]
  )
  const maxTokens = Math.max(1, ...chartBreakdowns.map((bucket) => bucket.total))
  const topModels = modelBuckets.slice(0, 4)
  const totalTokens = Math.max(usage?.totals.totalTokens ?? 0, 1)
  const resolvedActiveDayIndex =
    activeDayIndex != null && activeDayIndex >= 0 && activeDayIndex < chartDays.length
      ? activeDayIndex
      : null
  const activeDay = resolvedActiveDayIndex != null ? chartDays[resolvedActiveDayIndex] : null
  const activeBreakdown =
    resolvedActiveDayIndex != null ? chartBreakdowns[resolvedActiveDayIndex] : null
  const tooltipAnchorPercent =
    resolvedActiveDayIndex != null
      ? ((resolvedActiveDayIndex + 0.5) / Math.max(chartDays.length, 1)) * 100
      : 50
  const tooltipTransformClass =
    resolvedActiveDayIndex == null || (resolvedActiveDayIndex > 0 && resolvedActiveDayIndex < chartDays.length - 1)
      ? '-translate-x-1/2'
      : resolvedActiveDayIndex === 0
        ? 'translate-x-0'
        : '-translate-x-full'
  const tooltipRows = activeBreakdown
    ? [
        {
          key: 'cached-input',
          label: t('usageHeatmapModelTooltipCachedInput'),
          value: activeBreakdown.cachedInput,
          color: MODEL_USAGE_BREAKDOWN_COLORS.cachedInput
        },
        {
          key: 'uncached-input',
          label: t('usageHeatmapModelTooltipUncachedInput'),
          value: activeBreakdown.uncachedInput,
          color: MODEL_USAGE_BREAKDOWN_COLORS.uncachedInput
        },
        {
          key: 'output',
          label: t('usageHeatmapModelTooltipOutput'),
          value: activeBreakdown.output,
          color: MODEL_USAGE_BREAKDOWN_COLORS.output
        }
      ]
    : []

  if (state.loading && !usage) {
    return (
      <div className="grid min-h-[180px] place-items-center text-[12px] text-ds-faint">
        {t('usageHeatmapLoading')}
      </div>
    )
  }

  if (modelBuckets.length === 0) {
    return (
      <div className="grid min-h-[180px] place-items-center rounded-md bg-ds-subtle text-[12px] text-ds-faint">
        {t('usageHeatmapModelsEmpty', { model: fallbackModel || '-' })}
      </div>
    )
  }

  return (
    <div className="min-w-0">
      <div className="mb-3 flex items-baseline gap-3 px-1">
        <span className="text-[13px] font-medium text-ds-muted">{t('usageHeatmapTokens')}</span>
        <span className="text-[20px] font-semibold tabular-nums text-ds-ink">
          {formatTokenCount(usage?.totals.totalTokens ?? 0, locale)}
        </span>
      </div>
      <div className="grid min-h-[206px] grid-cols-[44px_1fr] gap-2">
        <div className="grid grid-rows-5 pb-5 pt-14 text-right text-[11px] leading-none text-ds-faint">
          {[1, 0.75, 0.5, 0.25, 0].map((ratio) => (
            <span key={ratio}>
              {ratio === 0 ? '0' : formatCompactNumber(maxTokens * ratio)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0" onMouseLeave={() => setActiveDayIndex(null)}>
          {activeDay && activeBreakdown ? (
            <div
              className={`pointer-events-none absolute top-0 z-20 w-[min(18rem,calc(100vw-4rem))] max-w-full rounded-[18px] border border-ds-border bg-ds-card/98 p-3 shadow-[0_18px_46px_rgba(31,35,41,0.12)] backdrop-blur-xl ${tooltipTransformClass}`}
              style={{ left: `${tooltipAnchorPercent}%` }}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="text-[12.5px] font-semibold text-ds-ink">{activeDay.date}</span>
                <span className="whitespace-nowrap text-[12.5px] font-semibold tabular-nums text-ds-ink">
                  {t('usageHeatmapModelTooltipTotalTokens', {
                    value: formatTokenCount(activeBreakdown.total, locale)
                  })}
                </span>
              </div>
              <div className="mt-2 grid gap-1.5">
                {tooltipRows.map((row) => (
                  <div
                    key={row.key}
                    className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-[12px] leading-5"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-[3px]"
                      style={{ backgroundColor: row.color }}
                      aria-hidden
                    />
                    <span className="min-w-0 text-ds-muted">{row.label}</span>
                    <span className="whitespace-nowrap tabular-nums text-ds-ink">
                      {t('usageHeatmapModelTooltipTotalTokens', {
                        value: formatTokenCount(row.value, locale)
                      })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="grid min-h-[150px] min-w-0 grid-flow-col items-end gap-2 pt-14">
          {chartDays.map((bucket, index) => {
            const breakdown = chartBreakdowns[index]
            const segments = [
              {
                key: 'output',
                value: breakdown.output,
                color: MODEL_USAGE_BREAKDOWN_COLORS.output
              },
              {
                key: 'uncached-input',
                value: breakdown.uncachedInput,
                color: MODEL_USAGE_BREAKDOWN_COLORS.uncachedInput
              },
              {
                key: 'cached-input',
                value: breakdown.cachedInput,
                color: MODEL_USAGE_BREAKDOWN_COLORS.cachedInput
              }
            ]
            const dateLabel = formatChartDate(bucket.date, locale)
            const summary = modelUsageBreakdownSummary(dateLabel, bucket, t, locale)
            const active = resolvedActiveDayIndex === index
            const barHeight = Math.max(8, (breakdown.total / maxTokens) * 112)
            return (
              <div key={`${bucket.date}-${index}`} className="relative grid min-w-0 grid-rows-[1fr_auto] gap-2">
                {active ? (
                  <span
                    className="pointer-events-none absolute bottom-5 left-1/2 top-0 z-0 w-px -translate-x-1/2 border-l border-dashed border-accent/35"
                    aria-hidden
                  />
                ) : null}
                <button
                  type="button"
                  title={summary}
                  aria-label={summary}
                  onMouseEnter={() => setActiveDayIndex(index)}
                  onFocus={() => setActiveDayIndex(index)}
                  onClick={() => setActiveDayIndex(index)}
                  className="relative z-[1] flex min-h-[112px] items-end rounded-[10px] px-1 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:ring-offset-2 focus:ring-offset-ds-bg"
                >
                  <span
                    className={`flex w-full flex-col-reverse overflow-hidden rounded-t-[6px] shadow-[inset_0_1px_0_rgba(255,255,255,0.36)] transition ${
                      active ? 'ring-1 ring-accent/18' : ''
                    }`}
                    style={{ height: `${barHeight}px` }}
                  >
                    {segments.map((segment) => {
                      const ratio = breakdown.total > 0 ? segment.value / breakdown.total : 0
                      if (ratio <= 0) return null
                      return (
                        <span
                          key={segment.key}
                          className="w-full border-t border-white/35 dark:border-white/10"
                          style={{
                            height: `${Math.max(4, ratio * barHeight)}px`,
                            backgroundColor: segment.color
                          }}
                        />
                      )
                    })}
                  </span>
                </button>
                <span className="truncate text-center text-[11px] text-ds-faint">
                  {dateLabel}
                </span>
              </div>
            )
          })}
          </div>
        </div>
      </div>
      <div className="mt-3 grid gap-1.5">
        {topModels.map((bucket, index) => {
          const percent = (bucket.totalTokens / totalTokens) * 100
          const summary = modelUsageBreakdownSummary(bucket.model, bucket, t, locale)
          return (
            <div
              key={bucket.model}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,auto)_auto] items-center gap-3 text-[12px] leading-5"
              title={summary}
              aria-label={summary}
            >
              <span className="flex min-w-0 items-center gap-1.5 text-ds-ink">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: MODEL_USAGE_COLORS[index % MODEL_USAGE_COLORS.length] }}
                />
                <span className="truncate">{bucket.model}</span>
              </span>
              <span className="min-w-0 truncate whitespace-nowrap text-right tabular-nums text-ds-faint">
                {t('usageHeatmapModelTokenBreakdown', {
                  input: formatCompactNumber(bucket.inputTokens),
                  output: formatCompactNumber(bucket.outputTokens),
                  cacheHit: formatCompactNumber(bucket.cachedTokens),
                  cacheMiss: formatCompactNumber(bucket.cacheMissTokens)
                })}
              </span>
              <span className="min-w-[3.2rem] text-right tabular-nums font-semibold text-ds-ink">
                {percent.toFixed(percent >= 10 ? 1 : 1)}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function UsageHeroSection({
  title,
  sub,
  showText = true
}: {
  title: string
  sub: string
  showText?: boolean
}): ReactElement {
  return (
    <div className="flex w-full min-w-0 flex-col items-center text-center">
      <MimoWorkWordmarkHero />
      {showText ? (
        <>
          <h1 className="max-w-[620px] text-[28px] font-semibold leading-tight tracking-[0] text-ds-ink sm:text-[32px]">
            {title}
          </h1>
          <p className="mt-3 max-w-[680px] text-[14.5px] leading-7 text-ds-muted">
            {sub}
          </p>
        </>
      ) : null}
    </div>
  )
}

function UsagePanelCard({ children }: { children: ReactElement }): ReactElement {
  return (
    <div className="w-full min-w-0 rounded-[28px] border border-ds-border-muted bg-ds-card/82 p-4 shadow-[0_18px_48px_rgba(31,35,41,0.08)] dark:bg-white/[0.045] sm:p-5">
      {children}
    </div>
  )
}

export function InitialSessionUsageHeatmap({
  hideHero = false
}: {
  hideHero?: boolean
} = {}): ReactElement {
  const [refreshKey, setRefreshKey] = useState(0)
  const [rangeKey, setRangeKey] = useState<UsageRangeKey>('all')
  const state = useDailyUsageState(true, refreshKey, USAGE_RANGE_DAYS.all)
  const modelState = useModelUsageState(true, `${refreshKey}:${rangeKey}`, USAGE_RANGE_DAYS[rangeKey])

  return (
    <InitialSessionUsageHeatmapView
      state={state}
      modelState={modelState}
      rangeKey={rangeKey}
      hideHero={hideHero}
      onRangeChange={setRangeKey}
      onRefresh={() => setRefreshKey((value) => value + 1)}
    />
  )
}

export function AccountUsageOverviewPanel(): ReactElement {
  const [refreshKey, setRefreshKey] = useState(0)
  const [rangeKey, setRangeKey] = useState<UsageRangeKey>('all')
  const state = useDailyUsageState(true, refreshKey, USAGE_RANGE_DAYS.all)
  const modelState = useModelUsageState(true, `${refreshKey}:${rangeKey}`, USAGE_RANGE_DAYS[rangeKey])

  return (
    <InitialSessionUsageHeatmapView
      state={state}
      modelState={modelState}
      rangeKey={rangeKey}
      hideHero
      compact
      onRangeChange={setRangeKey}
      onRefresh={() => setRefreshKey((value) => value + 1)}
    />
  )
}

export function InitialSessionUsageHeatmapView({
  state,
  modelState = { usage: null, loading: false, loaded: false, error: null },
  rangeKey = 'all',
  initialActiveTab = 'overview',
  initialModelHoverIndex = null,
  hideHero = false,
  compact = false,
  onRangeChange,
  onRefresh
}: {
  state: DailyUsageState
  modelState?: ModelUsageState
  rangeKey?: UsageRangeKey
  initialActiveTab?: UsageTabKey
  initialModelHoverIndex?: number | null
  hideHero?: boolean
  compact?: boolean
  onRangeChange?: (rangeKey: UsageRangeKey) => void
  onRefresh?: () => void
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const [activeBucket, setActiveBucket] = useState<DailyUsageBucket | null>(null)
  const [activeTab, setActiveTab] = useState<UsageTabKey>(initialActiveTab)
  const [modelLabel, setModelLabel] = useState('')
  const usage = state.usage
  const buckets = usage?.buckets ?? EMPTY_DAILY_USAGE_BUCKETS
  const metricBuckets = useMemo(() => usageRangeBuckets(buckets, rangeKey), [buckets, rangeKey])
  const heatmapBuckets = useMemo(() => buckets.slice(-USAGE_HEATMAP_GRID_DAYS), [buckets])
  const totals = useMemo(() => usageTotalsFromBuckets(metricBuckets), [metricBuckets])
  const mode = usageViewMode(state)
  const streaks = useMemo(() => usageStreaks(metricBuckets), [metricBuckets])
  const overviewMetrics = [
    { label: t('usageHeatmapSessions'), value: formatCompactNumber(totals.threadCount) },
    { label: t('usageHeatmapMessages'), value: formatCompactNumber(totals.turns) },
    { label: t('usageHeatmapTotalTokens'), value: formatCompactNumber(totals.totalTokens) },
    { label: t('usageHeatmapActiveDays'), value: String(totals.activeDays) },
    { label: t('usageHeatmapCurrentStreak'), value: t('usageHeatmapStreakDays', { count: streaks.current }) },
    { label: t('usageHeatmapLongestStreak'), value: t('usageHeatmapStreakDays', { count: streaks.longest }) },
    { label: t('usageHeatmapCost'), value: formatCost(totals.costUsd, i18n.language, totals.costCny) },
    {
      label: t('usageHeatmapCacheSavings'),
      value: t('usageHeatmapSavedTokensValue', { tokens: formatCompactNumber(totals.cachedTokens) })
    },
    {
      label: t('usageHeatmapContextSavings'),
      value: t('usageHeatmapSavedTokensValue', {
        tokens: formatCompactNumber(totals.tokenEconomySavingsTokens)
      })
    },
    { label: t('usageHeatmapCache'), value: formatPercent(totals.cacheHitRate) }
  ]
  const heroTitle =
    mode === 'populated'
      ? t('usageHeatmapTitle')
      : t(`usageHeatmapHeroTitle.${mode}`)
  const heroSub =
    mode === 'populated'
      ? t('usageHeatmapSub')
      : t(`usageHeatmapHeroSub.${mode}`)
  const rootClassName = compact
    ? 'ds-initial-usage-heatmap ds-account-usage-panel ds-no-drag w-full min-w-0 text-left'
    : 'ds-initial-usage-heatmap ds-no-drag mx-auto flex min-h-[min(620px,calc(100dvh-220px))] w-full items-center justify-center px-3 py-6 text-left sm:px-5 sm:py-8'
  const contentClassName = compact
    ? 'flex w-full min-w-0 flex-col gap-3'
    : 'flex w-full max-w-[980px] min-w-0 flex-col gap-5'

  useEffect(() => {
    let cancelled = false
    if (typeof window === 'undefined' || typeof window.kunGui?.getSettings !== 'function') return
    void window.kunGui.getSettings()
      .then((settings) => {
        if (!cancelled) setModelLabel(settings.agents.kun.model.trim())
      })
      .catch(() => {
        if (!cancelled) setModelLabel('')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className={rootClassName}>
      <div className={contentClassName}>
        {!hideHero ? (
          <UsageHeroSection
            title={heroTitle}
            sub={heroSub}
            showText={mode !== 'populated'}
          />
        ) : null}
        {hideHero ? (
          <UsagePanelCard>
            {mode === 'populated' ? (
              <div className="mx-auto flex w-full max-w-[560px] min-w-0 flex-col gap-3">
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="inline-flex w-fit max-w-full rounded-lg bg-ds-subtle p-1 text-[12.5px] font-medium text-ds-muted">
                    <button
                      type="button"
                      className={`min-h-7 rounded-md px-3 transition ${
                        activeTab === 'overview' ? 'bg-ds-card text-ds-ink shadow-sm dark:bg-white/10' : 'hover:text-ds-ink'
                      }`}
                      aria-pressed={activeTab === 'overview'}
                      onClick={() => setActiveTab('overview')}
                    >
                      {t('usageHeatmapTabOverview')}
                    </button>
                    <button
                      type="button"
                      className={`min-h-7 rounded-md px-3 transition ${
                        activeTab === 'models' ? 'bg-ds-card text-ds-ink shadow-sm dark:bg-white/10' : 'hover:text-ds-ink'
                      }`}
                      title={t('usageHeatmapTabModels')}
                      aria-pressed={activeTab === 'models'}
                      onClick={() => setActiveTab('models')}
                    >
                      {t('usageHeatmapTabModels')}
                    </button>
                  </div>
                  <div className="flex min-w-0 items-center gap-1 self-start rounded-lg bg-ds-subtle p-1 text-[12px] font-medium text-ds-muted sm:self-auto">
                    {USAGE_RANGE_KEYS.map((key) => (
                      <button
                        key={key}
                        type="button"
                        className={`min-h-7 rounded-md px-2.5 transition ${
                          rangeKey === key ? 'bg-ds-card text-ds-ink shadow-sm dark:bg-white/10' : 'hover:text-ds-ink'
                        }`}
                        aria-pressed={rangeKey === key}
                        onClick={() => onRangeChange?.(key)}
                      >
                        {t(`usageHeatmapRange.${key}`)}
                      </button>
                    ))}
                  </div>
                </div>
                {activeTab === 'overview' ? (
                  <>
                    <div className="grid min-w-0 grid-cols-2 gap-1.5 sm:grid-cols-4">
                      {overviewMetrics.map((metric) => (
                        <Metric key={metric.label} label={metric.label} value={metric.value} />
                      ))}
                    </div>
                    <HeatmapGrid
                      buckets={heatmapBuckets}
                      loading={state.loading && heatmapBuckets.length === 0}
                      selected={activeBucket}
                      onSelect={setActiveBucket}
                    />
                    <p className="text-[11.5px] leading-5 text-ds-faint">
                      {t('usageHeatmapOverviewCaption', {
                        tokens: formatCompactNumber(totals.totalTokens),
                        activeDays: totals.activeDays
                      })}
                    </p>
                  </>
                ) : (
                  <ModelUsagePanel
                    state={modelState}
                    fallbackModel={modelLabel}
                    locale={i18n.language}
                    initialActiveDayIndex={initialModelHoverIndex}
                  />
                )}
              </div>
            ) : (
              <>
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                  <button
                    type="button"
                    className="inline-flex min-h-9 w-full shrink-0 items-center justify-center gap-2 rounded-lg border border-ds-border-muted bg-ds-subtle px-3 py-1.5 text-[12.5px] font-medium text-ds-muted transition hover:text-ds-ink disabled:opacity-60 sm:w-auto"
                    onClick={onRefresh}
                    disabled={state.loading}
                    title={t('usageHeatmapRefresh')}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${state.loading ? 'animate-spin' : ''}`} strokeWidth={1.8} />
                    <span>{t('usageHeatmapRefresh')}</span>
                  </button>
                </div>
                <WarmupStatePanel mode={mode} onRefresh={onRefresh} />
              </>
            )}
          </UsagePanelCard>
        ) : null}
      </div>
    </div>
  )
}

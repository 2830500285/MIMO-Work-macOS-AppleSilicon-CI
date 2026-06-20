import type { ReactElement } from 'react'
import { MimoWorkWordmarkHero } from './MimoWorkWordmarkHero'

/**
 * 启动 / 运行时重连舞台。可见内容统一使用 MIMO Work 品牌字标,
 * 避免刚启动时仍露出 Kun 旧插画。
 */
export function KunHeroStage({ waking = false }: { waking?: boolean }): ReactElement {
  return (
    <div
      className={waking ? 'ds-runtime-wake-stage is-waking' : 'ds-runtime-wake-stage'}
      aria-hidden="true"
    >
      <MimoWorkWordmarkHero />
    </div>
  )
}

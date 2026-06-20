import type { ReactElement } from 'react'
import mimoWorkIcon from '../../../../asset/img/mimo-work.png'

const MIMO_WORDMARK_ORANGE = '#ff7a3d'
const MIMO_WORDMARK_GREY = '#9fa2a0'
const MIMO_WORDMARK_XIAOMI = '#b4b5b2'
const MIMO_WORDMARK_GLYPHS = {
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001']
} as const

type MimoWordmarkGlyph = keyof typeof MIMO_WORDMARK_GLYPHS

function MimoWordmarkGlyph({
  glyph,
  x,
  y,
  color
}: {
  glyph: MimoWordmarkGlyph
  x: number
  y: number
  color: string
}): ReactElement {
  const cell = 10
  return (
    <g transform={`translate(${x} ${y})`} fill={color}>
      {MIMO_WORDMARK_GLYPHS[glyph].flatMap((row, rowIndex) =>
        [...row].map((value, columnIndex) =>
          value === '1' ? (
            <rect
              key={`${rowIndex}-${columnIndex}`}
              x={columnIndex * cell}
              y={rowIndex * cell}
              width={cell}
              height={cell}
            />
          ) : null
        )
      )}
    </g>
  )
}

export function MimoWorkSvgWordmark(): ReactElement {
  const letters: Array<{ glyph: MimoWordmarkGlyph; color: string; gapAfter?: number }> = [
    { glyph: 'M', color: MIMO_WORDMARK_ORANGE },
    { glyph: 'I', color: MIMO_WORDMARK_ORANGE },
    { glyph: 'M', color: MIMO_WORDMARK_ORANGE },
    { glyph: 'O', color: MIMO_WORDMARK_ORANGE, gapAfter: 22 },
    { glyph: 'W', color: MIMO_WORDMARK_GREY },
    { glyph: 'O', color: MIMO_WORDMARK_GREY },
    { glyph: 'R', color: MIMO_WORDMARK_GREY },
    { glyph: 'K', color: MIMO_WORDMARK_GREY }
  ]
  const positions: number[] = []
  let cursor = 28
  for (const letter of letters) {
    positions.push(cursor)
    cursor += 50 + (letter.gapAfter ?? 9)
  }

  return (
    <svg
      className="ds-mimo-wordmark-svg"
      viewBox="0 0 520 116"
      role="img"
      aria-label="MIMO Work"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>MIMO Work</title>
      {[...'XIAOMI'].map((letter, index) => (
        <text
          key={`${letter}-${index}`}
          x={421 + index * 13}
          y="23"
          fill={MIMO_WORDMARK_XIAOMI}
          fontFamily="Arial, Helvetica, sans-serif"
          fontSize="11"
          fontWeight="600"
          textAnchor="middle"
        >
          {letter}
        </text>
      ))}
      {letters.map((letter, index) => (
        <MimoWordmarkGlyph
          key={`${letter.glyph}-${index}`}
          glyph={letter.glyph}
          x={positions[index]}
          y={37}
          color={letter.color}
        />
      ))}
    </svg>
  )
}

export function MimoWorkWordmarkHero(): ReactElement {
  return (
    <div className="ds-mimo-wordmark-hero">
      <MimoWorkSvgWordmark />
    </div>
  )
}

export function MimoWorkMiniMark({ active = false }: { active?: boolean }): ReactElement {
  return (
    <span className={active ? 'ds-mimo-mini-mark is-active' : 'ds-mimo-mini-mark'} aria-hidden="true">
      <img src={mimoWorkIcon} alt="" draggable={false} decoding="async" />
    </span>
  )
}

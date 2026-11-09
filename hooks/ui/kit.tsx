// Pieces every view shares: headings, sections, gauges, stats, chips, cards.
// Each piece draws on every surface: the terminal gets text (it has no Svg),
// desktop, vscode and mobile may get an SVG drawing with the same meaning.
import type { On as EngineOn, RenderSurface } from 'claude-code'

import { levelColor } from '../lib'
import type { IconName } from './icons'
import { Icon } from './icons'
import type { Ramp } from './theme'
import { C, PROGRESS_RAMP, RISK_RAMP, rampAt } from './theme'

export type On = EngineOn

// An element constructor from `$.ui.resolve(e)`.
export type El = (props: any) => any

/** The surface's element table, as `$.ui.resolve(e)` returns it. */
export type Els = { Box: El; Text: El; Button: El; Svg?: El; Image?: El; Raster?: El; Markdown?: El; Code?: El; Link?: El }

export const str = (v: unknown) => (typeof v === 'string' ? v : '')

/**
 * The surface to draw for: the one given, or, when a caller has none to pass,
 * read from the table itself (only the terminal lacks `Svg`). Either way a
 * piece never reaches for an element the table does not hold.
 */
export const surfaceOf = (el: Els, surface?: RenderSurface): RenderSurface => surface ?? (el.Svg ? 'desktop' : 'terminal')

/** True where `Svg` may be drawn. */
export const canSvg = (el: Els, surface?: RenderSurface) => surfaceOf(el, surface) !== 'terminal' && el.Svg !== undefined

export const Heading = ({ el, children }: { el: Els; children?: any }) => (
  <el.Text mono size="caption" weight="bold" color={C.teal}>
    {children}
  </el.Text>
)

/** A thin rule of `width` cells. */
export const Rule = ({ el, width = 24, color = C.line }: { el: Els; width?: number; color?: string }) => (
  <el.Text color={color} wrap="truncate-end">
    {'─'.repeat(Math.max(1, width))}
  </el.Text>
)

/** An icon, a CAPS heading and a rule, with the section's rows beneath. */
export const Section = ({
  el,
  surface,
  icon,
  title,
  right,
  accent = C.teal,
  children,
}: {
  el: Els
  surface?: RenderSurface
  icon?: IconName
  title: string
  /** Drawn after the heading: a count, a chip. */
  right?: any
  accent?: string
  children?: any
}) => (
  <el.Box flexDirection="column" gap={0}>
    <el.Box flexDirection="row" gap={1} alignItems="center">
      {icon && <Icon el={el} surface={surfaceOf(el, surface)} name={icon} color={accent} />}
      <el.Text mono size="caption" weight="bold" color={accent}>
        {title.toUpperCase()}
      </el.Text>
      {right}
      <Rule el={el} width={Math.max(4, 26 - title.length)} />
    </el.Box>
    {children}
  </el.Box>
)

// ---------- Bars and gauges ----------

const BAR_W = 240
const BAR_H = 8

/** A segmented bar as SVG markup: filled segments wear the ramp, empty ones the line colour. */
export const barSvg = (pct: number, segments = 24, ramp: Ramp = RISK_RAMP, animate = true) => {
  const p = Math.max(0, Math.min(100, pct))
  const filled = Math.round((p / 100) * segments)
  const gap = 2
  const w = (BAR_W - gap * (segments - 1)) / segments
  const stops = ramp.map(s => `<stop offset="${Math.round(s.at * 100)}%" stop-color="${s.color}"/>`).join('')
  const rects: string[] = []
  for (let i = 0; i < segments; i++) {
    const x = (i * (w + gap)).toFixed(2)
    if (i < filled) {
      // Each filled segment fades in after the one before it, once per draw.
      const dur = 0.25 + i * 0.025
      const hold = ((i * 0.025) / dur).toFixed(3)
      const anim = animate ? `<animate attributeName="opacity" values="0;0;1" keyTimes="0;${hold};1" dur="${dur.toFixed(3)}s" fill="freeze"/>` : ''
      rects.push(`<rect x="${x}" y="0" width="${w.toFixed(2)}" height="${BAR_H}" rx="1.5" fill="url(#ramp)">${anim}</rect>`)
    } else {
      rects.push(`<rect x="${x}" y="0" width="${w.toFixed(2)}" height="${BAR_H}" rx="1.5" fill="${C.panel3}" stroke="${C.line}" stroke-width="0.6"/>`)
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BAR_W}" height="${BAR_H}" viewBox="0 0 ${BAR_W} ${BAR_H}">` +
    `<defs><linearGradient id="ramp" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${BAR_W}" y2="0">${stops}</linearGradient></defs>` +
    rects.join('') +
    '</svg>'
  )
}

/** Terminal cells of a segmented bar, grouped into runs of one colour. */
export const barRuns = (pct: number, cells = 24, ramp: Ramp = RISK_RAMP) => {
  const p = Math.max(0, Math.min(100, pct))
  const filled = Math.max(0, Math.min(cells, Math.round((p / 100) * cells)))
  const runs: { text: string; color: string }[] = []
  for (let i = 0; i < cells; i++) {
    const isOn = i < filled
    const color = isOn ? rampAt(ramp, cells > 1 ? i / (cells - 1) : 0) : C.line
    const ch = isOn ? '▰' : '▱'
    const last = runs.at(-1)
    if (last && last.color === color) last.text += ch
    else runs.push({ text: ch, color })
  }
  return runs
}

/** A segmented bar: SVG where the surface draws it, coloured cells in the terminal. */
export const Bar = ({
  el,
  surface,
  pct,
  cells = 24,
  ramp = RISK_RAMP,
  alt,
}: {
  el: Els
  surface?: RenderSurface
  pct: number
  cells?: number
  ramp?: Ramp
  alt?: string
}) => {
  const label = alt ?? `${Math.round(pct)}% full`
  if (canSvg(el, surface) && el.Svg) {
    return <el.Svg source={barSvg(pct, cells, ramp)} alt={label} isInteractive />
  }
  return (
    <el.Box flexDirection="row" gap={0}>
      {barRuns(pct, cells, ramp).map(r => (
        <el.Text color={r.color}>{r.text}</el.Text>
      ))}
    </el.Box>
  )
}

/** A labelled gauge: label and percentage, a segmented bar, an optional note and rows beneath. */
export const Gauge = ({
  el,
  label,
  pct,
  note,
  surface,
  icon,
  ramp = RISK_RAMP,
  children,
}: {
  el: Els
  label: string
  pct: number
  note?: string
  surface?: RenderSurface
  icon?: IconName
  ramp?: Ramp
  children?: any
}) => (
  <el.Box flexDirection="column" gap={0}>
    <el.Box flexDirection="row" justifyContent="space-between" gap={1}>
      <el.Box flexDirection="row" gap={1}>
        {icon && <Icon el={el} surface={surfaceOf(el, surface)} name={icon} color={C.text2} />}
        <el.Text weight="semibold" color={C.text}>
          {label}
        </el.Text>
      </el.Box>
      <el.Text mono tabular weight="bold" color={levelColor(pct)}>
        {Math.round(pct)}%
      </el.Text>
    </el.Box>
    <Bar el={el} surface={surface} pct={pct} ramp={ramp} alt={`${label}: ${Math.round(pct)}% used`} />
    {note && (
      <el.Text size="footnote" color={C.text2}>
        {note}
      </el.Text>
    )}
    {children}
  </el.Box>
)

/** A small note row: an icon and a footnote. */
export const Note = ({
  el,
  surface,
  icon,
  color = C.text2,
  children,
}: {
  el: Els
  surface?: RenderSurface
  icon?: IconName
  color?: string
  children?: any
}) => (
  <el.Box flexDirection="row" gap={1}>
    {icon && <Icon el={el} surface={surfaceOf(el, surface)} name={icon} color={color} />}
    <el.Text size="footnote" color={color}>
      {children}
    </el.Text>
  </el.Box>
)

/** A label over a big value. */
export const Stat = ({
  el,
  surface,
  icon,
  label,
  value,
  color = C.text,
  sub,
}: {
  el: Els
  surface?: RenderSurface
  icon?: IconName
  label: string
  value: string
  color?: string
  sub?: string
}) => (
  <el.Box flexDirection="column" gap={0}>
    <el.Box flexDirection="row" gap={1}>
      {icon && <Icon el={el} surface={surfaceOf(el, surface)} name={icon} color={C.text2} />}
      <el.Text mono size="caption" color={C.text2}>
        {label.toUpperCase()}
      </el.Text>
    </el.Box>
    <el.Text mono tabular size="heading" weight="bold" color={color}>
      {value}
    </el.Text>
    {sub && (
      <el.Text size="footnote" color={C.text3}>
        {sub}
      </el.Text>
    )}
  </el.Box>
)

/** A filled chip: dark text on an accent, for a count or a state. */
export const Chip = ({ el, label, color = C.gold, fg = C.ink }: { el: Els; label: string; color?: string; fg?: string }) => (
  <el.Text mono weight="bold" color={fg} backgroundColor={color}>
    {` ${label} `}
  </el.Text>
)

/** A quiet pill: accent text on a raised panel. */
export const Pill = ({ el, label, color = C.teal }: { el: Els; label: string; color?: string }) => (
  <el.Text mono size="caption" color={color} backgroundColor={C.panel2}>
    {` ${label} `}
  </el.Text>
)

/** A bordered card on the panel colour; the border says its kind. */
export const Card = ({ el, accent = C.line, children }: { el: Els; accent?: string; children?: any }) => (
  <el.Box flexDirection="column" gap={0} borderStyle="round" borderColor={accent} backgroundColor={C.panel} paddingX={1}>
    {children}
  </el.Box>
)

export { PROGRESS_RAMP, RISK_RAMP }

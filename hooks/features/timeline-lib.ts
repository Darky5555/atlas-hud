// Pure helpers for the Timeline tab: no `$`, so the tests can call them directly.
import type { Step, Turn, TurnTokens } from '../../types'
import type { IconName } from '../ui/icons'
import { C } from '../ui/theme'

/** How many turns the token chart shows. */
export const CHART_TURNS = 20
/** How many files "Files touched" lists. */
export const TOP_FILES = 8

/** Every token the turn's requests counted, cached reads included. */
export const tokenTotal = (t: TurnTokens | undefined) =>
  t ? t.input + t.output + t.cacheRead + t.cacheWrite : undefined

/** `e.usage` of `turn.complete` as stored, or undefined when it reported none. */
export const tokensOf = (u: unknown): TurnTokens | undefined => {
  if (!u || typeof u !== 'object') return undefined
  const o = u as Record<string, unknown>
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0)
  return {
    input: n(o.input_tokens),
    output: n(o.output_tokens),
    cacheRead: n(o.cache_read_input_tokens),
    cacheWrite: n(o.cache_creation_input_tokens),
  }
}

const UNITS = [
  [1, ''],
  [1000, 'k'],
  [1_000_000, 'M'],
] as const

/**
 * 950, 1.2k, 48k, 1.3M: one decimal under ten of a unit. Rounded first, then
 * the unit picked, so 999,600 reads 1M (not 1000k).
 */
export const compact = (n: number) => {
  if (!Number.isFinite(n)) return '0'
  const a = Math.abs(n)
  for (let i = 0; i < UNITS.length; i++) {
    const [size, unit] = UNITS[i]!
    const digits = size > 1 && a / size < 10 ? 1 : 0
    const r = Math.round((a / size) * 10 ** digits) / 10 ** digits
    if (r < 1000 || i === UNITS.length - 1) return `${n < 0 && r > 0 ? '-' : ''}${r.toFixed(digits).replace(/\.0$/, '')}${unit}`
  }
  return '0'
}

/** The tool calls a turn made, or undefined for a turn stored before they were counted. */
export const toolCount = (t: Pick<Turn, 'tools'>) =>
  t.tools ? Object.values(t.tools).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0) : undefined

/** The token series of the last `CHART_TURNS` turns, oldest first; undefined where a turn has none. */
export const tokenSeries = (list: readonly Turn[]) => list.slice(-CHART_TURNS).map(t => tokenTotal(t.tokens))

/** min, max and total over the turns that have counts, or undefined when none does. */
export const tokenStats = (series: readonly (number | undefined)[]) => {
  const known = series.filter((v): v is number => v !== undefined)
  if (!known.length) return undefined
  return { min: Math.min(...known), max: Math.max(...known), total: known.reduce((a, b) => a + b, 0), count: known.length }
}

const BLOCKS = '▁▂▃▄▅▆▇█'

/** One cell per turn, scaled to the highest; `·` for a turn with no counts. */
export const sparkline = (series: readonly (number | undefined)[]) => {
  const max = Math.max(0, ...series.filter((v): v is number => v !== undefined))
  return series
    .map(v => {
      if (v === undefined) return '·'
      if (max <= 0) return BLOCKS[0]
      const i = Math.max(0, Math.min(BLOCKS.length - 1, Math.round((v / max) * (BLOCKS.length - 1))))
      return BLOCKS[i]
    })
    .join('')
}

export const CHART_W = 240
export const CHART_H = 56

/**
 * The token chart as SVG markup: one bar per turn, oldest left, the newest in
 * gold; a turn with no counts is a dot on the baseline. Static (no script, no
 * handlers, no animation).
 */
export const chartSvg = (series: readonly (number | undefined)[]) => {
  const slots = Math.max(series.length, 1)
  const gap = 2
  const w = Math.max(1, (CHART_W - gap * (slots - 1)) / slots)
  const base = CHART_H - 2
  const max = Math.max(0, ...series.filter((v): v is number => v !== undefined))
  const parts: string[] = []
  // Faint guides at a quarter, a half and three quarters of the highest turn.
  for (const f of [0.25, 0.5, 0.75]) {
    const y = (base - f * (base - 2)).toFixed(1)
    parts.push(`<line x1="0" y1="${y}" x2="${CHART_W}" y2="${y}" stroke="${C.line}" stroke-width="0.5" stroke-dasharray="2 3"/>`)
  }
  series.forEach((v, i) => {
    const x = i * (w + gap)
    if (v === undefined) {
      parts.push(`<circle cx="${(x + w / 2).toFixed(2)}" cy="${base - 1}" r="1" fill="${C.text3}"/>`)
      return
    }
    const h = max > 0 ? Math.max(1.5, (v / max) * (base - 2)) : 1.5
    const isNewest = i === series.length - 1
    const fill = isNewest ? C.gold : 'url(#tok)'
    parts.push(
      `<rect x="${x.toFixed(2)}" y="${(base - h).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="1.5" fill="${fill}"/>`,
    )
  })
  parts.push(`<line x1="0" y1="${base + 0.5}" x2="${CHART_W}" y2="${base + 0.5}" stroke="${C.line2}" stroke-width="1"/>`)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_W}" height="${CHART_H}" viewBox="0 0 ${CHART_W} ${CHART_H}">` +
    `<defs><linearGradient id="tok" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="${C.teal2}"/><stop offset="100%" stop-color="${C.teal}"/></linearGradient></defs>` +
    `<rect x="0" y="0" width="${CHART_W}" height="${CHART_H}" rx="3" fill="${C.panel}"/>` +
    parts.join('') +
    '</svg>'
  )
}

/** The last two parts of a path: `styles/theme.css`. */
export const shortPath = (p: string) => p.split('/').filter(Boolean).slice(-2).join('/') || p

export type FileRow = { path: string; count: number; isCreated: boolean; lastAt: number }

/**
 * The files changed most across the stored turns: each Edit or Write counts
 * once (a turn stored before those were counted counts each file once).
 * Ties go to the file touched last.
 */
export const filesTouched = (list: readonly Turn[], top = TOP_FILES): FileRow[] => {
  const rows = new Map<string, FileRow>()
  for (const t of list) {
    const counts: Record<string, number> = { ...(t.fileEdits ?? {}) }
    for (const p of [...t.created, ...t.edited]) if (!(p in counts)) counts[p] = 1
    for (const [path, n] of Object.entries(counts)) {
      if (!Number.isFinite(n) || n <= 0) continue
      const row = rows.get(path) ?? { path, count: 0, isCreated: false, lastAt: 0 }
      row.count += n
      row.isCreated ||= t.created.includes(path)
      row.lastAt = Math.max(row.lastAt, t.at)
      rows.set(path, row)
    }
  }
  return [...rows.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt || a.path.localeCompare(b.path)).slice(0, top)
}

const STEP_ICON: Record<Step['kind'], IconName> = {
  test: 'test',
  build: 'build',
  check: 'check',
  commit: 'commit',
  push: 'push',
  install: 'terminal',
  git: 'git',
  command: 'terminal',
}

/** What a turn did as icon names, each once, in a fixed order: files, then the steps as they ran. */
export const stepIcons = (t: Pick<Turn, 'edited' | 'created' | 'reads' | 'searches' | 'steps'>): IconName[] => {
  const out: IconName[] = []
  const add = (n: IconName) => {
    if (!out.includes(n)) out.push(n)
  }
  if (t.created.length) add('write')
  if (t.edited.length) add('edit')
  if (t.reads) add('read')
  if (t.searches) add('web')
  for (const s of t.steps) add(STEP_ICON[s.kind] ?? 'terminal')
  return out
}

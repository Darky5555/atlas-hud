// The Atlas icon set. Features draw icons only through <Icon>, by name; how an
// icon is drawn (SVG on desktop, glyphs or pictures in the terminal, motion)
// is this file's business. Names are a fixed contract: add, never rename.
import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  RenderSurface,
  SessionStartInput,
  Timer,
  ToolCallInput,
  ToolCallResult,
  TurnCompleteInput,
  TurnStartInput,
} from 'claude-code'

import type { Art } from './icons/art'
import { ART as SET } from './icons/art'
import type { Els } from './kit'
import { C } from './theme'

export const ICONS = [
  'atlas', // the brand mark
  'overview',
  'work',
  'agents',
  'timeline',
  'limit',
  'context',
  'cost',
  'git',
  'branch',
  'commit',
  'push',
  'dirty',
  'clean',
  'check',
  'warning',
  'error',
  'task-pending',
  'task-active',
  'task-done',
  'decision',
  'keep',
  'drop',
  'agent',
  'agent-running',
  'agent-waiting',
  'agent-done',
  'agent-failed',
  'file',
  'edit',
  'write',
  'read',
  'test',
  'build',
  'web',
  'terminal',
  'clock',
  'spark',
] as const

export type IconName = (typeof ICONS)[number]

export type IconProps = {
  /** The surface's element table, from `$.ui.resolve(e)`. */
  el: Els
  /** `e.surface` of the render it is drawn in. */
  surface: RenderSurface
  name: IconName
  /** A token from `C`, or any colour; the icon's own colour when absent. */
  color?: string
  /** Svg surfaces: CSS pixels (default 16). Terminal: ignored, one cell. */
  size?: number
  /** Something is happening now (a running agent, a live check): animate where the surface can. */
  isLive?: boolean
  /** What the drawing says; the icon's own name for it when absent. */
  alt?: string
  /**
   * Terminal only: the frame of a live icon's glyph cycle, from `iconFrame($)`.
   * Absent, a live icon shows its still glyph (nothing redraws for it).
   */
  frame?: number
}

/** Every name's drawing: a name missing from the set fails the type-check. */
const ART: Record<IconName, Art> = SET

const DEFAULT_SIZE = 16

/** A name's drawing; a name this build does not know (stored by a newer one) draws as a spark. */
const artOf = (name: IconName): Art => ART[name] ?? ART.spark

/** The icon's colours: its own, or the caller's with the accent kept (a muted icon mutes its accent too). */
const colours = (name: IconName, color?: string) => {
  const art = artOf(name)
  const p = color ?? art.color
  return { p, a: color === C.text3 ? color : art.accent }
}

/**
 * The icon's SVG document: a 24x24 viewBox drawn at `size` CSS pixels.
 * Live, the animated body (SMIL only), or the still one under a soft pulse.
 */
export const iconSource = (name: IconName, opts: { color?: string; size?: number; isLive?: boolean } = {}) => {
  const art = artOf(name)
  const { p, a } = colours(name, opts.color)
  const size = opts.size ?? DEFAULT_SIZE
  let body = art.body(p, a)
  if (opts.isLive) {
    body = art.live
      ? art.live(p, a)
      : `<g>${body}<animate attributeName="opacity" values="1;.55;1" dur="1.6s" repeatCount="indefinite"/></g>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}">${body}</svg>`
}

/** The terminal's cell for an icon: its glyph, or a frame of its cycle while live. */
export const iconGlyph = (name: IconName, isLive?: boolean, frame?: number) => {
  const art = artOf(name)
  if (!isLive || frame === undefined || !art.frames?.length) return art.glyph
  const n = art.frames.length
  return art.frames[((Math.floor(frame) % n) + n) % n] ?? art.glyph
}

/** The text a reader that cannot see the drawing gets. */
export const iconAlt = (name: IconName) => artOf(name).alt

/**
 * One icon. Svg surfaces draw the hand-made SVG (a plain image when still, an
 * interactive frame running SMIL when live); the terminal draws a glyph in
 * the icon's colour. Never an emoji.
 */
export const Icon = ({ el, surface, name, color, size, isLive, alt, frame }: IconProps) => {
  const art = artOf(name)
  if (surface !== 'terminal' && el.Svg) {
    const px = size ?? DEFAULT_SIZE
    const source = iconSource(name, { color, size: px, isLive })
    const label = alt ?? art.alt
    return isLive ? (
      <el.Svg source={source} alt={label} width={px} height={px} isInteractive />
    ) : (
      <el.Svg source={source} alt={label} width={px} height={px} />
    )
  }
  return <el.Text color={color ?? art.color}>{iconGlyph(name, isLive, frame)}</el.Text>
}

// ---------- Terminal motion: one ticker, only while something is live ----------
//
// The terminal has no SMIL, so a live glyph moves only if a view passes it
// `frame={await iconFrame($)}`. The frame is a counter in `$.state`, stepped by
// one `$.clock.every` ticker that runs only while a turn (the main loop's or a
// subagent's) is running: it starts with the first turn and is cancelled when
// the last one completes, so nothing redraws while nothing is live.

const FRAME_MS = 500
/** Frames cycle under this; a multiple of every cycle's length (2, 3 and 4). */
const FRAME_CYCLE = 12
/**
 * Turns tracked at once, at most. A turn whose end was never heard leaves only
 * once this many newer turns have started (or at the next session start);
 * nothing ages out by time. The engine pairs every start with an end, so this
 * only bounds the set.
 */
const LIVE_MAX = 32

const frameAtom = atom({ plugin: 'atlas-hud', key: 'iconFrame' } as const, 0)

/** The turns running now, by turn id. Module state: a reload starts it over, and cancels the ticker with it. */
const live = new Set<string>()
let ticker: Timer | undefined

/**
 * The frame to pass `<Icon frame>` in the terminal; reading it redraws the reader as it steps.
 * Read it only in a view that is drawing a live icon: while any turn runs, the frame
 * steps every 500 ms whether or not a live icon is on screen, and each step redraws
 * every view that read it.
 */
export async function iconFrame($: EngineInterface): Promise<number> {
  return (await read($, frameAtom)) ?? 0
}

function stopTicker() {
  ticker?.cancel()
  ticker = undefined
}

async function iconsTick($: EngineInterface) {
  if (!live.size) return stopTicker()
  await update($, frameAtom, n => ((n ?? 0) + 1) % FRAME_CYCLE)
}

// ---------- The shared events, called from register.tsx (see hub.ts) ----------

export function iconsSessionStart(_$: EngineInterface, _e: SessionStartInput) {
  live.clear()
  stopTicker()
}

export function iconsTurnStart($: EngineInterface, e: TurnStartInput) {
  live.add(e.turnId)
  while (live.size > LIVE_MAX) {
    const oldest = live.values().next().value
    if (oldest === undefined) break
    live.delete(oldest)
  }
  // A failed step (a refused write) stops the ticker rather than retrying twice a second.
  if (!ticker) ticker = $.clock.every(FRAME_MS, () => void iconsTick($).catch(stopTicker))
}

export function iconsToolStart(_$: EngineInterface, _e: ToolCallInput) {}

export function iconsToolEnd(_$: EngineInterface, _e: ToolCallInput, _ran: ToolCallResult) {}

/** On the main loop, a string returned is shown beneath the answer. */
export function iconsTurnComplete(_$: EngineInterface, e: TurnCompleteInput): string | undefined | Promise<string | undefined> {
  live.delete(e.turnId)
  if (!live.size) stopTicker()
  return undefined
}

// The Atlas icon set. Features draw icons only through <Icon>, by name; how an
// icon is drawn (SVG on desktop, glyphs or pictures in the terminal, motion)
// is this file's business. Names are a fixed contract: add, never rename.
import type { RenderSurface } from 'claude-code'

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
  /** Desktop: CSS pixels (default 16). Terminal: ignored, one cell. */
  size?: number
  /** Something is happening now (a running agent, a live check): animate where the surface can. */
  isLive?: boolean
}

// Stand-ins until the icon set lands: one cell each, no emoji.
const GLYPH: Record<IconName, string> = {
  atlas: '◈',
  overview: '◉',
  work: '☰',
  agents: '⌬',
  timeline: '↯',
  limit: '◔',
  context: '▤',
  cost: '¤',
  git: '⎇',
  branch: '⎇',
  commit: '●',
  push: '↑',
  dirty: '±',
  clean: '✓',
  check: '✓',
  warning: '!',
  error: '✕',
  'task-pending': '○',
  'task-active': '▸',
  'task-done': '✓',
  decision: '◆',
  keep: '✓',
  drop: '✕',
  agent: '⌬',
  'agent-running': '◐',
  'agent-waiting': '◌',
  'agent-done': '●',
  'agent-failed': '✕',
  file: '▢',
  edit: '✎',
  write: '✚',
  read: '◫',
  test: '⚗',
  build: '⚒',
  web: '◍',
  terminal: '❯',
  clock: '◷',
  spark: '✦',
}

export const Icon = ({ el, name, color }: IconProps) => <el.Text color={color ?? C.teal}>{GLYPH[name]}</el.Text>

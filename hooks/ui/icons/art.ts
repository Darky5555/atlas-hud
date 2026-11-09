// The Atlas icon drawings: one hand-authored 24x24 SVG body per icon name,
// drawn in two colours (the icon's own, `p`, and its accent, `a`) so a caller
// can recolour an icon and the set still reads as one. Every body uses the
// same pen: a 1.5 stroke with round caps and joins, a faint inner fill of the
// main colour, and small accent details (star points, orbit dots).
//
// `live` is the body drawn while something is happening; it carries SMIL only
// (animate, animateTransform, animateMotion): no script, no event attributes.
import { C } from '../theme'

export type Art = {
  /** The icon's own colour, when the caller passes none. */
  color: string
  /** The detail colour: star points, satellites, the blip. */
  accent: string
  /** What the drawing says, for a reader that cannot see it. */
  alt: string
  /** The terminal's one cell: a Unicode glyph, never an emoji. */
  glyph: string
  /** Terminal frames, cycled by `frame` while live. */
  frames?: readonly string[]
  /** The SVG body, inside the 24x24 viewBox. */
  body: (p: string, a: string) => string
  /** The animated body; absent, the static body under a soft pulse. */
  live?: (p: string, a: string) => string
}

// ---------- The pen ----------

/** Stroke attributes every outline shares. */
const pen = (p: string, w = 1.5, fill = 'none') => `fill="${fill}" stroke="${p}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`

/** A faint inner fill of the main colour. */
const tint = (p: string, o = 0.16) => `fill="${p}" fill-opacity="${o}" stroke="none"`

/** A four-point star centred at (x, y), radius r, filled. */
const star = (x: number, y: number, r: number, a: string) => {
  const k = r * 0.28
  const n = (v: number) => Number(v.toFixed(2))
  return (
    `<path fill="${a}" d="M${n(x)} ${n(y - r)}L${n(x + k)} ${n(y - k)}L${n(x + r)} ${n(y)}L${n(x + k)} ${n(y + k)}` +
    `L${n(x)} ${n(y + r)}L${n(x - k)} ${n(y + k)}L${n(x - r)} ${n(y)}L${n(x - k)} ${n(y - k)}Z"/>`
  )
}

const spin = (dur: string, from = 0, to = 360) =>
  `<animateTransform attributeName="transform" type="rotate" from="${from} 12 12" to="${to} 12 12" dur="${dur}" repeatCount="indefinite"/>`

const blink = (attr: string, values: string, dur: string) =>
  `<animate attributeName="${attr}" values="${values}" dur="${dur}" repeatCount="indefinite"/>`

// ---------- Shared shapes ----------

const CHECK = 'M7.6 12.4l3 3 5.8-6.4'
const CROSS = 'M9 9l6 6M15 9l-6 6'
const PAGE = 'M6.5 3.5h7l4.5 4.5v12a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-16a.5.5 0 0 1 .5-.5z'
const FOLD = 'M13.5 3.5v4.5h4.5'
const SQUARE = 'M8 4h8a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4h-8a4 4 0 0 1-4-4v-8a4 4 0 0 1 4-4z'

/** An agent: a core, a ring around it (solid, dashed or open), then a mark. */
const agentBase = (p: string, ring: string, core = 4.2) =>
  `<circle cx="12" cy="12" r="${core}" ${tint(p, 0.22)}/>` + `<circle cx="12" cy="12" r="${core}" ${pen(p)}/>` + ring

// ---------- The set ----------

// Keyed by every name in ICONS (icons.tsx holds it to that).
export const ART = {
  atlas: {
    color: C.teal,
    accent: C.gold,
    alt: 'Atlas',
    glyph: '◈',
    frames: ['◈', '◇'],
    // A globe with a meridian and an equator, a tilted orbit, a star above.
    body: (p, a) =>
      `<circle cx="12" cy="12" r="6.8" ${tint(p, 0.18)}/>` +
      `<circle cx="12" cy="12" r="6.8" ${pen(p)}/>` +
      `<ellipse cx="12" cy="12" rx="2.9" ry="6.8" ${pen(p, 1.1)} stroke-opacity=".7"/>` +
      `<path d="M5.2 12h13.6" ${pen(p, 1.1)} stroke-opacity=".7"/>` +
      `<g transform="rotate(-24 12 12)"><ellipse cx="12" cy="12" rx="10.6" ry="3.4" ${pen(a, 1.2)}/>` +
      `<circle cx="22.6" cy="12" r="1.3" fill="${a}"/></g>` +
      star(19.4, 4.4, 2.4, a),
    live: (p, a) =>
      `<circle cx="12" cy="12" r="6.8" ${tint(p, 0.18)}/>` +
      `<circle cx="12" cy="12" r="6.8" ${pen(p)}/>` +
      `<ellipse cx="12" cy="12" rx="2.9" ry="6.8" ${pen(p, 1.1)} stroke-opacity=".7"/>` +
      `<path d="M5.2 12h13.6" ${pen(p, 1.1)} stroke-opacity=".7"/>` +
      `<g transform="rotate(-24 12 12)"><ellipse cx="12" cy="12" rx="10.6" ry="3.4" ${pen(a, 1.2)}/>` +
      `<circle r="1.3" fill="${a}"><animateMotion dur="3.2s" repeatCount="indefinite" path="M22.6 12a10.6 3.4 0 1 1-21.2 0a10.6 3.4 0 1 1 21.2 0"/></circle></g>` +
      `<g>${star(19.4, 4.4, 2.4, a)}${blink('opacity', '1;.35;1', '2.4s')}</g>`,
  },

  overview: {
    color: C.teal,
    accent: C.gold,
    alt: 'Overview',
    glyph: '◉',
    // A radar: two rings, a sweep and a blip.
    body: (p, a) =>
      `<circle cx="12" cy="12" r="8.5" ${tint(p, 0.12)}/>` +
      `<circle cx="12" cy="12" r="8.5" ${pen(p)}/>` +
      `<circle cx="12" cy="12" r="4.6" ${pen(p, 1.1)} stroke-opacity=".5"/>` +
      `<path d="M12 12l5.6-4.4" ${pen(p)}/>` +
      `<circle cx="12" cy="12" r="1.2" fill="${p}"/>` +
      `<circle cx="8.2" cy="15.4" r="1.3" fill="${a}"/>`,
    live: (p, a) =>
      `<circle cx="12" cy="12" r="8.5" ${tint(p, 0.12)}/>` +
      `<circle cx="12" cy="12" r="8.5" ${pen(p)}/>` +
      `<circle cx="12" cy="12" r="4.6" ${pen(p, 1.1)} stroke-opacity=".5"/>` +
      `<g><path d="M12 12l5.6-4.4" ${pen(p)}/>${spin('3s')}</g>` +
      `<circle cx="12" cy="12" r="1.2" fill="${p}"/>` +
      `<circle cx="8.2" cy="15.4" r="1.3" fill="${a}">${blink('opacity', '1;.2;1', '1.5s')}</circle>`,
  },

  work: {
    color: C.teal,
    accent: C.gold,
    alt: 'Work',
    glyph: '☰',
    // A clipboard: a ticked row and an open one.
    body: (p, a) =>
      `<rect x="5" y="4.5" width="14" height="16" rx="2.5" ${tint(p)}/>` +
      `<rect x="5" y="4.5" width="14" height="16" rx="2.5" ${pen(p)}/>` +
      `<rect x="9" y="2.8" width="6" height="3.2" rx="1.2" ${pen(p, 1.5, C.ink)}/>` +
      `<path d="M8.2 10.6l1.4 1.4 2.4-2.6" ${pen(a)}/>` +
      `<path d="M13.6 11h2.4" ${pen(p)}/>` +
      `<circle cx="9.4" cy="16" r="1" fill="${p}" fill-opacity=".6"/>` +
      `<path d="M12.2 16h3.8" ${pen(p)} stroke-opacity=".7"/>`,
  },

  agents: {
    color: C.violet,
    accent: C.teal,
    alt: 'Agents',
    glyph: '⌬',
    // A small constellation: a lead node and two it leads, a star above.
    body: (p, a) =>
      `<path d="M10.6 11.2l-3.4 4.4M13.4 11.2l3.4 4.4M8.6 17.6h6.8" ${pen(p, 1.2)} stroke-opacity=".6"/>` +
      `<circle cx="12" cy="8.8" r="2.7" ${tint(p, 0.3)}/><circle cx="12" cy="8.8" r="2.7" ${pen(p)}/>` +
      `<circle cx="6.2" cy="17.4" r="2.2" ${tint(p, 0.3)}/><circle cx="6.2" cy="17.4" r="2.2" ${pen(p)}/>` +
      `<circle cx="17.8" cy="17.4" r="2.2" ${tint(p, 0.3)}/><circle cx="17.8" cy="17.4" r="2.2" ${pen(p)}/>` +
      star(19, 4.6, 2, a),
  },

  timeline: {
    color: C.teal,
    accent: C.gold,
    alt: 'Timeline',
    glyph: '↯',
    // A track of three moments, the latest marked.
    body: (p, a) =>
      `<path d="M3 15h18" ${pen(p)} stroke-opacity=".7"/>` +
      `<circle cx="5.5" cy="15" r="1.8" ${pen(p, 1.5, C.ink)}/>` +
      `<circle cx="11" cy="15" r="1.8" ${pen(p, 1.5, C.ink)}/>` +
      `<path d="M17.5 15V6.5" ${pen(a, 1.2)}/>` +
      `<path d="M17.5 6.5h3.4l-1 1.6 1 1.6h-3.4" ${tint(a, 0.4)}/>` +
      `<path d="M17.5 6.5h3.4l-1 1.6 1 1.6h-3.4" ${pen(a, 1.2)}/>` +
      `<circle cx="17.5" cy="15" r="2.4" fill="${a}"/>`,
  },

  limit: {
    color: C.teal,
    accent: C.gold,
    alt: 'Limit',
    glyph: '◔',
    // A gauge: an arc with ticks, a needle near the top of the range.
    body: (p, a) =>
      `<path d="M4.6 17.5a8.5 8.5 0 1 1 14.8 0z" ${tint(p, 0.12)}/>` +
      `<path d="M4.6 17.5a8.5 8.5 0 1 1 14.8 0" ${pen(p)}/>` +
      `<path d="M6.3 11.1l1 .6M12 5.6v1.2M17.7 11.1l-1 .6" ${pen(p, 1.2)} stroke-opacity=".7"/>` +
      `<path d="M12 14.5l4.2-4.6" ${pen(a)}/>` +
      `<circle cx="12" cy="14.5" r="1.6" fill="${a}"/>`,
  },

  context: {
    color: C.teal,
    accent: C.gold,
    alt: 'Context window',
    glyph: '▤',
    // A window filling up: a title bar, rows, the last one the accent.
    body: (p, a) =>
      `<rect x="3.5" y="4.5" width="17" height="15" rx="2.5" ${tint(p, 0.12)}/>` +
      `<rect x="3.5" y="4.5" width="17" height="15" rx="2.5" ${pen(p)}/>` +
      `<path d="M3.5 8.5h17" ${pen(p, 1.1)} stroke-opacity=".6"/>` +
      `<circle cx="6" cy="6.5" r=".7" fill="${p}"/><circle cx="8.2" cy="6.5" r=".7" fill="${p}" fill-opacity=".6"/>` +
      `<path d="M6.5 12h11M6.5 15h7.5" ${pen(p)} stroke-opacity=".8"/>` +
      `<path d="M15.8 15h1.7" ${pen(a)}/>`,
  },

  cost: {
    color: C.gold,
    accent: C.glow,
    alt: 'Cost',
    glyph: '¤',
    // A coin with a milled inner ring and a star struck in it.
    body: (p, a) =>
      `<circle cx="12" cy="12" r="8.5" ${tint(p, 0.16)}/>` +
      `<circle cx="12" cy="12" r="8.5" ${pen(p)}/>` +
      `<circle cx="12" cy="12" r="5.6" ${pen(p, 1)} stroke-opacity=".5" stroke-dasharray="1 1.4"/>` +
      star(12, 12, 3.6, a),
  },

  git: {
    color: C.teal,
    accent: C.gold,
    alt: 'Git',
    glyph: '⎇',
    // Three commits: a line and a branch merging back in.
    body: (p, a) =>
      `<path d="M7 8.2v7.6" ${pen(p)}/>` +
      `<path d="M17 11.2c0 3.4-6 2.4-8.6 5.2" ${pen(p)}/>` +
      `<circle cx="7" cy="6" r="2.2" ${tint(p, 0.3)}/><circle cx="7" cy="6" r="2.2" ${pen(p)}/>` +
      `<circle cx="7" cy="18" r="2.2" ${tint(p, 0.3)}/><circle cx="7" cy="18" r="2.2" ${pen(p)}/>` +
      `<circle cx="17" cy="9" r="2.2" fill="${a}"/>`,
  },

  branch: {
    color: C.teal,
    accent: C.gold,
    alt: 'Branch',
    glyph: '⑂',
    // A trunk with a branch forking off to a starred tip.
    body: (p, a) =>
      `<path d="M7 3.5v17" ${pen(p)}/>` +
      `<path d="M7 15.5c0-4.6 10-3.4 10-8.4" ${pen(p)}/>` +
      `<circle cx="7" cy="20" r="1.4" fill="${p}"/>` +
      `<circle cx="17" cy="6" r="2.6" ${tint(a, 0.3)}/>` +
      `<circle cx="17" cy="6" r="2.6" ${pen(a)}/>` +
      `<circle cx="17" cy="6" r=".9" fill="${a}"/>`,
  },

  commit: {
    color: C.gold,
    accent: C.glow,
    alt: 'Commit',
    glyph: '●',
    // A commit on its line: a ringed node with a bright core.
    body: (p, a) =>
      `<path d="M2.5 12h5.5M16 12h5.5" ${pen(p)} stroke-opacity=".7"/>` +
      `<circle cx="12" cy="12" r="4" ${tint(p, 0.25)}/>` +
      `<circle cx="12" cy="12" r="4" ${pen(p)}/>` +
      `<circle cx="12" cy="12" r="1.5" fill="${a}"/>`,
  },

  push: {
    color: C.teal,
    accent: C.gold,
    alt: 'Push',
    glyph: '⇡',
    // An arrow lifting off a horizon, a star where it is headed.
    body: (p, a) =>
      `<path d="M5 19.5c4-2.4 10-2.4 14 0" ${pen(p, 1.2)} stroke-opacity=".55"/>` +
      `<path d="M12 16.5V7.5M8 11.2l4-4 4 4" ${pen(p)}/>` +
      star(12, 3.6, 2, a),
    live: (p, a) =>
      `<path d="M5 19.5c4-2.4 10-2.4 14 0" ${pen(p, 1.2)} stroke-opacity=".55"/>` +
      `<g><path d="M12 16.5V7.5M8 11.2l4-4 4 4" ${pen(p)}/>` +
      `<animateTransform attributeName="transform" type="translate" values="0 1.5;0 -1;0 1.5" dur="1.4s" repeatCount="indefinite"/></g>` +
      `<g>${star(12, 3.6, 2, a)}${blink('opacity', '1;.3;1', '1.4s')}</g>`,
  },

  dirty: {
    color: C.gold,
    accent: C.orange,
    alt: 'Uncommitted changes',
    glyph: '±',
    // A page with changes on it: a plus and a minus.
    body: (p, a) =>
      `<path d="${PAGE}" ${tint(p, 0.14)}/>` +
      `<path d="${PAGE}" ${pen(p)}/>` +
      `<path d="${FOLD}" ${pen(p, 1.2)} stroke-opacity=".7"/>` +
      `<path d="M12 10.2v4.2M9.9 12.3h4.2" ${pen(a)}/>` +
      `<path d="M9.9 17h4.2" ${pen(p)}/>`,
  },

  clean: {
    color: C.ok,
    accent: C.glow,
    alt: 'Clean',
    glyph: '✓',
    // A folder with a tick, a star glinting off it.
    body: (p, a) =>
      `<path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2h7.2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" ${tint(p, 0.16)}/>` +
      `<path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2h7.2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" ${pen(p)}/>` +
      `<path d="M9 13.4l2 2 4-4.2" ${pen(p)}/>` +
      star(19.5, 4.5, 2, a),
  },

  check: {
    color: C.ok,
    accent: C.glow,
    alt: 'Check',
    glyph: '✓',
    frames: ['✓', '∙'],
    // A tick in a soft ring.
    body: (p, a) =>
      `<circle cx="12" cy="12" r="8.5" ${tint(p, 0.14)}/>` +
      `<circle cx="12" cy="12" r="8.5" ${pen(p)} stroke-opacity=".4"/>` +
      `<path d="${CHECK}" ${pen(p, 1.8)}/>` +
      `<circle cx="18" cy="6" r=".9" fill="${a}"/>`,
    // The tick draws its stroke, holds, and draws again.
    live: (p, a) =>
      `<circle cx="12" cy="12" r="8.5" ${tint(p, 0.14)}/>` +
      `<circle cx="12" cy="12" r="8.5" ${pen(p)} stroke-opacity=".4"/>` +
      `<path d="${CHECK}" ${pen(p, 1.8)} pathLength="1" stroke-dasharray="1" stroke-dashoffset="1">` +
      `<animate attributeName="stroke-dashoffset" values="1;0;0" keyTimes="0;.45;1" dur="1.8s" repeatCount="indefinite"/></path>` +
      `<circle cx="18" cy="6" r=".9" fill="${a}">${blink('opacity', '0;1;0', '1.8s')}</circle>`,
  },

  warning: {
    color: C.warn,
    accent: C.orange,
    alt: 'Warning',
    glyph: '▲',
    frames: ['▲', '△'],
    // A rounded triangle with an exclamation mark.
    body: (p, a) =>
      `<path d="M10.3 4.5a2 2 0 0 1 3.4 0l7 12.2a2 2 0 0 1-1.7 3h-14a2 2 0 0 1-1.7-3z" ${tint(p, 0.18)}/>` +
      `<path d="M10.3 4.5a2 2 0 0 1 3.4 0l7 12.2a2 2 0 0 1-1.7 3h-14a2 2 0 0 1-1.7-3z" ${pen(p)}/>` +
      `<path d="M12 9.2v4.2" ${pen(a, 1.8)}/>` +
      `<circle cx="12" cy="16.4" r="1" fill="${a}"/>`,
    // The fill pulses and the mark blinks with it.
    live: (p, a) =>
      `<path d="M10.3 4.5a2 2 0 0 1 3.4 0l7 12.2a2 2 0 0 1-1.7 3h-14a2 2 0 0 1-1.7-3z" fill="${p}" fill-opacity=".18" stroke="none">` +
      `${blink('fill-opacity', '.1;.45;.1', '1.2s')}</path>` +
      `<path d="M10.3 4.5a2 2 0 0 1 3.4 0l7 12.2a2 2 0 0 1-1.7 3h-14a2 2 0 0 1-1.7-3z" ${pen(p)}/>` +
      `<g><path d="M12 9.2v4.2" ${pen(a, 1.8)}/><circle cx="12" cy="16.4" r="1" fill="${a}"/>` +
      `${blink('opacity', '1;.45;1', '1.2s')}</g>`,
  },

  error: {
    color: C.bad,
    accent: C.gold2,
    alt: 'Error',
    glyph: '✕',
    // An octagon with a cross.
    body: (p, a) =>
      `<path d="M8.4 3.5h7.2l4.9 4.9v7.2l-4.9 4.9h-7.2l-4.9-4.9v-7.2z" ${tint(p, 0.18)}/>` +
      `<path d="M8.4 3.5h7.2l4.9 4.9v7.2l-4.9 4.9h-7.2l-4.9-4.9v-7.2z" ${pen(p)}/>` +
      `<path d="${CROSS}" ${pen(p, 1.8)}/>` +
      `<circle cx="12" cy="12" r=".8" fill="${a}"/>`,
  },

  'task-pending': {
    color: C.text3,
    accent: C.text2,
    alt: 'Task pending',
    glyph: '○',
    // A dashed ring waiting to be walked.
    body: (p, a) =>
      `<circle cx="12" cy="12" r="7.5" ${pen(p)} stroke-dasharray="2.4 2.6"/>` + `<circle cx="12" cy="12" r="1.4" fill="${a}" fill-opacity=".7"/>`,
  },

  'task-active': {
    color: C.teal,
    accent: C.gold,
    alt: 'Task in progress',
    glyph: '▸',
    frames: ['▸', '▹'],
    // A ring partly walked, a bright core.
    body: (p, a) =>
      `<circle cx="12" cy="12" r="7.5" ${tint(p, 0.12)}/>` +
      `<circle cx="12" cy="12" r="7.5" ${pen(p, 1.2)} stroke-opacity=".35"/>` +
      `<path d="M12 4.5a7.5 7.5 0 0 1 7.1 9.9" ${pen(p)}/>` +
      `<circle cx="12" cy="12" r="2.4" fill="${a}"/>`,
    live: (p, a) =>
      `<circle cx="12" cy="12" r="7.5" ${tint(p, 0.12)}/>` +
      `<circle cx="12" cy="12" r="7.5" ${pen(p, 1.2)} stroke-opacity=".35"/>` +
      `<g><path d="M12 4.5a7.5 7.5 0 0 1 7.1 9.9" ${pen(p)}/>${spin('1.6s')}</g>` +
      `<circle cx="12" cy="12" r="2.4" fill="${a}">${blink('opacity', '1;.5;1', '1.6s')}</circle>`,
  },

  'task-done': {
    color: C.ok,
    accent: C.glow,
    alt: 'Task done',
    glyph: '✓',
    // A filled ring with a tick.
    body: (p, a) =>
      `<circle cx="12" cy="12" r="7.5" ${tint(p, 0.28)}/>` +
      `<circle cx="12" cy="12" r="7.5" ${pen(p)}/>` +
      `<path d="M8.6 12.2l2.3 2.3 4.5-4.9" ${pen(a, 1.7)}/>`,
  },

  decision: {
    color: C.gold,
    accent: C.glow,
    alt: 'Decision',
    glyph: '◆',
    // A cut gem: a diamond with a star at its heart.
    body: (p, a) =>
      `<path d="M12 3l8.5 9-8.5 9-8.5-9z" ${tint(p, 0.18)}/>` +
      `<path d="M12 3l8.5 9-8.5 9-8.5-9z" ${pen(p)}/>` +
      `<path d="M7.6 7.6h8.8" ${pen(p, 1)} stroke-opacity=".5"/>` +
      star(12, 12.6, 3.2, a),
  },

  keep: {
    color: C.ok,
    accent: C.glow,
    alt: 'Keep',
    glyph: '✓',
    // A rounded square with a tick.
    body: (p, a) =>
      `<path d="${SQUARE}" ${tint(p, 0.18)}/>` +
      `<path d="${SQUARE}" ${pen(p)}/>` +
      `<path d="${CHECK}" ${pen(p, 1.8)}/>` +
      `<circle cx="17" cy="7" r=".9" fill="${a}"/>`,
  },

  drop: {
    color: C.bad,
    accent: C.gold2,
    alt: 'Drop',
    glyph: '✕',
    // A rounded square with a cross.
    body: (p, a) =>
      `<path d="${SQUARE}" ${tint(p, 0.14)}/>` +
      `<path d="${SQUARE}" ${pen(p)} stroke-opacity=".85"/>` +
      `<path d="${CROSS}" ${pen(p, 1.8)}/>` +
      `<circle cx="17" cy="7" r=".9" fill="${a}" fill-opacity=".7"/>`,
  },

  agent: {
    color: C.violet,
    accent: C.teal,
    alt: 'Agent',
    glyph: '⌬',
    // A probe: a core with an antenna and a tilted orbit.
    body: (p, a) =>
      `<ellipse cx="12" cy="13" rx="9.5" ry="3.2" ${pen(p, 1.1)} stroke-opacity=".55"/>` +
      `<circle cx="12" cy="13" r="4.4" ${tint(p, 0.3)}/>` +
      `<circle cx="12" cy="13" r="4.4" ${pen(p)}/>` +
      `<path d="M12 8.6V5" ${pen(p)}/>` +
      `<circle cx="12" cy="3.6" r="1.5" fill="${a}"/>`,
  },

  'agent-running': {
    color: C.violet,
    accent: C.teal,
    alt: 'Agent running',
    // One width class (Neutral) through the cycle, so a CJK terminal that draws ambiguous glyphs wide never shifts the row.
    glyph: '◜',
    frames: ['◜', '◝', '◞', '◟'],
    // A core with a satellite on its orbit; live, the satellite circles.
    body: (p, a) =>
      agentBase(p, `<circle cx="12" cy="12" r="8.5" ${pen(p, 1.2)} stroke-opacity=".4"/>`) +
      `<path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5" ${pen(a)}/>` +
      `<circle cx="20.5" cy="12" r="1.6" fill="${a}"/>`,
    live: (p, a) =>
      agentBase(p, `<circle cx="12" cy="12" r="8.5" ${pen(p, 1.2)} stroke-opacity=".4"/>`) +
      `<g><path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5" ${pen(a)}/>` +
      `<circle cx="20.5" cy="12" r="1.6" fill="${a}"/>${spin('1.8s')}</g>`,
  },

  'agent-waiting': {
    color: C.text2,
    accent: C.violet,
    alt: 'Agent waiting',
    glyph: '◌',
    // A core on a dashed orbit: not started yet.
    body: (p, a) =>
      agentBase(p, `<circle cx="12" cy="12" r="8.5" ${pen(p, 1.2)} stroke-dasharray="1.6 2.6"/>`, 3.6) +
      `<circle cx="12" cy="12" r="1.2" fill="${a}"/>`,
  },

  'agent-done': {
    color: C.ok,
    accent: C.violet,
    alt: 'Agent done',
    glyph: '●',
    // A core on a closed orbit, ticked.
    body: (p, a) =>
      agentBase(p, `<circle cx="12" cy="12" r="8.5" ${pen(a, 1.2)} stroke-opacity=".7"/>`, 5) + `<path d="M9.6 12.1l1.7 1.7 3.2-3.5" ${pen(p, 1.6)}/>`,
  },

  'agent-failed': {
    color: C.bad,
    accent: C.violet,
    alt: 'Agent failed',
    glyph: '⊗',
    // A core on a broken orbit, crossed.
    body: (p, a) =>
      agentBase(p, `<path d="M18.4 6.4a8.5 8.5 0 1 1-4.2-2.6" ${pen(a, 1.2)} stroke-opacity=".7"/>`, 5) +
      `<path d="M10.2 10.2l3.6 3.6M13.8 10.2l-3.6 3.6" ${pen(p, 1.6)}/>`,
  },

  file: {
    color: C.text2,
    accent: C.teal,
    alt: 'File',
    glyph: '▢',
    // A page with a folded corner and two lines.
    body: (p, a) =>
      `<path d="${PAGE}" ${tint(p, 0.12)}/>` +
      `<path d="${PAGE}" ${pen(p)}/>` +
      `<path d="${FOLD}" ${pen(p, 1.2)} stroke-opacity=".7"/>` +
      `<path d="M9 12.5h6M9 16h4" ${pen(p, 1.2)} stroke-opacity=".7"/>` +
      `<circle cx="15.6" cy="16" r=".8" fill="${a}"/>`,
  },

  edit: {
    color: C.teal,
    accent: C.gold,
    alt: 'Edit',
    glyph: '✎',
    // A pen nib writing a line.
    body: (p, a) =>
      `<path d="M5 19l.7-3.6 9.8-9.8a1.9 1.9 0 0 1 2.7 0l.2.2a1.9 1.9 0 0 1 0 2.7l-9.8 9.8z" ${tint(p, 0.2)}/>` +
      `<path d="M5 19l.7-3.6 9.8-9.8a1.9 1.9 0 0 1 2.7 0l.2.2a1.9 1.9 0 0 1 0 2.7l-9.8 9.8z" ${pen(p)}/>` +
      `<path d="M14 7.1l2.9 2.9" ${pen(p, 1.2)} stroke-opacity=".7"/>` +
      `<path d="M12.5 20.5h7" ${pen(a)}/>`,
  },

  write: {
    color: C.teal,
    accent: C.gold,
    alt: 'New file',
    glyph: '✚',
    // A new page with a plus.
    body: (p, a) =>
      `<path d="${PAGE}" ${tint(p, 0.14)}/>` +
      `<path d="${PAGE}" ${pen(p)}/>` +
      `<path d="${FOLD}" ${pen(p, 1.2)} stroke-opacity=".7"/>` +
      `<path d="M12 11.2v5.6M9.2 14h5.6" ${pen(a, 1.7)}/>`,
  },

  read: {
    color: C.info,
    accent: C.gold,
    alt: 'Read',
    glyph: '◫',
    // An eye: lids, an iris, a bright pupil.
    body: (p, a) =>
      `<path d="M2.5 12c2.4-4.4 5.8-6.5 9.5-6.5s7.1 2.1 9.5 6.5c-2.4 4.4-5.8 6.5-9.5 6.5s-7.1-2.1-9.5-6.5z" ${tint(p, 0.12)}/>` +
      `<path d="M2.5 12c2.4-4.4 5.8-6.5 9.5-6.5s7.1 2.1 9.5 6.5c-2.4 4.4-5.8 6.5-9.5 6.5s-7.1-2.1-9.5-6.5z" ${pen(p)}/>` +
      `<circle cx="12" cy="12" r="3.2" ${tint(p, 0.3)}/>` +
      `<circle cx="12" cy="12" r="3.2" ${pen(p)}/>` +
      `<circle cx="12" cy="12" r="1.3" fill="${a}"/>`,
  },

  test: {
    color: C.teal,
    accent: C.gold,
    alt: 'Test',
    glyph: '⌖',
    // A flask, half full, bubbles rising.
    body: (p, a) =>
      `<path d="M7.6 15h8.8l2.5 4.2a1.4 1.4 0 0 1-1.2 2.1H6.3a1.4 1.4 0 0 1-1.2-2.1z" ${tint(p, 0.35)}/>` +
      `<path d="M10.3 3.5v5.8L5.1 19.2a1.4 1.4 0 0 0 1.2 2.1h11.4a1.4 1.4 0 0 0 1.2-2.1L13.7 9.3V3.5" ${pen(p)}/>` +
      `<path d="M9 3.5h6" ${pen(p)}/>` +
      `<circle cx="11" cy="17.6" r="1" fill="${a}"/><circle cx="13.6" cy="13" r=".8" fill="${a}" fill-opacity=".8"/>`,
    live: (p, a) =>
      `<path d="M7.6 15h8.8l2.5 4.2a1.4 1.4 0 0 1-1.2 2.1H6.3a1.4 1.4 0 0 1-1.2-2.1z" ${tint(p, 0.35)}/>` +
      `<path d="M10.3 3.5v5.8L5.1 19.2a1.4 1.4 0 0 0 1.2 2.1h11.4a1.4 1.4 0 0 0 1.2-2.1L13.7 9.3V3.5" ${pen(p)}/>` +
      `<path d="M9 3.5h6" ${pen(p)}/>` +
      `<circle cx="11" cy="18" r="1" fill="${a}"><animate attributeName="cy" values="19;11;19" dur="1.6s" repeatCount="indefinite"/>` +
      `${blink('opacity', '1;0;1', '1.6s')}</circle>` +
      `<circle cx="13.6" cy="13" r=".8" fill="${a}"><animate attributeName="cy" values="18;10;18" dur="2.1s" repeatCount="indefinite"/></circle>`,
  },

  build: {
    color: C.gold,
    accent: C.teal,
    alt: 'Build',
    glyph: '⬢',
    // A cube, its top face lit, a star where it is being made.
    body: (p, a) =>
      `<path d="M12 3.5l7.5 4.2L12 12 4.5 7.7z" ${tint(p, 0.3)}/>` +
      `<path d="M12 3.5l7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7z" ${pen(p)}/>` +
      `<path d="M4.5 7.7L12 12l7.5-4.3M12 12v8.5" ${pen(p, 1.2)} stroke-opacity=".7"/>` +
      star(19.6, 19.4, 2.2, a),
  },

  web: {
    color: C.info,
    accent: C.teal,
    alt: 'Web',
    glyph: '◍',
    // A wire globe: a meridian, two parallels, a node on the rim.
    body: (p, a) =>
      `<circle cx="12" cy="12" r="8.5" ${tint(p, 0.12)}/>` +
      `<circle cx="12" cy="12" r="8.5" ${pen(p)}/>` +
      `<ellipse cx="12" cy="12" rx="3.8" ry="8.5" ${pen(p, 1.2)} stroke-opacity=".7"/>` +
      `<path d="M4 9h16M4 15h16" ${pen(p, 1.2)} stroke-opacity=".7"/>` +
      `<circle cx="18" cy="6" r="1.5" fill="${a}"/>`,
  },

  terminal: {
    color: C.text2,
    accent: C.teal,
    alt: 'Terminal',
    glyph: '❯',
    // A console: a prompt and a cursor.
    body: (p, a) =>
      `<rect x="3" y="4.5" width="18" height="15" rx="2.5" ${tint(p, 0.12)}/>` +
      `<rect x="3" y="4.5" width="18" height="15" rx="2.5" ${pen(p)}/>` +
      `<path d="M7 9.5l3 2.5-3 2.5" ${pen(a)}/>` +
      `<path d="M12.5 15h4.5" ${pen(a)}/>`,
    live: (p, a) =>
      `<rect x="3" y="4.5" width="18" height="15" rx="2.5" ${tint(p, 0.12)}/>` +
      `<rect x="3" y="4.5" width="18" height="15" rx="2.5" ${pen(p)}/>` +
      `<path d="M7 9.5l3 2.5-3 2.5" ${pen(a)}/>` +
      `<path d="M12.5 15h4.5" ${pen(a)}>${blink('stroke-opacity', '1;0;1', '1s')}</path>`,
  },

  clock: {
    color: C.text2,
    accent: C.gold,
    alt: 'Clock',
    glyph: '◷',
    frames: ['◷', '◶', '◵', '◴'],
    // A dial with two hands and a mark at noon.
    body: (p, a) =>
      `<circle cx="12" cy="12" r="8.5" ${tint(p, 0.12)}/>` +
      `<circle cx="12" cy="12" r="8.5" ${pen(p)}/>` +
      `<path d="M12 7.5V12l3.2 2" ${pen(p)}/>` +
      `<circle cx="12" cy="12" r="1" fill="${p}"/>` +
      `<circle cx="12" cy="5.2" r=".9" fill="${a}"/>`,
    live: (p, a) =>
      `<circle cx="12" cy="12" r="8.5" ${tint(p, 0.12)}/>` +
      `<circle cx="12" cy="12" r="8.5" ${pen(p)}/>` +
      `<path d="M12 12l3.2 2" ${pen(p)}/>` +
      `<g><path d="M12 7.5V12" ${pen(p)}/>${spin('4s')}</g>` +
      `<circle cx="12" cy="12" r="1" fill="${p}"/>` +
      `<circle cx="12" cy="5.2" r=".9" fill="${a}"/>`,
  },

  spark: {
    color: C.gold,
    accent: C.glow,
    alt: 'Spark',
    glyph: '✦',
    frames: ['✦', '✧'],
    // A four-point star with two smaller ones beside it.
    body: (p, a) =>
      `<path d="M12 3.5l2 6.5 6.5 2-6.5 2-2 6.5-2-6.5-6.5-2 6.5-2z" ${tint(p, 0.3)}/>` +
      `<path d="M12 3.5l2 6.5 6.5 2-6.5 2-2 6.5-2-6.5-6.5-2 6.5-2z" ${pen(p)}/>` +
      star(19, 4.6, 1.9, a) +
      star(5, 19.2, 1.5, a),
    // The star breathes; the small ones twinkle in answer.
    live: (p, a) =>
      `<path d="M12 3.5l2 6.5 6.5 2-6.5 2-2 6.5-2-6.5-6.5-2 6.5-2z" fill="${p}" fill-opacity=".3" stroke="none">` +
      `${blink('fill-opacity', '.3;.8;.3', '1.6s')}</path>` +
      `<path d="M12 3.5l2 6.5 6.5 2-6.5 2-2 6.5-2-6.5-6.5-2 6.5-2z" ${pen(p)}/>` +
      `<g>${star(19, 4.6, 1.9, a)}${blink('opacity', '.2;1;.2', '1.6s')}</g>` +
      `<g>${star(5, 19.2, 1.5, a)}${blink('opacity', '1;.2;1', '1.6s')}</g>`,
  },
} satisfies Record<string, Art>

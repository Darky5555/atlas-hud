// Atlas palette: deep-space ink panels, teal and gold accents. Token names are
// shared by every feature; values may change, names stay (add, never rename).
//
// Layers, darkest first: deep (behind everything) < ink (the pane) < panel
// (a card) < panel2 (a raised row, the active tab) < panel3 (a pressed or
// selected row). Rules and borders use line; a brighter rule is line2.
//
// Text: text for what you read, text2 for notes and labels, text3 for what can
// be ignored (done tasks, empty cells). Accents: teal is Atlas (headings,
// progress, the live thing), gold is "needs you" (decisions, the wordmark's
// second half, warnings under 90%), violet is agents. Status tokens (ok, warn,
// bad, info) say what a colour means; prefer them over the raw hue.
//
// Typography conventions (every surface maps sizes its own way; the terminal
// has one size and draws semibold and bold as bold):
//   - Section headings: CAPS, mono, size "caption", weight "bold", teal.
//   - Values that change (percentages, counts, money): mono + tabular.
//   - Big numbers (Stat): size "heading", weight "bold".
//   - Notes under a value: size "footnote", text2.
//   - Never an emoji; draw icons through <Icon> (hooks/ui/icons.tsx).
//
// Spacing conventions (cells on the terminal, steps elsewhere):
//   - gap 1 between sections and between cards; gap 0 inside a section's rows.
//   - Cards: borderStyle "round", paddingX 1; a card's border says its kind
//     (gold: a decision waiting on you, line: plain information).
//   - An icon sits beside its text in a row Box with gap 1, never inside a
//     Text or a Button (an Svg icon is refused there).
export const C = {
  // ---- surfaces ----
  deep: '#05080f',
  ink: '#0a0e16',
  panel: '#131b2a',
  panel2: '#1a2334',
  panel3: '#222d42',
  line: '#2b3a56',
  line2: '#3d5378',

  // ---- text ----
  text: '#eef2f9',
  text2: '#aab6cc',
  text3: '#6c7a93',

  // ---- accents ----
  teal: '#5fd3c0',
  teal2: '#2fa596',
  tealDim: '#173d3c',
  glow: '#9ff7e8',
  gold: '#e8c15c',
  gold2: '#f6dc94',
  goldDim: '#4a3c1a',
  violet: '#a18cff',
  violet2: '#6b5bd6',

  // ---- raw status hues (kept for the features that already use them) ----
  green: '#48b196',
  orange: '#e8763c',
  danger: '#e06070',

  // ---- status, by meaning ----
  ok: '#48b196',
  warn: '#e8c15c',
  bad: '#e06070',
  info: '#6cb6ff',
} as const

/**
 * The gauge ramp, by position along the bar (0 to 1): teal where there is
 * room, gold as it fills, orange at the end. A cell is coloured by where it
 * sits, so a full bar reads teal to gold to orange and a low one stays teal.
 */
export const RISK_RAMP = [
  { at: 0, color: C.teal2 },
  { at: 0.35, color: C.teal },
  { at: 0.6, color: '#b9cf80' },
  { at: 0.75, color: C.gold },
  { at: 0.9, color: C.orange },
] as const

/** A progress ramp (tasks done): deep teal to glow, never a warning hue. */
export const PROGRESS_RAMP = [
  { at: 0, color: C.teal2 },
  { at: 0.5, color: C.teal },
  { at: 0.85, color: C.glow },
] as const

export type Ramp = readonly { at: number; color: string }[]

/** The ramp's colour at position `t` (0 to 1): the last stop at or before it. */
export const rampAt = (ramp: Ramp, t: number) => {
  let color: string = ramp[0]?.color ?? C.teal
  for (const s of ramp) if (t >= s.at) color = s.color
  return color
}

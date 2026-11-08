// Small pieces every view shares.
import type { On as EngineOn } from 'claude-code'

import { bar, levelColor } from '../lib'
import { C } from './theme'

export type On = EngineOn

// An element constructor from `$.ui.resolve(e)`.
export type El = (props: any) => any

/** The surface's element table, as `$.ui.resolve(e)` returns it. */
export type Els = { Box: El; Text: El; Button: El; Svg?: El; Image?: El; Raster?: El; Markdown?: El; Code?: El; Link?: El }

export const str = (v: unknown) => (typeof v === 'string' ? v : '')

export const Heading = ({ el, children }: { el: Els; children?: any }) => (
  <el.Text mono size="caption" color={C.teal}>
    {children}
  </el.Text>
)

export const Gauge = ({ el, label, pct, note }: { el: Els; label: string; pct: number; note?: string }) => (
  <el.Box flexDirection="column">
    <el.Box flexDirection="row" justifyContent="space-between">
      <el.Text weight="semibold" color={C.text}>
        {label}
      </el.Text>
      <el.Text mono tabular color={levelColor(pct)}>
        {Math.round(pct)}%
      </el.Text>
    </el.Box>
    <el.Text mono color={levelColor(pct)}>
      {bar(pct, 24)}
    </el.Text>
    {note && (
      <el.Text size="footnote" color={C.text2}>
        {note}
      </el.Text>
    )}
  </el.Box>
)

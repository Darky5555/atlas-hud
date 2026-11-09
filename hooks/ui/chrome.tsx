// The pane's frame: the Atlas header (mark, wordmark, rule), the tab bar, and
// the body under it, all on the ink background.
import type { RenderSurface } from 'claude-code'

import type { Els } from './kit'
import { canSvg } from './kit'
import type { IconName } from './icons'
import { Icon } from './icons'
import { C } from './theme'

export type TabSpec = { key: string; label: string; icon: IconName; badge?: number }

export const WORDMARK = 'ATLAS HUD'

const RULE_W = 320

/** The header rule as SVG: teal into gold, fading out, with a slow glint passing along it. */
export const ruleSvg = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${RULE_W}" height="3" viewBox="0 0 ${RULE_W} 3" preserveAspectRatio="none">` +
  '<defs>' +
  `<linearGradient id="r" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.teal}"/><stop offset="0.45" stop-color="${C.teal2}"/><stop offset="0.6" stop-color="${C.gold}"/><stop offset="1" stop-color="${C.gold}" stop-opacity="0"/></linearGradient>` +
  `<linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.glow}" stop-opacity="0"/><stop offset="0.5" stop-color="${C.glow}" stop-opacity="0.9"/><stop offset="1" stop-color="${C.glow}" stop-opacity="0"/></linearGradient>` +
  '</defs>' +
  `<rect x="0" y="1" width="${RULE_W}" height="1.5" fill="url(#r)"/>` +
  `<rect x="-60" y="0" width="60" height="3" fill="url(#g)"><animate attributeName="x" values="-60;${RULE_W};${RULE_W}" keyTimes="0;0.5;1" dur="8s" repeatCount="indefinite"/></rect>` +
  '</svg>'

/** The header rule: SVG where the surface draws it, teal and gold cells in the terminal. */
const HeaderRule = ({ el, surface, columns }: { el: Els; surface: RenderSurface; columns: number }) => {
  if (canSvg(el, surface) && el.Svg) return <el.Svg source={ruleSvg()} alt="Atlas header rule" height={3} isInteractive />
  const w = Math.max(12, columns)
  const teal = Math.round(w * 0.45)
  const gold = Math.round(w * 0.2)
  return (
    <el.Box flexDirection="row" gap={0}>
      <el.Text color={C.teal}>{'━'.repeat(teal)}</el.Text>
      <el.Text color={C.gold}>{'━'.repeat(gold)}</el.Text>
      <el.Text color={C.line} wrap="truncate-end">
        {'─'.repeat(Math.max(1, w - teal - gold))}
      </el.Text>
    </el.Box>
  )
}

const TabButton = ({ el, surface, t, isActive, onTab }: { el: Els; surface: RenderSurface; t: TabSpec; isActive: boolean; onTab: (key: string) => unknown }) => (
  <el.Box flexDirection="row" gap={1} alignItems="center" {...(isActive ? { backgroundColor: C.panel3 } : {})}>
    <Icon el={el} surface={surface} name={t.icon} color={isActive ? C.gold : C.text3} />
    <el.Button key={`tab-${t.key}`} label={t.badge ? `${t.label} (${t.badge})` : t.label} plain onPress={() => onTab(t.key)}>
      <el.Text color={isActive ? C.text : C.text2} weight={isActive ? 'bold' : 'regular'} underline={isActive}>
        {t.label}
      </el.Text>
      {t.badge ? (
        <el.Text mono weight="bold" color={C.ink} backgroundColor={C.gold}>
          {` ${t.badge} `}
        </el.Text>
      ) : null}
    </el.Button>
  </el.Box>
)

export const PaneFrame = ({
  el,
  surface,
  tabs,
  current,
  onTab,
  columns = 40,
  children,
}: {
  el: Els
  surface: RenderSurface
  tabs: TabSpec[]
  current: string
  onTab: (key: string) => unknown
  /** The body's width in cells (`e.props.bodyColumns`); sizes the terminal rule. */
  columns?: number
  children?: any
}) => (
  <el.Box flexDirection="column" gap={1} backgroundColor={C.ink} paddingX={1}>
    <el.Box flexDirection="column" gap={0}>
      <el.Box flexDirection="row" gap={1} alignItems="center">
        <Icon el={el} surface={surface} name="atlas" color={C.teal} size={18} />
        <el.Text size="heading" weight="bold" color={C.teal}>
          {WORDMARK}
        </el.Text>
      </el.Box>
      <HeaderRule el={el} surface={surface} columns={columns - 2} />
    </el.Box>
    <el.Box flexDirection="row" flexWrap="wrap" gap={1}>
      {tabs.map(t => (
        <TabButton el={el} surface={surface} t={t} isActive={t.key === current} onTab={onTab} />
      ))}
    </el.Box>
    {children}
  </el.Box>
)

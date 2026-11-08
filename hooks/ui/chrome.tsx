// The pane's frame: the tab bar and the body under it.
import type { RenderSurface } from 'claude-code'

import type { Els } from './kit'
import type { IconName } from './icons'
import { Icon } from './icons'

export type TabSpec = { key: string; label: string; icon: IconName; badge?: number }

export const PaneFrame = ({
  el,
  surface,
  tabs,
  current,
  onTab,
  children,
}: {
  el: Els
  surface: RenderSurface
  tabs: TabSpec[]
  current: string
  onTab: (key: string) => unknown
  children?: any
}) => (
  <el.Box flexDirection="column" gap={1}>
    <el.Box flexDirection="row" flexWrap="wrap" gap={1}>
      <Icon el={el} surface={surface} name="atlas" />
      {tabs.map(t => (
        <el.Button
          key={`tab-${t.key}`}
          label={t.badge ? `${t.label} (${t.badge})` : t.label}
          variant={t.key === current ? 'primary' : 'secondary'}
          onPress={() => onTab(t.key)}
        />
      ))}
    </el.Box>
    {children}
  </el.Box>
)

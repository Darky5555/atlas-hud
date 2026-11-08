// Wiring only: each feature registers its own hooks and exports its views.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Tab } from '../types'
import {
  agentsSessionStart,
  agentsToolEnd,
  agentsToolStart,
  agentsTurnComplete,
  agentsTurnStart,
  agentsView,
  registerAgents,
} from './features/agents'
import { doneBand, gitPanel, gitSessionStart, gitToolEnd, gitToolStart, gitTurnComplete, gitTurnStart, registerGit } from './features/git'
import {
  timelineSessionStart,
  timelineToolEnd,
  timelineToolStart,
  timelineTurnComplete,
  timelineTurnStart,
  timelineView,
} from './features/timeline'
import {
  registerTranscript,
  transcriptSessionStart,
  transcriptToolEnd,
  transcriptToolStart,
  transcriptTurnComplete,
  transcriptTurnStart,
} from './features/transcript'
import { registerUsage, usageSessionStart, usageToolEnd, usageToolStart, usageTurnComplete, usageTurnStart, usageView } from './features/usage'
import {
  decisionBand,
  proposedCount,
  registerWork,
  workSessionStart,
  workToolEnd,
  workToolStart,
  workTurnComplete,
  workTurnStart,
  workView,
} from './features/work'
import { guard } from './hub'
import { iconsSessionStart, iconsToolEnd, iconsToolStart, iconsTurnComplete, iconsTurnStart } from './ui/icons'
import type { TabSpec } from './ui/chrome'
import { PaneFrame } from './ui/chrome'
import type { Els } from './ui/kit'

const PANE = 'atlas-hud'
const TITLE = 'Atlas HUD'

const TABS: Tab[] = ['overview', 'work', 'agents', 'timeline']

const tab = atom({ plugin: 'atlas-hud', key: 'tab' } as const, 'overview' as Tab)

export const register: Register = on => {
  // Each feature hooks the events it alone needs; the shared ones are hooked
  // once below and handed to each feature in turn (hub.ts).
  registerUsage(on)
  registerWork(on)
  registerAgents(on)
  registerGit(on)
  registerTranscript(on)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'hud', description: 'Open the Atlas HUD pane' })
    void openPane($)
    await guard($, 'usage.sessionStart', () => usageSessionStart($, e))
    await guard($, 'work.sessionStart', () => workSessionStart($, e))
    await guard($, 'timeline.sessionStart', () => timelineSessionStart($, e))
    await guard($, 'agents.sessionStart', () => agentsSessionStart($, e))
    await guard($, 'git.sessionStart', () => gitSessionStart($, e))
    await guard($, 'transcript.sessionStart', () => transcriptSessionStart($, e))
    await guard($, 'icons.sessionStart', () => iconsSessionStart($, e))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await guard($, 'usage.turnStart', () => usageTurnStart($, e))
    await guard($, 'work.turnStart', () => workTurnStart($, e))
    await guard($, 'timeline.turnStart', () => timelineTurnStart($, e))
    await guard($, 'agents.turnStart', () => agentsTurnStart($, e))
    await guard($, 'git.turnStart', () => gitTurnStart($, e))
    await guard($, 'transcript.turnStart', () => transcriptTurnStart($, e))
    await guard($, 'icons.turnStart', () => iconsTurnStart($, e))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    await guard($, 'usage.toolStart', () => usageToolStart($, e))
    await guard($, 'work.toolStart', () => workToolStart($, e))
    await guard($, 'timeline.toolStart', () => timelineToolStart($, e))
    await guard($, 'agents.toolStart', () => agentsToolStart($, e))
    await guard($, 'git.toolStart', () => gitToolStart($, e))
    await guard($, 'transcript.toolStart', () => transcriptToolStart($, e))
    await guard($, 'icons.toolStart', () => iconsToolStart($, e))
    const ran = await next(e)
    await guard($, 'usage.toolEnd', () => usageToolEnd($, e, ran))
    await guard($, 'work.toolEnd', () => workToolEnd($, e, ran))
    await guard($, 'timeline.toolEnd', () => timelineToolEnd($, e, ran))
    await guard($, 'agents.toolEnd', () => agentsToolEnd($, e, ran))
    await guard($, 'git.toolEnd', () => gitToolEnd($, e, ran))
    await guard($, 'transcript.toolEnd', () => transcriptToolEnd($, e, ran))
    await guard($, 'icons.toolEnd', () => iconsToolEnd($, e, ran))
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const texts = [
      await guard($, 'usage.turnComplete', () => usageTurnComplete($, e)),
      await guard($, 'work.turnComplete', () => workTurnComplete($, e)),
      await guard($, 'timeline.turnComplete', () => timelineTurnComplete($, e)),
      await guard($, 'agents.turnComplete', () => agentsTurnComplete($, e)),
      await guard($, 'git.turnComplete', () => gitTurnComplete($, e)),
      await guard($, 'transcript.turnComplete', () => transcriptTurnComplete($, e)),
      await guard($, 'icons.turnComplete', () => iconsTurnComplete($, e)),
    ].filter((t): t is string => typeof t === 'string' && t !== '')
    const r = await next(e)
    // A text other than the answer is drawn beneath it, on every surface.
    return texts.length && e.agentId === undefined ? { ...r, text: texts.join('\n\n') } : r
  })

  on('command.run', { command: 'hud' }, async $ => {
    await openPane($)
    return { text: 'Atlas HUD opened.' }
  })

  // The band above the prompt: what needs an answer or a look, stacked.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const el = $.ui.resolve(e) as unknown as Els
    const items = [await doneBand($, el, e.surface), await decisionBand($, el, e.surface)].filter(Boolean)
    if (!items.length) return next(e)
    return (
      <el.Box flexDirection="column" gap={0}>
        {items}
      </el.Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const el = $.ui.resolve(e) as unknown as Els
    const stored = await read($, tab)
    // A tab stored by an older version (`usage`, `tasks`...) opens Overview.
    const current: Tab = TABS.includes(stored) ? stored : 'overview'
    const now = await $.clock.now()
    const proposed = await proposedCount($)
    const tabs: TabSpec[] = [
      { key: 'overview', label: 'Overview', icon: 'overview' },
      { key: 'work', label: 'Work', icon: 'work', badge: proposed || undefined },
      { key: 'agents', label: 'Agents', icon: 'agents' },
      { key: 'timeline', label: 'Timeline', icon: 'timeline' },
    ]

    let body
    if (current === 'overview') {
      const git = await gitPanel($, el, e.surface)
      body = (
        <el.Box flexDirection="column" gap={1}>
          {await usageView($, el, now)}
          {git}
        </el.Box>
      )
    } else if (current === 'work') body = await workView($, el, e.surface)
    else if (current === 'agents') body = await agentsView($, el, e.surface)
    else body = await timelineView($, el, e.surface)

    return (
      <PaneFrame el={el} surface={e.surface} tabs={tabs} current={current} onTab={k => update($, tab, () => k as Tab)}>
        {body}
      </PaneFrame>
    )
  })
}

function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: TITLE })
}

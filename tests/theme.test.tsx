import { expect, mock, test } from 'claude-code/testing'

import { barRuns, barSvg } from '../hooks/ui/kit'
import { WORDMARK, ruleSvg } from '../hooks/ui/chrome'
import { C, PROGRESS_RAMP, RISK_RAMP, rampAt } from '../hooks/ui/theme'

const NOW = Date.parse('2026-11-05T12:00:00Z')

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const
const TAB_KEYS = ['overview', 'work', 'agents', 'timeline'] as const
const TAB_LABELS = { overview: 'Overview', work: 'Work', agents: 'Agents', timeline: 'Timeline' } as const

const PANE = {
  plugin: 'atlas-hud',
  component: 'Pane',
  requestId: 'atlas-hud',
  props: {
    title: 'Atlas HUD',
    isFocused: false,
    bodyColumns: 44,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const BAND = {
  plugin: 'atlas-hud',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 100, scroll: { offset: 0, bodyRows: 8 }, view: {} },
} as const

const propose = ($: { turn: { complete: (e: never) => Promise<unknown> } }, turnId: string, text: string) =>
  $.turn.complete({ answer: `Okay.\n<!-- decision: ${text} -->`, durationMs: 1000, isAborted: false, turnId, reason: 'answer' } as never)

test('the header draws the wordmark and its rule on every surface', async ($, on) => {
  mock.clock(on, { now: NOW })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const mark = await ui.find({ type: 'Text', text: WORDMARK })
    expect(mark?.text).toBe('ATLAS HUD')
    expect(mark?.props.color).toBe(C.teal)

    const svgs = await ui.findAll({ type: 'Svg' })
    const rule = svgs.find(s => s.props.alt === 'Atlas header rule')
    if (surface === 'terminal') {
      // No Svg in the terminal: the rule is drawn in teal and gold cells.
      expect(svgs).toHaveLength(0)
      const teal = await ui.find({ type: 'Text', text: /^━+$/ })
      expect(teal?.props.color).toBe(C.teal)
    } else {
      expect(rule?.props.isInteractive).toBe(true)
      expect(String(rule?.props.source).startsWith('<svg')).toBe(true)
    }
    await ui.unmount()
  }
})

test('the tab bar has the four tabs on every surface, the current one marked', async ($, on) => {
  mock.clock(on, { now: NOW })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    for (const key of TAB_KEYS) {
      const b = await ui.find({ type: 'Button', key: `tab-${key}` })
      expect(b?.props.label).toBe(TAB_LABELS[key])
    }
    const active = await ui.find({ type: 'Text', text: /^Overview$/ })
    expect(active?.props.weight).toBe('bold')
    expect(active?.props.underline).toBe(true)
    const other = await ui.find({ type: 'Text', text: /^Work$/ })
    expect(other?.props.weight).toBe('regular')
    await ui.unmount()
  }
})

test('pressing a tab switches the body and marks that tab, and the choice stays', async ($, on) => {
  mock.clock(on, { now: NOW })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Waiting for the first usage reading/ })) !== undefined).toBe(true)

    await ui.press({ key: 'tab-work' })
    expect((await ui.find({ type: 'Text', text: /^TASKS$/ }))?.text).toBe('TASKS')
    expect((await ui.find({ type: 'Text', text: /Waiting for the first usage reading/ })) === undefined).toBe(true)
    expect((await ui.find({ type: 'Text', text: /^Work$/ }))?.props.weight).toBe('bold')

    for (const key of ['agents', 'timeline'] as const) {
      await ui.press({ key: `tab-${key}` })
      expect((await ui.find({ type: 'Text', text: /^TASKS$/ })) === undefined).toBe(true)
      expect((await ui.find({ type: 'Text', text: new RegExp(`^${TAB_LABELS[key]}$`) }))?.props.weight).toBe('bold')
      expect((await ui.find({ type: 'Text', text: /^Overview$/ }))?.props.weight).toBe('regular')
    }
    await ui.unmount()

    // The tab is session state: a new drawing opens where the last one was.
    const again = await $.ui.mount({ ...PANE, surface })
    expect((await again.find({ type: 'Text', text: /^Timeline$/ }))?.props.weight).toBe('bold')
    await again.press({ key: 'tab-overview' })
    await again.unmount()
  }
})

test('the Work tab keeps, drops and removes decisions on every surface', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.toast', () => ({ value: undefined }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  for (const surface of SURFACES) {
    // A decision id is its clock time: move the clock so each proposal has its own.
    await propose($, `${surface}-a`, `keep this on ${surface}`)
    await clock.advance(1000)
    await propose($, `${surface}-b`, `drop this on ${surface}`)
    const ui = await $.ui.mount({ ...PANE, surface })
    // The Work tab carries a badge with the count waiting.
    expect((await ui.find({ type: 'Button', key: 'tab-work' }))?.props.label).toBe('Work (2)')
    await ui.press({ key: 'tab-work' })
    expect((await ui.find({ type: 'Text', text: /^CLAUDE PROPOSES$/ }))?.props.color).toBe(C.gold)

    const keeps = await ui.findAll({ type: 'Button', text: 'Keep' })
    const drops = await ui.findAll({ type: 'Button', text: 'Drop' })
    expect(keeps).toHaveLength(2)
    expect(drops).toHaveLength(2)
    expect(keeps.every(b => /^keep-/.test(String(b.key)))).toBe(true)
    expect(drops.every(b => /^drop-/.test(String(b.key)))).toBe(true)

    // The first card is the first proposal: keep it, drop the second.
    await ui.press({ key: String(keeps[0]?.key) })
    await ui.press({ key: String(drops[1]?.key) })

    expect((await ui.find({ type: 'Text', text: `keep this on ${surface}` }))?.text).toBe(`keep this on ${surface}`)
    expect((await ui.find({ type: 'Text', text: `drop this on ${surface}` })) === undefined).toBe(true)
    expect((await ui.find({ type: 'Text', text: /^CLAUDE PROPOSES$/ })) === undefined).toBe(true)
    expect((await ui.find({ type: 'Text', text: /^KEPT$/ }))?.text).toBe('KEPT')

    const rm = await ui.find({ type: 'Button', text: 'Remove' })
    expect(String(rm?.key).startsWith('rm-')).toBe(true)
    await ui.press({ key: String(rm?.key) })
    expect((await ui.find({ type: 'Text', text: `keep this on ${surface}` })) === undefined).toBe(true)
    expect((await ui.find({ type: 'Text', text: /None yet/ }))?.text).toBe('None yet. Kept decisions survive compaction.')

    await ui.press({ key: 'tab-overview' })
    await ui.unmount()
  }
})

test('the decision band keeps and drops above the prompt', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.toast', () => ({ value: undefined }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    await propose($, `${surface}-1`, `first on ${surface}`)
    await clock.advance(1000)
    await propose($, `${surface}-2`, `second on ${surface}`)
    const band = await $.ui.mount({ ...BAND, surface })
    expect((await band.find({ type: 'Text', text: /^DECISION$/ }))?.props.color).toBe(C.gold)
    // The newest proposal shows, with a count of the rest.
    expect((await band.find({ type: 'Text', text: `second on ${surface}` }))?.text).toBe(`second on ${surface}`)
    expect((await band.find({ type: 'Text', text: /more in \/hud/ }))?.text).toBe('+1 more in /hud')

    const drop = await band.find({ type: 'Button', text: 'Drop' })
    expect(String(drop?.key).startsWith('band-drop-')).toBe(true)
    await band.press({ key: String(drop?.key) })
    expect((await band.find({ type: 'Text', text: `first on ${surface}` }))?.text).toBe(`first on ${surface}`)

    const keep = await band.find({ type: 'Button', text: 'Keep' })
    expect(String(keep?.key).startsWith('band-keep-')).toBe(true)
    await band.press({ key: String(keep?.key) })
    expect((await band.find({ type: 'Text', text: /engine band/ }))?.text).toBe('engine band')
    await band.unmount()
  }
})

test('tasks draw a progress gauge and one row per task on every surface', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('tool.call', () => ({ result: { content: [{ type: 'text', text: 'Plan shown.' }] } }))
  await $.tool.call({
    tool: 'mcp__ccd_turn__update_plan',
    items: [
      { content: 'Chart the course', status: 'completed' },
      { content: 'Plot the stars', status: 'in_progress' },
      { content: 'Land', status: 'pending' },
      { content: 'Report', status: 'pending' },
    ],
  })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'tab-work' })
    expect((await ui.find({ type: 'Text', text: /^1 OF 4 DONE$/ }))?.text).toBe('1 OF 4 DONE')
    expect((await ui.find({ type: 'Text', text: /^25%$/ }))?.text).toBe('25%')
    if (surface === 'terminal') {
      const cells = (await ui.findAll({ type: 'Text', text: /^[▰▱]+$/ })).map(t => t.text).join('')
      expect(cells).toBe('▰'.repeat(6) + '▱'.repeat(18))
    } else {
      const bar = (await ui.findAll({ type: 'Svg' })).find(s => s.props.alt === '1 of 4 tasks done')
      expect(String(bar?.props.source).includes('<rect')).toBe(true)
    }
    const active = await ui.find({ type: 'Text', text: /^Plot the stars$/ })
    expect(active?.props.weight).toBe('semibold')
    const done = await ui.find({ type: 'Text', text: /^Chart the course$/ })
    expect(done?.props.strikethrough).toBe(true)
    expect(done?.props.color).toBe(C.text3)
    await ui.press({ key: 'tab-overview' })
    await ui.unmount()
  }
})

test('usage draws limit gauges with reset and pace notes, context and cost, on every surface', async ($, on) => {
  const clock = mock.clock(on, { now: NOW - 20 * 60_000 })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  const resetsAt = new Date(NOW + 3 * 3_600_000).toISOString()
  // 40% to 60% in 20 minutes: at that pace 100% comes in 40 minutes, before the reset.
  for (const [at, pct] of [
    [NOW - 20 * 60_000, 40],
    [NOW, 60],
  ] as const) {
    await clock.set(at)
    await $.session.measure({
      context: { tokens: 50000, window: 200000, percent: 25 },
      rateLimits: [{ kind: 'five_hour', percentUsed: pct, resetsAt }],
      cost: { usd: 2.5 },
      changed: ['context', 'rateLimits', 'cost'],
    })
  }

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^LIMITS$/ }))?.props.color).toBe(C.teal)
    expect((await ui.find({ type: 'Text', text: /^5-hour$/ }))?.text).toBe('5-hour')
    expect((await ui.find({ type: 'Text', text: /^60%$/ }))?.text).toBe('60%')
    expect((await ui.find({ type: 'Text', text: /^Resets in/ }))?.text).toBe('Resets in 3h 0m.')
    const pace = await ui.find({ type: 'Text', text: /At this pace/ })
    expect(pace?.text).toBe('At this pace you hit 100% in ~40m, before it resets.')
    expect(pace?.props.color).toBe(C.warn)
    expect((await ui.find({ type: 'Text', text: /^THIS CONVERSATION$/ }))?.text).toBe('THIS CONVERSATION')
    expect((await ui.find({ type: 'Text', text: /^Context window$/ }))?.text).toBe('Context window')
    expect((await ui.find({ type: 'Text', text: /^50,000 of 200,000 tokens/ })) !== undefined).toBe(true)
    expect((await ui.find({ type: 'Text', text: /^SESSION COST$/ }))?.text).toBe('SESSION COST')
    const cost = await ui.find({ type: 'Text', text: /^\$2\.50$/ })
    expect(cost?.props.color).toBe(C.gold)
    if (surface !== 'terminal') {
      const alts = (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.alt))
      expect(alts.includes('5-hour: 60% used')).toBe(true)
      expect(alts.includes('Context window: 25% used')).toBe(true)
    }
    await ui.unmount()
  }
})

test('the gauge ramp runs teal to gold to orange, and progress never warns', async () => {
  expect(rampAt(RISK_RAMP, 0)).toBe(C.teal2)
  expect(rampAt(RISK_RAMP, 0.8)).toBe(C.gold)
  expect(rampAt(RISK_RAMP, 1)).toBe(C.orange)
  for (const t of [0, 0.5, 1]) expect([C.gold, C.orange, C.danger].includes(rampAt(PROGRESS_RAMP, t) as never)).toBe(false)

  const runs = barRuns(50, 10)
  expect(runs.map(r => r.text).join('')).toBe('▰▰▰▰▰▱▱▱▱▱')
  expect(runs.at(-1)?.color).toBe(C.line)
  expect(barRuns(-5, 4).map(r => r.text).join('')).toBe('▱▱▱▱')
  expect(barRuns(250, 4).map(r => r.text).join('')).toBe('▰▰▰▰')
})

test('the drawn SVGs are small and carry no script or handlers', async () => {
  for (const src of [ruleSvg(), barSvg(0), barSvg(57), barSvg(100, 48, PROGRESS_RAMP)]) {
    expect(src.length < 131072).toBe(true)
    expect(src.startsWith('<svg')).toBe(true)
    expect(/<script/i.test(src)).toBe(false)
    expect(/\son[a-z]+\s*=/i.test(src)).toBe(false)
  }
})

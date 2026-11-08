import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-11-05T12:00:00Z')

import { applyPlan, decisionsIn, describe as say, keptSection, parseTests, verdict, wrapPlan } from '../hooks/lib'

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

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

test('test counts parse from vitest and pytest output', async () => {
  expect(parseTests(' Tests  2 failed | 1,204 passed (1206)')).toEqual({ passed: 1204, failed: 2 })
  expect(parseTests(' Tests  1,206 passed (1206)')).toEqual({ passed: 1206, failed: 0 })
  expect(parseTests('=== 5 passed, 1 failed in 0.3s ===')).toEqual({ passed: 5, failed: 1 })
  expect(parseTests('nothing here')).toBe(undefined)
})

test('test counts parse from node --test output, spec and TAP', async () => {
  const spec = '✔ adds (0.4ms)\n✖ subtracts (0.6ms)\nℹ tests 4\nℹ suites 0\nℹ pass 3\nℹ fail 1\nℹ cancelled 0\nℹ duration_ms 41.2'
  expect(parseTests(spec)).toEqual({ passed: 3, failed: 1 })
  const tap = 'TAP version 13\nok 1 - adds\n1..3\n# tests 3\n# suites 0\n# pass 3\n# fail 0\n# cancelled 0'
  expect(parseTests(tap)).toEqual({ passed: 3, failed: 0 })
})

test('a turn is described in plain English, with no em dash', async () => {
  const lines = say({
    id: 't',
    at: 0,
    durationMs: 1000,
    edited: ['src/styles/theme.css', 'src/app/a.js', 'src/app/b.js', 'src/c.js'],
    created: [],
    reads: 2,
    searches: 0,
    steps: [{ kind: 'test', label: 'npx vitest run', ok: false }],
    tests: { passed: 1204, failed: 2 },
    isVerified: true,
    claimsDone: false,
  })
  expect(lines[0]).toBe('Changed 4 files: theme.css, a.js, b.js and 1 more.')
  expect(lines[1]).toBe('Ran the tests: 1,204 passed, 2 failed.')
  expect(lines.join(' ').includes(String.fromCharCode(0x2014))).toBe(false)
})

test('a push is described without naming a host', async () => {
  const turn = (ok: boolean) =>
    say({
      id: 't',
      at: 0,
      durationMs: 1000,
      edited: [],
      created: [],
      reads: 0,
      searches: 0,
      steps: [{ kind: 'push', label: 'git push origin main', ok }],
      isVerified: false,
      claimsDone: false,
    })
  expect(turn(true)).toEqual(['Pushed the branch.'])
  expect(turn(false)).toEqual(['Tried to push the branch, and it failed.'])
})

test('says done without checking is flagged', async () => {
  const v = verdict({ edited: ['a.js'], created: [], isVerified: false, claimsDone: true })
  expect(v?.tone).toBe('warn')
  expect(verdict({ edited: [], created: [], isVerified: false, claimsDone: true })).toBe(undefined)
})

test('hidden decision comments are found', async () => {
  expect(decisionsIn('Sure.\n<!-- decision: use Deep Space colours -->')).toEqual(['use Deep Space colours'])
})

test('a measured limit draws a gauge on every surface and fills the status line', async ($, on) => {
  mock.clock(on, { now: NOW })
  let status: string | undefined
  on('ui.status', (_, e) => {
    status = (e as { text?: string }).text
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('session.measure', (_, e) => ({ changed: e.changed }))

  await $.session.measure({
    context: { tokens: 61000, window: 200000, percent: 30.5 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 80, resetsAt: new Date(NOW + 3_600_000).toISOString() }],
    cost: { usd: 1.234 },
    changed: ['context', 'rateLimits', 'cost'],
  })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^5-hour$/ }))?.text).toBe('5-hour')
    expect((await ui.find({ type: 'Text', text: /^80%$/ }))?.text).toBe('80%')
    expect((await ui.find({ type: 'Text', text: /Context window/ }))?.text).toBe('Context window')
    await ui.unmount()
  }
  expect(status).toBe('5h 80% · ctx 31% · $1.23')
})

test('tasks from TaskCreate and TaskUpdate show in the Tasks tab', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('tool.call', (_, e) => {
    const call = e as { tool: string }
    if (call.tool === 'TaskCreate') return { result: { task: { id: '1', subject: 'Build the HUD' } } }
    return { result: { success: true, taskId: '1', updatedFields: ['status'] } }
  })
  await $.tool.call({ tool: 'TaskCreate', subject: 'Build the HUD', description: 'x' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'tab-work' })
    expect((await ui.find({ type: 'Text', text: /Build the HUD/ }))?.text).toBe('▸ Build the HUD')
    await ui.press({ key: 'tab-overview' })
    await ui.unmount()
  }
})

test('a decision Claude proposes can be kept', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('ui.toast', () => ({ value: undefined }))
  on('turn.complete', (_, e) => ({ text: (e as { answer: string }).answer }))
  await $.turn.complete({
    answer: 'Okay.\n<!-- decision: no guards for now -->',
    durationMs: 1000,
    isAborted: false,
    turnId: 'a',
    reason: 'answer',
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  await ui.press({ key: 'tab-work' })
  expect((await ui.find({ type: 'Text', text: /no guards/ }))?.text).toBe('no guards for now')
  await ui.unmount()
})

test('an edit with no check gets a card that says so, and tool rows get tags', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('ui.toast', () => ({ value: undefined }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: { type: 'update' } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>row</Text>
  })

  await $.turn.start({ text: 'fix it', turnId: 'k' })
  await $.tool.call({ tool: 'Edit', file_path: '/x/src/styles/theme.css', old_string: 'a', new_string: 'b' })
  const done = await $.turn.complete({ answer: 'Fixed, all done.', durationMs: 4000, isAborted: false, turnId: 'k', reason: 'answer' })
  // The summary is the text shown beneath the answer.
  expect(done.text).toBe(
    'WHAT CHANGED · 0m\nChanged 1 file: theme.css.\n! Says done, but nothing was run to check the change.',
  )

  // A turn that used no tools leaves the answer alone.
  await $.turn.start({ text: 'thanks', turnId: 'q' })
  const quiet = await $.turn.complete({ answer: 'Any time.', durationMs: 900, isAborted: false, turnId: 'q', reason: 'answer' })
  expect(quiet.text).toBe('Any time.')

  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ ...PANE, surface })
    await pane.press({ key: 'tab-timeline' })
    expect((await pane.find({ type: 'Text', text: /^Changed/ }))?.text).toBe('Changed 1 file: theme.css.')
    await pane.press({ key: 'tab-overview' })
    await pane.unmount()

    const row = await $.ui.mount({
      plugin: 'atlas-hud',
      component: 'ToolUse',
      requestId: 'u1',
      props: { tool_use_id: 'u1', tool: 'Bash', input: { command: 'npx vitest run' }, isRunning: false, isErrored: false, isInterrupted: false },
      surface,
    })
    expect((await row.find({ type: 'Text', text: /TEST/ }))?.text).toBe('TEST')
    await row.unmount()
  }
})

test('pressing Keep still draws the Decisions tab', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('ui.toast', () => ({ value: undefined }))
  on('turn.complete', (_, e) => ({ text: (e as { answer: string }).answer }))
  await $.turn.complete({
    answer: 'Okay.\n<!-- decision: no guards for now -->',
    durationMs: 1000,
    isAborted: false,
    turnId: 'a',
    reason: 'answer',
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-work' })
  await ui.press({ key: `keep-${NOW}-0` })
  expect((await ui.find({ type: 'Text', text: /no guards/ }))?.text).toBe('· no guards for now')
  await ui.unmount()
})

test('the desktop plan tool fills the task list, step by step', async () => {
  const items = [
    { content: 'Read the code', status: 'in_progress' },
    { content: 'Fix it', status: 'pending' },
    { content: 'Run the tests', status: 'pending' },
  ]
  const other = { id: '7', subject: 'From TaskCreate', status: 'pending' as const }
  let list = applyPlan([other], { items, scope: 'first_task' })
  expect(list.map(t => `${t.id}:${t.status}`)).toEqual(['7:pending', 'plan-1:in_progress', 'plan-2:pending', 'plan-3:pending'])
  list = applyPlan(list, { advance: true })
  expect(list.filter(t => t.id.startsWith('plan-')).map(t => t.status)).toEqual(['completed', 'in_progress', 'pending'])
  list = applyPlan(list, { done: [2], start: 3 })
  expect(list.filter(t => t.id.startsWith('plan-')).map(t => t.status)).toEqual(['completed', 'completed', 'in_progress'])
  list = wrapPlan(list)
  expect(list.every(t => t.id === '7' || t.status === 'completed')).toBe(true)
  // A new plan replaces the old one and keeps other tasks.
  list = applyPlan(list, { items: [{ content: 'Next thing', status: 'in_progress' }] })
  expect(list.map(t => t.subject)).toEqual(['From TaskCreate', 'Next thing'])
})

test('plan calls show in the Tasks tab', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('tool.call', () => ({ result: { content: [{ type: 'text', text: 'Plan shown.' }] } }))
  await $.tool.call({
    tool: 'mcp__ccd_turn__update_plan',
    items: [
      { content: 'Look at the setup', status: 'in_progress' },
      { content: 'Ship it', status: 'pending' },
    ],
  })
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', advance: true })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'tab-work' })
    expect((await ui.find({ type: 'Text', text: /1 OF 2 DONE/ }))?.text).toBe('1 OF 2 DONE')
    expect((await ui.find({ type: 'Text', text: /Ship it/ }))?.text).toBe('▸ Ship it')
    await ui.press({ key: 'tab-overview' })
    await ui.unmount()
  }
})

test('a proposed decision waits above the prompt and Keep sends it to Claude', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('ui.toast', () => ({ value: undefined }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.compose', (_, e) => ({ sections: e.sections }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
  expect(keptSection([])).toBe(undefined)

  for (const surface of ['terminal', 'desktop'] as const) {
    const id = `${surface}-turn`
    await $.turn.complete({ answer: `Okay.\n<!-- decision: no guards on ${surface} -->`, durationMs: 1000, isAborted: false, turnId: id, reason: 'answer' })
    const band = await $.ui.mount({
      plugin: 'atlas-hud',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 100, scroll: { offset: 0, bodyRows: 8 }, view: {} },
      surface,
    })
    expect((await band.find({ type: 'Text', text: /no guards/ }))?.text).toBe(`no guards on ${surface}`)
    await band.press({ key: `band-keep-${NOW}-0` })
    // Kept, the band hands back to the engine's own.
    expect((await band.find({ type: 'Text', text: /engine band/ }))?.text).toBe('engine band')
    await band.unmount()

    const r = await $.prompt.compose({
      model: 'claude-opus-5-5',
      promptModel: 'claude-opus-5-5',
      surfaces: [surface],
      tools: [],
      outputStyle: null,
      traits: [],
      sections: [{ id: 'intro', text: 'You are Claude.', scope: 'shared' }],
    } as never)
    const kept = r.sections.find(s => s.id === 'atlas-hud-kept-decisions')
    expect(kept?.text.includes(`- no guards on ${surface}`)).toBe(true)
  }
})

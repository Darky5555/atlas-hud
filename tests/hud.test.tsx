import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-11-05T12:00:00Z')

import { decisionsIn, describe as say, parseTests, verdict } from '../hooks/lib'

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
    await ui.press({ key: 'tab-tasks' })
    expect((await ui.find({ type: 'Text', text: /Build the HUD/ }))?.text).toBe('▸ Build the HUD')
    await ui.press({ key: 'tab-usage' })
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
  await ui.press({ key: 'tab-decisions' })
  expect((await ui.find({ type: 'Text', text: /no guards/ }))?.text).toBe('no guards for now')
  await ui.unmount()
})

test('an edit with no check gets a card that says so, and tool rows get tags', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.place', () => ({ value: { isPlaced: true as const, requestId: 'p' } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: { type: 'update' } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>row</Text>
  })

  await $.turn.start({ text: 'fix it', turnId: 'k' })
  await $.tool.call({ tool: 'Edit', file_path: '/x/src/styles/theme.css', old_string: 'a', new_string: 'b' })
  await $.turn.complete({ answer: 'Fixed, all done.', durationMs: 4000, isAborted: false, turnId: 'k', reason: 'answer' })

  for (const surface of SURFACES) {
    const card = await $.ui.mount({ plugin: 'atlas-hud', component: 'Placed', props: { id: 'turn-k', plugin: 'atlas-hud' }, surface })
    expect((await card.find({ type: 'Text', text: /^Changed/ }))?.text).toBe('Changed 1 file: theme.css.')
    expect((await card.find({ type: 'Text', text: /nothing was run/ }))?.text).toBe('! Says done, but nothing was run to check the change.')
    await card.unmount()

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
  await ui.press({ key: 'tab-decisions' })
  await ui.press({ key: `keep-${NOW}-0` })
  expect((await ui.find({ type: 'Text', text: /no guards/ }))?.text).toBe('· no guards for now')
  await ui.unmount()
})

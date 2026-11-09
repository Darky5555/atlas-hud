import { expect, mock, test } from 'claude-code/testing'
import type { AgentInfo } from 'claude-code'

import { bound, elapsed, listStatus, MAX_AGENTS, reportLines, tokenCount, treeOf } from '../hooks/features/agents'
import type { AgentRun } from '../types'

const NOW = Date.parse('2026-11-05T12:00:00Z')

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
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const USAGE = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm' }

const run = (id: string, over: Partial<AgentRun> = {}): AgentRun => ({ id, status: 'running', startedAt: 0, tools: 0, tokens: 0, at: 0, ...over })

test('elapsed time reads in seconds, minutes and hours', async () => {
  expect(elapsed(0)).toBe('0s')
  expect(elapsed(42_400)).toBe('42s')
  expect(elapsed(185_000)).toBe('3m 05s')
  expect(elapsed(3_840_000)).toBe('1h 04m')
  expect(elapsed(-5)).toBe('0s')
  expect(tokenCount(860)).toBe('860')
  expect(tokenCount(1200)).toBe('1.2k')
  expect(tokenCount(48_300)).toBe('48k')
  expect(tokenCount(1_250_000)).toBe('1.3M')
})

test('a report keeps its first two lines', async () => {
  expect(reportLines('\nFound 3 modules.\n\nAll tests pass.\nThird line')).toEqual(['Found 3 modules.', 'All tests pass.'])
  expect(reportLines('')).toEqual([])
  expect(reportLines('x'.repeat(300))[0]?.length).toBe(120)
})

test('the tree puts children under their parent and survives a loop of parents', async () => {
  const list = [run('child', { parentId: 'root', startedAt: 2 }), run('root', { startedAt: 1, status: 'completed' }), run('other', { startedAt: 3 })]
  expect(treeOf(list).map(r => `${r.agent.id}:${r.depth}`)).toEqual(['other:0', 'root:0', 'child:1'])
  const loop = [run('a', { parentId: 'b' }), run('b', { parentId: 'a' })]
  expect(treeOf(loop).map(r => r.agent.id).sort()).toEqual(['a', 'b'])
})

test("the tab's own turn events outrank a lagging list", async () => {
  // Never heard a turn of it: the list stands.
  expect(listStatus(undefined, 'idle')).toBe('idle')
  expect(listStatus(run('p'), 'idle')).toBe('idle')
  // A turn heard open: a lagging idle or pending does not close it; waiting and an end do.
  expect(listStatus(run('o', { turnOpen: true }), 'idle')).toBe('running')
  expect(listStatus(run('o', { turnOpen: true }), 'pending')).toBe('running')
  expect(listStatus(run('o', { turnOpen: true }), 'waiting')).toBe('waiting')
  expect(listStatus(run('o', { turnOpen: true }), 'killed')).toBe('killed')
  // A turn heard closed: a lagging running does not reopen it; an end still lands.
  expect(listStatus(run('c', { turnOpen: false, status: 'idle' }), 'running')).toBe('idle')
  expect(listStatus(run('c', { turnOpen: false, status: 'idle' }), 'completed')).toBe('completed')
  // An end the tab saw stands.
  expect(listStatus(run('e', { turnOpen: false, status: 'failed' }), 'running')).toBe('failed')
})

test('the record is bounded, ended agents giving way first', async () => {
  const list = Array.from({ length: MAX_AGENTS + 5 }, (_, i) => run(`a${i}`, { at: i, status: i % 2 ? 'completed' : 'running' }))
  const kept = bound(list)
  expect(kept.length).toBe(MAX_AGENTS)
  // The five oldest ended ones went; every running one stayed.
  expect(kept.filter(a => a.status === 'running').length).toBe(23)
  expect(kept.some(a => a.id === 'a1')).toBe(false)
  expect(kept.some(a => a.id === 'a0')).toBe(true)
})

test('an empty Agents tab says what will show there, on every surface', async ($, on) => {
  mock.clock(on, { now: NOW })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'tab-agents' })
    expect((await ui.find({ type: 'Text', text: /^No agents yet/ }))?.text).toBe('No agents yet.')
    expect((await ui.find({ type: 'Text', text: /0 running/ }))?.text).toBe('0 running · 0 done · 0 failed')
    await ui.press({ key: 'tab-overview' })
    // No agents: Overview leaves the line out.
    expect(await ui.find({ type: 'Text', text: /^AGENTS$/ })).toBe(undefined)
    await ui.unmount()
  }
})

test("agents' runs show as a tree with status, tools, time, tokens and report, on every surface", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  // The engine's list: names, types and who spawned whom, and a teammate in
  // a pane of its own that no event of this session carries.
  const listed: AgentInfo[] = [
    { id: 'a1', description: 'Map the repo', type: 'Explore', status: 'running', name: 'scout' },
    { id: 'a2', description: 'Read the tests', type: 'general-purpose', status: 'running', parentId: 'a1' },
    { id: 'tm1', teammateId: 'watcher@crew', description: 'Watch CI', type: 'teammate', status: 'idle', name: 'watcher' },
  ]
  on('agent.list', () => ({ value: listed }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('agent.spawn', () => ({ model: 'm', agentId: 'a3' }))
  on('tool.call', async (_, e) => {
    if (e.tool === 'Grep') await clock.sleep(1000)
    return { result: {} }
  })

  // a1 runs a tool, spawns a2, which fails; a1 reports back.
  await $.turn.start({ text: 'Map the repo', turnId: 't1', agentId: 'a1' })
  await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a1' })
  await $.turn.start({ text: 'Read the tests', turnId: 't2', agentId: 'a2' })
  await $.tool.call({ tool: 'Read', file_path: '/x/tests/a.test.ts', agentId: 'a2' })
  await $.tool.call({ tool: 'Read', file_path: '/x/tests/b.test.ts', agentId: 'a2' })
  await clock.advance(42_000)
  await $.turn.complete({ answer: '', durationMs: 30_000, isAborted: false, turnId: 't2', agentId: 'a2', reason: 'error' })
  await $.turn.complete({
    answer: 'Found 3 modules.\nAll tests pass.\nThird line stays out.',
    durationMs: 42_000,
    isAborted: false,
    turnId: 't1',
    agentId: 'a1',
    reason: 'answer',
    usage: USAGE,
  })
  // The list still says running a moment after the end; the end stands.
  await $.turn.start({ text: 'next', turnId: 'm1' })

  // A spawn: name and type from it, timed from now, with a
  // tool still running.
  await $.agent.spawn({
    tool_use_id: 'u3',
    prompt: 'Find the config',
    description: 'Find the config',
    subagentType: 'Explore',
    name: 'finder',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'm',
    background: true,
    fork: false,
  })
  await $.turn.start({ text: 'Find the config', turnId: 't3', agentId: 'a3' })
  const grep = $.tool.call({ tool: 'Grep', pattern: 'config', agentId: 'a3' })
  await clock.advance(500)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })

    // Overview carries the one-line summary.
    expect((await ui.find({ type: 'Text', text: /^AGENTS$/ }))?.text).toBe('AGENTS')
    expect((await ui.find({ type: 'Text', text: /running ·/ }))?.text).toBe('1 running · 1 waiting · 1 done · 1 failed')

    await ui.press({ key: 'tab-agents' })
    expect((await ui.find({ type: 'Text', text: /running · \d+ done/ }))?.text).toBe('1 running · 1 done · 1 failed')

    // Names, types and descriptions, the tree in order: running first, then the newest
    // (scout and watcher were first seen at once: kept in the order seen), a child under its parent.
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    const order = ['finder', 'scout', 'general-purpose', 'watcher'].map(n => texts.indexOf(n))
    expect(order.every(i => i >= 0)).toBe(true)
    expect([...order].sort((x, y) => x - y)).toEqual(order)
    expect(texts.includes('└')).toBe(true)
    expect(texts.includes('Map the repo')).toBe(true)
    expect(texts.includes('Read the tests')).toBe(true)
    expect(texts.includes('Watch CI')).toBe(true)

    // Statuses.
    expect(texts.includes('RUNNING')).toBe(true)
    expect(texts.includes('DONE')).toBe(true)
    expect(texts.includes('FAILED')).toBe(true)
    expect(texts.includes('IDLE')).toBe(true)

    // Time, tool calls and tokens.
    expect(texts.includes('42s · 1 tool · 1.2k tok')).toBe(true)
    expect(texts.includes('42s · 2 tools · 0 tok')).toBe(true)
    expect(texts.includes('0s · 1 tool · 0 tok')).toBe(true)

    // The tool running now, and the first two lines of a report.
    expect(texts.includes('Grep')).toBe(true)
    expect(texts.includes('Found 3 modules.')).toBe(true)
    expect(texts.includes('All tests pass.')).toBe(true)
    expect(texts.includes('Third line stays out.')).toBe(false)

    await ui.press({ key: 'tab-overview' })
    await ui.unmount()
  }

  await clock.advance(1000)
  await grep
  await $.turn.complete({ answer: 'config.ts', durationMs: 2000, isAborted: true, turnId: 't3', agentId: 'a3', reason: 'aborted' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-agents' })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts.includes('STOPPED')).toBe(true)
  expect(texts.includes('Grep')).toBe(false)
  expect((await ui.find({ type: 'Text', text: /running · \d+ done/ }))?.text).toBe('0 running · 1 done · 2 failed')
  await ui.press({ key: 'tab-overview' })
  await ui.unmount()
})

test("an agent's turn leaves the main answer alone", async ($, on) => {
  mock.clock(on, { now: NOW })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const r = await $.turn.complete({ answer: 'Report.', durationMs: 1000, isAborted: false, turnId: 'x', agentId: 'a9', reason: 'answer' })
  expect(r.text).toBe('Report.')
})

test("a teammate's own turns outrank a list that lags them", async ($, on) => {
  mock.clock(on, { now: NOW })
  const mate: AgentInfo = { id: 'tm2', teammateId: 'mate@crew', description: 'Fix the lint', type: 'teammate', status: 'idle', name: 'mate' }
  on('agent.list', () => ({ value: [mate] }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const shows = async (status: string, header: string, summary: string) => {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect((await ui.find({ type: 'Text', text: /^\d+ (running|waiting|done|failed)( ·|$)/ }))?.text).toBe(summary)
    await ui.press({ key: 'tab-agents' })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(texts.includes(status)).toBe(true)
    expect((await ui.find({ type: 'Text', text: /running · \d+ done/ }))?.text).toBe(header)
    await ui.press({ key: 'tab-overview' })
    await ui.unmount()
  }

  // Woken: its turn starts while the list still says idle.
  await $.turn.start({ text: 'Fix the lint', turnId: 'w1', agentId: 'tm2' })
  await shows('RUNNING', '1 running · 0 done · 0 failed', '1 running')

  // Its turn ends while the list still says running.
  mate.status = 'running'
  await $.turn.complete({ answer: 'Lint fixed.', durationMs: 5000, isAborted: false, turnId: 'w1', agentId: 'tm2', reason: 'answer' })
  await $.turn.start({ text: 'next', turnId: 'm1' })
  await shows('IDLE', '0 running · 0 done · 0 failed', '1 waiting')

  // An end the list reports still lands.
  mate.status = 'killed'
  await $.turn.start({ text: 'again', turnId: 'm2' })
  await shows('STOPPED', '0 running · 0 done · 1 failed', '1 failed')
})

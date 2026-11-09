import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Turn } from '../types'
import { chartSvg, compact, filesTouched, sparkline, stepIcons, tokenSeries, tokensOf } from '../hooks/features/timeline-lib'
import { duration, summaryText, turnDuration } from '../hooks/lib'

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
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const usage = (input: number, output: number, cacheRead: number, cacheWrite: number) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
  model: 'stub',
})

// A turn as v1 stored it: none of the v2 fields.
const oldTurn = (id: string, at: number, edited: string[], created: string[] = []): Turn => ({
  id,
  at,
  durationMs: 42_000,
  edited,
  created,
  reads: 0,
  searches: 0,
  steps: [],
  isVerified: false,
  claimsDone: false,
  lines: [`Changed ${edited.length} file: old ${id}.`],
})

/** The stand-ins for the engine beneath the plugin, for a run of turns. */
function engine(on: On) {
  mock.clock(on, { now: NOW })
  on('ui.toast', () => ({ value: undefined }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', (_, e) => {
    if (e.tool === 'Write') return { result: { type: 'create' } }
    if (e.tool === 'Bash') return { result: { stdout: ' Tests  12 passed (12)', stderr: '' } }
    if (e.tool === 'Read') return { result: { type: 'text' } }
    return { result: { type: 'update' } }
  })
}

type Stored = { value: { shape: string; value: Turn[] } | undefined; version: number }

/**
 * A store for the `turns` key alone, beneath the plugin, so a test can seed
 * what an earlier version wrote and read back what this one writes.
 */
function turnsStore(on: On, initial?: Turn[]) {
  const box: { at: Stored } = { at: { value: initial ? { shape: 'turns-1', value: initial } : undefined, version: initial ? 1 : 0 } }
  const isTurns = (e: unknown) => {
    const a = e as { plugin?: string; key?: string }
    return a.plugin === 'atlas-hud' && a.key === 'turns'
  }
  on('state.get', (_, e, next) => (isTurns(e) ? { value: box.at } : next(e)))
  on('state.set', (_, e, next) => {
    if (!isTurns(e)) return next(e)
    const w = e as unknown as { value: Stored['value']; ifVersion?: number }
    if (w.ifVersion !== undefined && w.ifVersion !== box.at.version) return { value: { isSet: false as const, version: box.at.version } }
    box.at = { value: w.value, version: box.at.version + 1 }
    return { value: { isSet: true as const, version: box.at.version } }
  })
  return box
}

test('turn durations show seconds; reset notes keep their minutes', async () => {
  expect(turnDuration(0)).toBe('<1s')
  expect(turnDuration(900)).toBe('<1s')
  expect(turnDuration(42_000)).toBe('42s')
  expect(turnDuration(59_600)).toBe('1m 00s')
  expect(turnDuration(185_000)).toBe('3m 05s')
  expect(turnDuration(3_720_000)).toBe('1h 02m')
  expect(turnDuration(Number.NaN)).toBe('<1s')
  // `duration` (used by the usage view's reset notes) is unchanged.
  expect(duration(7_500_000)).toBe('2h 5m')
  expect(duration(300_000)).toBe('5m')
})

test('the summary beneath the answer shows seconds', async () => {
  const turn: Turn = { ...oldTurn('s', NOW, ['/a/b.ts']), durationMs: 42_000, lines: ['Changed 1 file: b.ts.'] }
  expect(summaryText(turn).split('\n')[0]).toBe('WHAT CHANGED · 42s')
})

test('token helpers: counts, compact numbers, sparkline, chart', async () => {
  expect(tokensOf(usage(1, 2, 3, 4))).toEqual({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4 })
  expect(tokensOf(undefined)).toBe(undefined)
  expect(compact(950)).toBe('950')
  expect(compact(1200)).toBe('1.2k')
  expect(compact(24_000)).toBe('24k')
  expect(compact(1_300_000)).toBe('1.3M')
  // Rounded first, then the unit picked: no "1000k", one label per scale.
  expect(compact(999.6)).toBe('1k')
  expect(compact(9_999)).toBe('10k')
  expect(compact(10_000)).toBe('10k')
  expect(compact(999_500)).toBe('1M')
  expect(compact(999_999)).toBe('1M')
  expect(compact(999_499)).toBe('999k')
  expect(compact(1_250_000)).toBe('1.3M')
  expect(compact(-1200)).toBe('-1.2k')
  expect(sparkline([24_000, 3000, undefined])).toBe('█▂·')
  expect(sparkline([0, 0])).toBe('▁▁')

  const many: Turn[] = Array.from({ length: 25 }, (_, i) => ({
    ...oldTurn(`t${i}`, NOW + i, []),
    tokens: { input: i * 100, output: 10, cacheRead: 0, cacheWrite: 0 },
  }))
  const series = tokenSeries(many)
  expect(series.length).toBe(20)
  const svg = chartSvg(series)
  expect(svg.length < 131072).toBe(true)
  expect(/<script/i.test(svg)).toBe(false)
  expect(/\son[a-z]+=/i.test(svg)).toBe(false)
  expect((svg.match(/<rect /g) ?? []).length).toBe(21) // the backdrop and one bar per turn
})

test('files touched counts edits, falls back for old turns, and caps at 8', async () => {
  const list: Turn[] = [
    oldTurn('o1', NOW, ['/r/a.ts', '/r/b.ts']),
    { ...oldTurn('n1', NOW + 1, ['/r/a.ts'], ['/r/new.ts']), fileEdits: { '/r/a.ts': 3, '/r/new.ts': 1 } },
  ]
  const rows = filesTouched(list)
  expect(rows.map(r => [r.path, r.count, r.isCreated])).toEqual([
    ['/r/a.ts', 4, false],
    ['/r/new.ts', 1, true],
    ['/r/b.ts', 1, false],
  ])
  const wide = [oldTurn('w', NOW, Array.from({ length: 12 }, (_, i) => `/r/f${i}.ts`))]
  expect(filesTouched(wide).length).toBe(8)
})

test('step icons name what the turn did, each once', async () => {
  expect(
    stepIcons({
      edited: ['a'],
      created: ['b'],
      reads: 2,
      searches: 0,
      steps: [
        { kind: 'test', label: 'x', ok: true },
        { kind: 'test', label: 'y', ok: true },
        { kind: 'push', label: 'git push', ok: true },
      ],
    }),
  ).toEqual(['write', 'edit', 'read', 'test', 'push'])
})

test('several turns: the chart, files and list on every surface', async ($, on) => {
  engine(on)
  const store = turnsStore(on)

  // a: three edits, then the tests pass. 42s, 24k tokens.
  await $.turn.start({ text: 'fix the theme', turnId: 'a' })
  for (const n of ['b', 'c', 'd']) {
    await $.tool.call({ tool: 'Edit', file_path: '/x/src/styles/theme.css', old_string: 'a', new_string: n })
  }
  await $.tool.call({ tool: 'Bash', command: 'npx vitest run' })
  const a = await $.turn.complete({
    answer: 'Fixed the colours.',
    durationMs: 42_000,
    isAborted: false,
    turnId: 'a',
    reason: 'answer',
    usage: usage(2000, 1000, 20_000, 1000),
  })
  expect(a.text.split('\n')[0]).toBe('WHAT CHANGED · 42s')

  // b: a new file and one more edit, says done, nothing run. 3m 05s, 3k tokens.
  await $.turn.start({ text: 'add a file', turnId: 'b' })
  await $.tool.call({ tool: 'Write', file_path: '/x/src/new.ts', content: 'x' })
  await $.tool.call({ tool: 'Edit', file_path: '/x/src/styles/theme.css', old_string: 'a', new_string: 'e' })
  const b = await $.turn.complete({
    answer: 'All done.',
    durationMs: 185_000,
    isAborted: false,
    turnId: 'b',
    reason: 'answer',
    usage: usage(2000, 1000, 0, 0),
  })
  expect(b.text.split('\n')[0]).toBe('WHAT CHANGED · 3m 05s')

  // c: a read, under a second, no usage reported.
  await $.turn.start({ text: 'look', turnId: 'c' })
  await $.tool.call({ tool: 'Read', file_path: '/x/src/new.ts' })
  await $.turn.complete({ answer: 'It is fine.', durationMs: 900, isAborted: false, turnId: 'c', reason: 'answer' })

  // What was stored for turn a.
  const stored = store.at.value
  expect(stored?.shape).toBe('turns-1')
  const first = stored?.value.find(t => t.id === 'a')
  expect(first?.tokens).toEqual({ input: 2000, output: 1000, cacheRead: 20_000, cacheWrite: 1000 })
  expect(first?.tools).toEqual({ Edit: 3, Bash: 1 })
  expect(first?.fileEdits).toEqual({ '/x/src/styles/theme.css': 3 })
  expect(stored?.value.find(t => t.id === 'c')?.tokens).toBe(undefined)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'tab-timeline' })

    // (1) the token chart
    expect((await ui.find({ type: 'Text', text: /^TOKENS$/ }))?.text).toBe('TOKENS')
    const svgs = await ui.findAll({ type: 'Svg' })
    const chart = svgs.find(s => /^Tokens per turn/.test(String(s.props.alt)))
    if (surface === 'terminal') {
      expect(svgs.length).toBe(0)
      expect((await ui.find({ type: 'Text', text: /^[▁▂▃▄▅▆▇█·]+$/ }))?.text).toBe('█▂·')
    } else {
      expect(chart).toBeDefined()
      expect(String(chart?.props.source).startsWith('<svg')).toBe(true)
      expect(String(chart?.props.alt)).toBe('Tokens per turn over the last 3 turns: min 3k · max 24k · total 27k')
    }
    expect((await ui.find({ type: 'Text', text: /^min / }))?.text).toBe('min 3k · max 24k · total 27k')

    // (2) files touched, most first
    expect((await ui.find({ type: 'Text', text: /^FILES TOUCHED$/ }))?.text).toBe('FILES TOUCHED')
    const files = (await ui.findAll({ type: 'Text', text: /^(styles\/theme\.css|src\/new\.ts)$/ })).map(t => t.text)
    expect(files).toEqual(['styles/theme.css', 'src/new.ts'])
    const counts = (await ui.findAll({ type: 'Text', text: /^\d+ edits?$/ })).map(t => t.text)
    expect(counts).toEqual(['4 edits', '1 edit'])

    // (3) the turn list, newest first
    const heads = (await ui.findAll({ type: 'Text', text: / · \d+ tools?/ })).map(t => t.text)
    expect(heads.length).toBe(3)
    expect(heads[0]?.endsWith(' · <1s · 1 tool')).toBe(true)
    expect(heads[1]?.endsWith(' · 3m 05s · 2 tools · 3k tokens')).toBe(true)
    expect(heads[2]?.endsWith(' · 42s · 4 tools · 24k tokens')).toBe(true)
    expect((await ui.find({ type: 'Text', text: /^Looked through/ }))?.text).toBe('Looked through 1 file without changing any.')
    expect((await ui.find({ type: 'Text', text: /^Says done/ }))?.text).toBe('Says done, but nothing was run to check the change.')
    expect((await ui.find({ type: 'Text', text: /^Checked:/ }))?.text).toBe('Checked: a test, build or check ran after the last change.')
    expect((await ui.find({ type: 'Text', text: /^Ran the tests/ }))?.text).toBe('Ran the tests: all 12 passed.')

    await ui.press({ key: 'tab-overview' })
    await ui.unmount()
  }
})

test('old turns without the new fields still draw, and new turns add to them', async ($, on) => {
  engine(on)
  turnsStore(on, [oldTurn('o1', NOW - 2000, ['/x/a.ts']), oldTurn('o2', NOW - 1000, ['/x/a.ts'], ['/x/b.ts'])])

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'tab-timeline' })
    expect((await ui.find({ type: 'Text', text: /^Token counts start/ }))?.text).toBe('Token counts start with the next turn that uses tools.')
    expect((await ui.findAll({ type: 'Svg' })).find(s => /^Tokens per turn/.test(String(s.props.alt)))).toBe(undefined)
    expect((await ui.find({ type: 'Text', text: /^x\/a\.ts$/ }))?.text).toBe('x/a.ts')
    expect((await ui.findAll({ type: 'Text', text: /^\d+ edits?$/ })).map(t => t.text)).toEqual(['2 edits', '1 edit'])
    // The header has the time and duration, nothing it cannot know.
    const heads = (await ui.findAll({ type: 'Text', text: / · 42s$/ })).map(t => t.text)
    expect(heads.length).toBe(2)
    expect((await ui.find({ type: 'Text', text: /^Changed 1 file: old o2\.$/ }))?.text).toBe('Changed 1 file: old o2.')
    await ui.press({ key: 'tab-overview' })
    await ui.unmount()
  }

  await $.turn.start({ text: 'edit', turnId: 'n' })
  await $.tool.call({ tool: 'Edit', file_path: '/x/a.ts', old_string: 'a', new_string: 'b' })
  await $.turn.complete({ answer: 'Changed.', durationMs: 5000, isAborted: false, turnId: 'n', reason: 'answer', usage: usage(4000, 1000, 0, 0) })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'tab-timeline' })
    if (surface === 'terminal') expect((await ui.find({ type: 'Text', text: /^[▁▂▃▄▅▆▇█·]+$/ }))?.text).toBe('··█')
    else expect((await ui.findAll({ type: 'Svg' })).find(s => /^Tokens per turn/.test(String(s.props.alt)))).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^min / }))?.text).toBe('min 5k · max 5k · total 5k')
    expect((await ui.findAll({ type: 'Text', text: /^\d+ edits?$/ })).map(t => t.text)).toEqual(['3 edits', '1 edit'])
    await ui.press({ key: 'tab-overview' })
    await ui.unmount()
  }
})

test('the empty Timeline tab says what will appear', async ($, on) => {
  mock.clock(on, { now: NOW })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'tab-timeline' })
    expect((await ui.find({ type: 'Text', text: /^Nothing yet/ }))?.text).toBe('Nothing yet. Each turn that uses tools adds a summary here.')
    await ui.press({ key: 'tab-overview' })
    await ui.unmount()
  }
})

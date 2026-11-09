import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { RenderInput } from 'claude-code'

import { badge, closingWord, CLOSING_WORDS, spinnerWord } from '../hooks/features/transcript'
import { C } from '../hooks/ui/theme'

const ALL = ['terminal', 'desktop', 'vscode', 'mobile'] as const
// Spinner is raised on the terminal, desktop and vscode; TurnDuration on the terminal alone.
const SPINNER_SURFACES = ['terminal', 'desktop', 'vscode'] as const

type On = Parameters<TestBody>[1]

/**
 * A stub engine beneath the plugin: each component draws one Text naming it,
 * built from the props it was handed, so a test sees both that the engine's
 * row is still there and what props reached it.
 */
const engine = (on: On) =>
  on('ui.render', ($, e: RenderInput) => {
    const { Text } = $.ui.resolve(e)
    if (e.component === 'Spinner') return <Text>{`${e.props.message ?? e.props.word}${e.props.suffix} (12s · 300 tokens)`}</Text>
    if (e.component === 'TurnDuration') return <Text>{`${e.props.word} for ${Math.round(e.props.durationMs / 1000)}s`}</Text>
    if (e.component === 'UserMessage' || e.component === 'AssistantMessage') return <Text>{`engine ${e.component}: ${e.props.text}`}</Text>
    return <Text>{`engine ${e.component}`}</Text>
  })

const TOOL = { tool_use_id: 'u1', isRunning: false, isErrored: false, isInterrupted: false } as const

const tool = (t: string, input: unknown, more: Partial<{ isRunning: boolean; isErrored: boolean; isInterrupted: boolean; isExpanded: boolean }> = {}) => ({
  ...TOOL,
  tool: t,
  input,
  ...more,
})

// ---------- ToolUse ----------

test('tool rows keep the engine row and gain an icon and tag line, on every surface', async ($, on) => {
  engine(on)
  const cases: [string, unknown, string][] = [
    ['Edit', { file_path: '/x/src/app.ts', old_string: 'a', new_string: 'b' }, 'EDIT · app.ts'],
    ['Write', { file_path: '/x/notes.md', content: '' }, 'WRITE · notes.md'],
    ['Read', { file_path: '/x/README.md' }, 'READ · README.md'],
    ['Bash', { command: 'npx vitest run' }, 'TEST'],
    ['Bash', { command: 'npm run build' }, 'BUILD'],
    ['WebFetch', { url: 'https://example.com', prompt: 'p' }, 'WEB'],
    ['Agent', { description: 'd', prompt: 'p', subagent_type: 'general-purpose' }, 'AGENT'],
    ['Bash', { command: 'ls -la' }, 'RUN'],
    ['Bash', { command: 'git commit -m x' }, 'COMMIT'],
    ['Bash', { command: 'git push origin feat' }, 'PUSH'],
  ]
  for (const surface of ALL) {
    for (const [t, input, label] of cases) {
      const ui = await $.ui.mount({ plugin: 'atlas-hud', component: 'ToolUse', requestId: 'u1', props: tool(t, input), surface })
      const drawn = await ui.drawn()
      expect(drawn.type).toBe('Box')
      expect((await ui.find({ type: 'Text', text: /^engine ToolUse$/ }))?.text).toBe('engine ToolUse')
      expect((await ui.find({ type: 'Text', text: label }))?.text).toBe(label)
      // The icon sits beside the tag: a glyph Text on the terminal, whatever <Icon> draws elsewhere.
      const tagRow = (await ui.findAll({ type: 'Box' })).find(b => b.props.flexDirection === 'row')
      expect(tagRow?.children.length).toBe(2)
      await ui.unmount()
    }
  }
})

test('a failed call says FAILED in the danger colour; an interrupted one does not', async ($, on) => {
  engine(on)
  for (const surface of ALL) {
    const failed = await $.ui.mount({
      plugin: 'atlas-hud',
      component: 'ToolUse',
      props: tool('Bash', { command: 'npx vitest run' }, { isErrored: true }),
      surface,
    })
    const tag = await failed.find({ type: 'Text', text: 'TEST FAILED' })
    expect(tag?.text).toBe('TEST FAILED')
    expect(tag?.props.color).toBe('#e06070')
    await failed.unmount()

    const stopped = await $.ui.mount({
      plugin: 'atlas-hud',
      component: 'ToolUse',
      props: tool('Bash', { command: 'npx vitest run' }, { isErrored: true, isInterrupted: true }),
      surface,
    })
    expect(await stopped.find({ type: 'Text', text: /FAILED/ })).toBe(undefined)
    expect((await stopped.find({ type: 'Text', text: 'TEST' }))?.text).toBe('TEST')
    await stopped.unmount()
  }
})

test('tool rows pass through when expanded, and for tools with no tag', async ($, on) => {
  engine(on)
  for (const surface of ALL) {
    for (const props of [tool('Edit', { file_path: '/x/a.ts' }, { isExpanded: true }), tool('Grep', { pattern: 'x' })]) {
      const ui = await $.ui.mount({ plugin: 'atlas-hud', component: 'ToolUse', props, surface })
      const drawn = await ui.drawn()
      expect(drawn.type).toBe('Text')
      expect((await ui.find({ type: 'Text' }))?.text).toBe('engine ToolUse')
      await ui.unmount()
    }
  }
})

test('tags come from the classify kinds', async () => {
  expect(badge('Bash', { command: 'claude plugin validate .' })?.label).toBe('CHECK')
  expect(badge('Bash', { command: 'npm install' })?.label).toBe('INSTALL')
  expect(badge('Bash', { command: 'git status' })?.label).toBe('GIT')
  expect(badge('NotebookEdit', { notebook_path: '/x/a.ipynb' })?.label).toBe('EDIT · a.ipynb')
  expect(badge('Glob', { pattern: '*' })).toBe(undefined)
})

// ---------- Spinner ----------

test('the spinner says Atlas words by mode, keeping the suffix and the timer', async ($, on) => {
  engine(on)
  const modes = [
    ['thinking', 'Charting course'],
    ['requesting', 'Scanning the stars'],
    ['tool-input', 'Plotting'],
    ['tool-use', 'Plotting'],
    ['responding', 'Transmitting'],
  ] as const
  for (const [mode, word] of modes) {
    const ui = await $.ui.mount({
      plugin: 'atlas-hud',
      component: 'Spinner',
      props: { word: 'Sauteing', message: null, suffix: '…', mode },
      surface: 'terminal',
    })
    expect((await ui.find({ type: 'Text' }))?.text).toBe(`${word}… (12s · 300 tokens)`)
    await ui.unmount()
  }
})

test('the spinner keeps a desktop step name and an overriding message; vscode gets the Atlas word', async ($, on) => {
  engine(on)
  for (const surface of SPINNER_SURFACES) {
    const working = await $.ui.mount({
      plugin: 'atlas-hud',
      component: 'Spinner',
      props: { word: 'Working', message: null, suffix: '…', mode: 'thinking' },
      surface,
    })
    expect((await working.find({ type: 'Text' }))?.text).toBe('Charting course… (12s · 300 tokens)')
    await working.unmount()

    const msg = await $.ui.mount({
      plugin: 'atlas-hud',
      component: 'Spinner',
      props: { word: 'Sauteing', message: 'Compacting conversation', suffix: '…', mode: 'requesting' },
      surface,
    })
    expect((await msg.find({ type: 'Text' }))?.text).toBe('Compacting conversation… (12s · 300 tokens)')
    await msg.unmount()
  }
  const step = await $.ui.mount({
    plugin: 'atlas-hud',
    component: 'Spinner',
    props: { word: 'Creating notes.md', message: null, suffix: '…', mode: 'tool-use' },
    surface: 'desktop',
  })
  expect((await step.find({ type: 'Text' }))?.text).toBe('Creating notes.md… (12s · 300 tokens)')
  await step.unmount()
  // vscode sends a sampled word like the terminal, so it gets the Atlas word.
  const vs = await $.ui.mount({
    plugin: 'atlas-hud',
    component: 'Spinner',
    props: { word: 'Sauteing', message: null, suffix: '…', mode: 'tool-use' },
    surface: 'vscode',
  })
  expect((await vs.find({ type: 'Text' }))?.text).toBe('Plotting… (12s · 300 tokens)')
  await vs.unmount()
  expect(spinnerWord('terminal', 'Sauteing', 'responding')).toBe('Transmitting')
  expect(spinnerWord('vscode', 'Sauteing', 'responding')).toBe('Transmitting')
  expect(spinnerWord('desktop', 'Reading a.ts', 'tool-use')).toBe(undefined)
})

// ---------- TurnDuration ----------

test('the closing line gets an Atlas word and mark on the terminal', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({
    plugin: 'atlas-hud',
    component: 'TurnDuration',
    requestId: 'turn-7',
    props: { word: 'Baked', durationMs: 3000 },
    surface: 'terminal',
  })
  const word = closingWord('turn-7')
  expect(CLOSING_WORDS.includes(word)).toBe(true)
  expect((await ui.drawn()).type).toBe('Box')
  expect((await ui.find({ type: 'Text', text: / for 3s$/ }))?.text).toBe(`${word} for 3s`)
  expect(closingWord('turn-7')).toBe(word)
  await ui.unmount()
})

test('the closing line passes through when expanded or waiting on agents', async ($, on) => {
  engine(on)
  const props = [
    { word: 'Baked', durationMs: 3000, isExpanded: true },
    { word: 'Baked', durationMs: 3000, waitingFor: { agents: [{ id: 'a1', agentType: 'general-purpose' }], workflows: 0 } },
  ]
  for (const p of props) {
    const ui = await $.ui.mount({ plugin: 'atlas-hud', component: 'TurnDuration', props: p, surface: 'terminal' })
    const drawn = await ui.drawn()
    expect(drawn.type).toBe('Text')
    expect((await ui.find({ type: 'Text' }))?.text).toBe('Baked for 3s')
    await ui.unmount()
  }
})

// ---------- UserMessage and AssistantMessage ----------

const PROMPT = 'Fix the build.\n\n```ts\nconst a = 1\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |'

test("the person's prompt is framed, its engine row kept unchanged, on every surface", async ($, on) => {
  engine(on)
  for (const surface of ALL) {
    for (const kind of ['composer', 'bridge'] as const) {
      const ui = await $.ui.mount({
        plugin: 'atlas-hud',
        component: 'UserMessage',
        props: { text: PROMPT, origin: { kind }, isExpanded: false },
        surface,
      })
      expect((await ui.drawn()).type).toBe('Box')
      expect((await ui.find({ type: 'Text', text: 'YOU' }))?.text).toBe('YOU')
      expect((await ui.find({ type: 'Text', text: /^─+$/ }))?.props.color).toBe(C.gold)
      expect((await ui.find({ type: 'Text', text: /^engine UserMessage/ }))?.text).toBe(`engine UserMessage: ${PROMPT}`)
      await ui.unmount()
    }
  }
})

test('other user rows, and expanded ones, pass through', async ($, on) => {
  engine(on)
  for (const surface of ALL) {
    for (const props of [
      { text: 'hi', origin: { kind: 'composer' as const }, isExpanded: true },
      { text: 'task done', origin: { kind: 'task-notification' as const }, isExpanded: false },
      { text: 'hello', origin: { kind: 'peer' as const }, isExpanded: false },
    ]) {
      const ui = await $.ui.mount({ plugin: 'atlas-hud', component: 'UserMessage', props, surface })
      const drawn = await ui.drawn()
      expect(drawn.type).toBe('Text')
      expect((await ui.find({ type: 'Text' }))?.text).toBe(`engine UserMessage: ${props.text}`)
      await ui.unmount()
    }
  }
})

test("a reply's first block is framed with the Atlas label, its engine row kept unchanged", async ($, on) => {
  engine(on)
  for (const surface of ALL) {
    const ui = await $.ui.mount({
      plugin: 'atlas-hud',
      component: 'AssistantMessage',
      props: { text: PROMPT, isFirstOfReply: true },
      surface,
    })
    expect((await ui.drawn()).type).toBe('Box')
    expect((await ui.find({ type: 'Text', text: 'ATLAS' }))?.text).toBe('ATLAS')
    expect((await ui.find({ type: 'Text', text: /^─+$/ }))?.props.color).toBe(C.teal)
    expect((await ui.find({ type: 'Text', text: /^engine AssistantMessage/ }))?.text).toBe(`engine AssistantMessage: ${PROMPT}`)
    await ui.unmount()
  }
})

test('later blocks of a reply and summary blocks pass through', async ($, on) => {
  engine(on)
  for (const surface of ALL) {
    for (const props of [
      { text: 'more', isFirstOfReply: false },
      { text: 'summary', isFirstOfReply: true, isSummary: true as const },
    ]) {
      const ui = await $.ui.mount({ plugin: 'atlas-hud', component: 'AssistantMessage', props, surface })
      const drawn = await ui.drawn()
      expect(drawn.type).toBe('Text')
      expect((await ui.find({ type: 'Text' }))?.text).toBe(`engine AssistantMessage: ${props.text}`)
      await ui.unmount()
    }
  }
})

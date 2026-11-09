import { expect, mock, test } from 'claude-code/testing'

import type { IconName } from '../hooks/ui/icons'
import { ICONS, Icon, iconAlt, iconGlyph, iconSource } from '../hooks/ui/icons'
import { ART } from '../hooks/ui/icons/art'
import type { Els } from '../hooks/ui/kit'
import { C } from '../hooks/ui/theme'

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const
const SVG_SURFACES = ['desktop', 'vscode', 'mobile'] as const

// A pane no hook of the mod draws: the test's own hook beneath draws icons in it.
const SHEET = {
  plugin: 'atlas-hud',
  component: 'Pane',
  requestId: 'icon-sheet',
  props: {
    title: 'Icons',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

// The names as the set first shipped them, in order: add after them, never rename or remove.
const FIRST = [
  'atlas', 'overview', 'work', 'agents', 'timeline', 'limit', 'context', 'cost', 'git', 'branch', 'commit', 'push',
  'dirty', 'clean', 'check', 'warning', 'error', 'task-pending', 'task-active', 'task-done', 'decision', 'keep', 'drop',
  'agent', 'agent-running', 'agent-waiting', 'agent-done', 'agent-failed', 'file', 'edit', 'write', 'read', 'test',
  'build', 'web', 'terminal', 'clock', 'spark',
]

test('the names keep their order; new ones only follow them', async () => {
  expect(ICONS.slice(0, FIRST.length)).toEqual(FIRST)
  expect(new Set(ICONS).size).toBe(ICONS.length)
})

test('every name draws on every surface, with its alt text', async ($, on) => {
  on('ui.render', ($, e) => {
    const el = $.ui.resolve(e) as unknown as Els
    return (
      <el.Box flexDirection="column">
        {ICONS.map(name => (
          <el.Box flexDirection="row" gap={1}>
            <Icon el={el} surface={e.surface} name={name} />
            <el.Text>{name}</el.Text>
          </el.Box>
        ))}
      </el.Box>
    )
  })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...SHEET, surface })
    if (surface === 'terminal') {
      expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
      // Each row is the icon's Text, then its name's: check every icon by position, since glyphs repeat.
      const texts = await ui.findAll({ type: 'Text' })
      expect(texts).toHaveLength(ICONS.length * 2)
      ICONS.forEach((name, i) => {
        const glyph = texts[i * 2]
        expect(texts[i * 2 + 1]?.text).toBe(name)
        expect(glyph?.text).toBe(iconGlyph(name))
        expect(glyph?.props.color).toBe(ART[name].color)
      })
    } else {
      const svgs = await ui.findAll({ type: 'Svg' })
      expect(svgs).toHaveLength(ICONS.length)
      svgs.forEach((svg, i) => {
        const name = ICONS[i] as IconName
        expect(svg.props.alt).toBe(iconAlt(name))
        expect(svg.props.width).toBe(16)
        expect(svg.props.height).toBe(16)
        expect(svg.props.isInteractive).toBe(undefined)
        expect(String(svg.props.source)).toBe(iconSource(name))
      })
    }
    await ui.unmount()
  }
})

test('a live icon is an interactive Svg; a still one is a plain image', async ($, on) => {
  on('ui.render', ($, e) => {
    const el = $.ui.resolve(e) as unknown as Els
    return (
      <el.Box flexDirection="row" gap={1}>
        <Icon el={el} surface={e.surface} name="agent-running" isLive />
        <Icon el={el} surface={e.surface} name="agent-done" />
      </el.Box>
    )
  })

  for (const surface of SVG_SURFACES) {
    const ui = await $.ui.mount({ ...SHEET, surface })
    const [running, done] = await ui.findAll({ type: 'Svg' })
    expect(running?.props.isInteractive).toBe(true)
    expect(String(running?.props.source)).toContain('<animateTransform')
    expect(done?.props.isInteractive).toBe(undefined)
    expect(String(done?.props.source)).not.toContain('<animate')
    await ui.unmount()
  }
})

test('size, colour and alt reach the drawing', async ($, on) => {
  on('ui.render', ($, e) => {
    const el = $.ui.resolve(e) as unknown as Els
    return (
      <el.Box flexDirection="row" gap={1}>
        <Icon el={el} surface={e.surface} name="atlas" size={18} color={C.gold} alt="Atlas HUD" />
        <Icon el={el} surface={e.surface} name="warning" />
      </el.Box>
    )
  })

  const desk = await $.ui.mount({ ...SHEET, surface: 'desktop' })
  const [atlas, warning] = await desk.findAll({ type: 'Svg' })
  expect(atlas?.props.width).toBe(18)
  expect(atlas?.props.height).toBe(18)
  expect(atlas?.props.alt).toBe('Atlas HUD')
  expect(String(atlas?.props.source)).toContain(`stroke="${C.gold}"`)
  expect(String(atlas?.props.source)).toContain('width="18" height="18"')
  expect(warning?.props.alt).toBe('Warning')
  await desk.unmount()

  const term = await $.ui.mount({ ...SHEET, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: iconGlyph('atlas') }))?.props.color).toBe(C.gold)
  expect((await term.find({ type: 'Text', text: iconGlyph('warning') }))?.props.color).toBe(C.warn)
  await term.unmount()
})

test('every source is small, script-free and well formed, still or live', async () => {
  const ANIMATIONS = new Set(['animate', 'animateTransform', 'animateMotion'])
  for (const name of ICONS) {
    for (const isLive of [false, true]) {
      const src = iconSource(name, { isLive })
      expect(src.length < 131072).toBe(true)
      expect(src.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"')).toBe(true)
      expect(src.endsWith('</svg>')).toBe(true)
      expect(/<script/i.test(src)).toBe(false)
      expect(/\son[a-z]+\s*=/i.test(src)).toBe(false)
      expect(/javascript:|href=|<foreignObject|<image/i.test(src)).toBe(false)
      // The pen: outlines at 1.5, fine detail no thinner than 1, marks no bolder than 1.8.
      expect(src).toContain('stroke-width="1.5"')
      for (const w of src.matchAll(/stroke-width="([\d.]+)"/g)) {
        const width = Number(w[1])
        if (width < 1 || width > 1.8) throw new Error(`${name}: stroke-width ${width}`)
      }
      expect(src).toContain('stroke-linejoin="round"')

      // Each tag well formed: no attribute twice, every open tag closed.
      const stack: string[] = []
      for (const m of src.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
        const [, close, tag = '', attrs = '', self] = m
        const names = [...attrs.matchAll(/([a-zA-Z-:]+)="[^"]*"/g)].map(a => a[1])
        if (new Set(names).size !== names.length) throw new Error(`${name}: an attribute twice in <${tag}${attrs}>`)
        if (ANIMATIONS.has(tag) && !isLive) throw new Error(`${name}: a still icon animates`)
        if (close) {
          if (stack.pop() !== tag) throw new Error(`${name}: </${tag}> closes nothing`)
        } else if (!self) stack.push(tag)
      }
      expect(stack).toEqual([])
      if (isLive) expect(/<animate(Transform|Motion)?\s/.test(src)).toBe(true)
    }
  }
})

test('the live drawings do what the spec says', async () => {
  // agent-running spins its orbit, spark twinkles, check draws its stroke, warning pulses.
  expect(iconSource('agent-running', { isLive: true })).toContain('type="rotate"')
  expect(iconSource('spark', { isLive: true })).toContain('attributeName="opacity"')
  expect(iconSource('check', { isLive: true })).toContain('attributeName="stroke-dashoffset"')
  expect(iconSource('warning', { isLive: true })).toContain('attributeName="fill-opacity"')
})

test('the terminal glyphs are one code point, never an emoji', async () => {
  for (const name of ICONS) {
    const cells = [iconGlyph(name), iconGlyph(name, true, 0), iconGlyph(name, true, 1), iconGlyph(name, true, 7)]
    for (const g of cells) {
      expect([...g]).toHaveLength(1)
      expect(/\p{Extended_Pictographic}|\p{Emoji_Presentation}|️/u.test(g)).toBe(false)
    }
  }
  // A live glyph without a frame stays still; with one it cycles.
  expect(iconGlyph('agent-running', true)).toBe(iconGlyph('agent-running'))
  expect(iconGlyph('agent-running', true, 1)).not.toBe(iconGlyph('agent-running', true, 0))
  expect(iconGlyph('agent-running', true, 4)).toBe(iconGlyph('agent-running', true, 0))
  // A name this build does not know (stored by a newer one) still draws, as a spark.
  expect(iconGlyph('comet' as IconName)).toBe(iconGlyph('spark'))
  expect(iconSource('comet' as IconName)).toBe(iconSource('spark'))
})

test('a live terminal glyph follows the frame it is passed', async ($, on) => {
  on('ui.render', ($, e) => {
    const el = $.ui.resolve(e) as unknown as Els
    return (
      <el.Box flexDirection="row" gap={1}>
        <Icon el={el} surface={e.surface} name="agent-running" isLive frame={1} />
        <Icon el={el} surface={e.surface} name="clock" frame={1} />
      </el.Box>
    )
  })
  const ui = await $.ui.mount({ ...SHEET, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: iconGlyph('agent-running', true, 1) })).toBeDefined()
  expect(iconGlyph('agent-running', true, 1)).not.toBe(iconGlyph('agent-running'))
  // Not live: the frame is ignored.
  expect(await ui.find({ type: 'Text', text: iconGlyph('clock') })).toBeDefined()
  await ui.unmount()
})

test('the terminal frame steps only while a turn runs, a subagent included', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'hud' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  // Every write of the frame, as the host receives it: a write is a redraw of its readers.
  const writes: unknown[] = []
  on('state.set', { plugin: 'atlas-hud', key: 'iconFrame' }, (_, e, next) => {
    writes.push(e.value)
    return next(e)
  })
  const frame = async () => writes.length

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  // Nothing live: the frame never moves.
  await clock.advance(5000)
  expect(await frame()).toBe(0)

  // A turn runs: it steps every half second.
  await $.turn.start({ text: 'go', turnId: 'main-1' })
  await clock.advance(500)
  expect(await frame()).toBe(1)

  // A subagent starts; the main turn ends: still live.
  await $.turn.start({ text: 'look', turnId: 'sub-1', agentId: 'a1' })
  await $.turn.complete({ answer: 'Started a helper.', durationMs: 900, isAborted: false, turnId: 'main-1', reason: 'answer' })
  await clock.advance(1000)
  expect(await frame()).toBe(3)

  // The subagent ends: the ticker stops and the frame stays put.
  await $.turn.complete({ answer: 'Found it.', durationMs: 1500, isAborted: false, turnId: 'sub-1', agentId: 'a1', reason: 'answer' })
  await clock.advance(5000)
  expect(await frame()).toBe(3)

  // An interrupted turn ends the motion too.
  await $.turn.start({ text: 'again', turnId: 'main-2' })
  await clock.advance(500)
  await $.turn.complete({ answer: '', durationMs: 400, isAborted: true, turnId: 'main-2', reason: 'aborted' })
  await clock.advance(5000)
  expect(await frame()).toBe(4)
  // Each write stepped the counter on from the stored one.
  expect(writes).toEqual([1, 2, 3, 4])
})

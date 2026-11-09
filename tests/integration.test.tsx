// Cases that cross features: the band above the prompt with both of its parts
// pending, and a running tool row on every surface.
import { expect, mock, test } from 'claude-code/testing'
import type { On, RenderInput } from 'claude-code'

const NOW = Date.parse('2026-11-05T12:00:00Z')

const ALL = ['terminal', 'desktop', 'vscode', 'mobile'] as const
// The band above the prompt is raised on these two only.
const BAND_SURFACES = ['terminal', 'desktop'] as const

const BAND = {
  plugin: 'atlas-hud',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 100, scroll: { offset: 0, bodyRows: 8 }, view: {} },
} as const

/** A stub engine beneath the plugin: each component draws one Text naming it; git finds no repository. */
const engine = (on: On) => {
  mock.clock(on, { now: NOW })
  on('ui.toast', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: '/work/repo' }))
  on('process.run', () => ({
    value: { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: { type: 'update' } }))
  on('ui.render', ($, e: RenderInput) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`engine ${e.component}`}</Text>
  })
}

test('a done-check and a proposed decision both pending: the two bands stack', async ($, on) => {
  engine(on)
  for (const surface of BAND_SURFACES) {
    const id = `both-${surface}`
    // One turn edits, says done without a check, and proposes a decision.
    await $.turn.start({ text: 'fix it', turnId: id })
    await $.tool.call({ tool: 'Edit', file_path: '/work/repo/a.css', old_string: 'a', new_string: 'b' })
    await $.turn.complete({
      answer: `Fixed, all done.\n<!-- decision: no inline styles on ${surface} -->`,
      durationMs: 4000,
      isAborted: false,
      turnId: id,
      reason: 'answer',
    })

    const band = await $.ui.mount({ ...BAND, surface })
    const texts = (await band.findAll({ type: 'Text' })).map(t => t.text)
    const check = texts.indexOf('DONE CHECK')
    const decision = texts.indexOf('DECISION')
    // Both show, the done-check above the decision, and the engine's own band gives way.
    expect(check >= 0).toBe(true)
    expect(decision > check).toBe(true)
    expect(texts.includes(`no inline styles on ${surface}`)).toBe(true)
    expect(texts.includes('engine AbovePrompt')).toBe(false)
    expect((await band.find({ type: 'Button', key: `done-dismiss-${id}` }))?.text).toBe('Dismiss')
    expect(String((await band.find({ type: 'Button', text: 'Keep' }))?.key).startsWith('band-keep-')).toBe(true)

    // Each clears on its own: Dismiss leaves the decision; Keep then hands back to the engine.
    await band.press({ key: `done-dismiss-${id}` })
    expect(await band.find({ type: 'Text', text: /DONE CHECK/ })).toBe(undefined)
    expect((await band.find({ type: 'Text', text: /^DECISION$/ }))?.text).toBe('DECISION')
    await band.press({ key: String((await band.find({ type: 'Button', text: 'Keep' }))?.key) })
    expect((await band.find({ type: 'Text', text: /^engine AbovePrompt$/ }))?.text).toBe('engine AbovePrompt')
    await band.unmount()
  }
})

test('a running tool row keeps the engine row; its icon is live, an interactive Svg off the terminal', async ($, on) => {
  engine(on)
  for (const surface of ALL) {
    const ui = await $.ui.mount({
      plugin: 'atlas-hud',
      component: 'ToolUse',
      requestId: 'u1',
      props: { tool_use_id: 'u1', tool: 'Bash', input: { command: 'npx vitest run' }, isRunning: true, isErrored: false, isInterrupted: false },
      surface,
    })
    expect((await ui.find({ type: 'Text', text: /^engine ToolUse$/ }))?.text).toBe('engine ToolUse')
    expect((await ui.find({ type: 'Text', text: 'TEST' }))?.text).toBe('TEST')
    const svgs = await ui.findAll({ type: 'Svg' })
    if (surface === 'terminal') expect(svgs).toHaveLength(0)
    else {
      expect(svgs).toHaveLength(1)
      expect(svgs[0]?.props.isInteractive).toBe(true)
    }
    await ui.unmount()
  }
})

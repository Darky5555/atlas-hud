// Timeline: what each turn did, in plain English, beneath the answer and in
// the pane.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderSurface, SessionStartInput, ToolCallInput, ToolCallResult, TurnCompleteInput, TurnStartInput } from 'claude-code'

import type { Step, Turn } from '../../types'
import { DONE_WORDS, classify, describe, duration, parseTests, summaryText, verdict } from '../lib'
import { C } from '../ui/theme'
import type { Els } from '../ui/kit'
import { str } from '../ui/kit'

export const turns = atom({ plugin: 'atlas-hud', key: 'turns' } as const, [] as Turn[], { shape: 'turns-1' })

type Acc = {
  edited: Set<string>
  created: Set<string>
  reads: number
  searches: number
  steps: Step[]
  tests?: { passed: number; failed: number }
  seq: number
  lastChange: number
  lastCheck: number
}

const freshAcc = (): Acc => ({
  edited: new Set(),
  created: new Set(),
  reads: 0,
  searches: 0,
  steps: [],
  seq: 0,
  lastChange: -1,
  lastCheck: -1,
})

// Module variables start over on a reload; that only loses the turn in flight.
let acc = freshAcc()

// ---------- The shared events, called from register.tsx (see hub.ts) ----------

export function timelineSessionStart(_$: EngineInterface, _e: SessionStartInput) {}

export function timelineToolStart(_$: EngineInterface, _e: ToolCallInput) {}

export function timelineTurnStart(_$: EngineInterface, e: TurnStartInput) {
  if (e.agentId === undefined) acc = freshAcc()
}

export function timelineToolEnd(_$: EngineInterface, e: ToolCallInput, ran: ToolCallResult) {
  const tool = String(e.tool)
  const input = e as unknown as Record<string, unknown>
  const ok = ran.deny === undefined && ran.isError !== true
  const result = (ran.deny === undefined ? ran.result : undefined) as Record<string, unknown> | undefined

  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') {
    const path = str(input.file_path) || str(input.notebook_path)
    if (ok && path) {
      const isNew = tool === 'Write' && (result?.type === 'create' || !acc.edited.has(path)) && result?.type !== 'update'
      if (isNew && !acc.edited.has(path)) acc.created.add(path)
      else if (!acc.created.has(path)) acc.edited.add(path)
      acc.lastChange = ++acc.seq
    }
  } else if (tool === 'Read' || tool === 'Grep' || tool === 'Glob') {
    acc.reads += 1
  } else if (tool === 'WebSearch' || tool === 'WebFetch') {
    acc.searches += 1
  } else if (tool === 'Bash') {
    const command = str(input.command)
    const kind = classify(command)
    acc.steps.push({ kind, label: command.slice(0, 120), ok })
    if (kind === 'test') {
      const parsed = parseTests(`${str(result?.stdout)}\n${str(result?.stderr)}${ran.isError ? str(ran.text) : ''}`)
      if (parsed) acc.tests = parsed
    }
    if ((kind === 'test' || kind === 'build' || kind === 'check') && ok) acc.lastCheck = ++acc.seq
  }
}

// The summary returned here is drawn beneath the answer.
export async function timelineTurnComplete($: EngineInterface, e: TurnCompleteInput): Promise<string | undefined> {
  if (e.agentId !== undefined) return undefined
  const now = await $.clock.now()
  let card: string | undefined
  const didWork = acc.seq > 0 || acc.steps.length > 0 || acc.reads > 0 || acc.searches > 0
  if (didWork && !e.isAborted) {
    const draft = {
      id: e.turnId,
      at: now,
      durationMs: e.durationMs,
      edited: [...acc.edited],
      created: [...acc.created],
      reads: acc.reads,
      searches: acc.searches,
      steps: acc.steps,
      tests: acc.tests,
      isVerified: acc.lastCheck > acc.lastChange && acc.lastChange >= 0,
      claimsDone: DONE_WORDS.test(e.answer.slice(-1500)),
    }
    const turn: Turn = { ...draft, lines: describe(draft) }
    await update($, turns, l => [...l.filter(t => t.id !== turn.id), turn].slice(-30))
    card = summaryText(turn)
    if (e.durationMs > 15_000) $.ui.toast(`Done · ${turn.lines[0] ?? 'turn finished'}`)
  } else if (!e.isAborted && e.durationMs > 15_000) {
    $.ui.toast('Done')
  }
  acc = freshAcc()
  return card
}

const TurnBody = ({ el, turn }: { el: Els; turn: Turn }) => {
  const v = verdict(turn)
  return (
    <el.Box flexDirection="column">
      {turn.lines.map(line => (
        <el.Text color={C.text}>{line}</el.Text>
      ))}
      {v && (
        <el.Text color={v.tone === 'ok' ? C.green : v.tone === 'warn' ? C.gold : C.text2} dimColor={v.tone === 'dim'}>
          {v.tone === 'ok' ? '✓ ' : v.tone === 'warn' ? '! ' : '· '}
          {v.text}
        </el.Text>
      )}
    </el.Box>
  )
}

/** The Timeline tab: the latest turns, newest first. */
export async function timelineView($: EngineInterface, el: Els, _surface: RenderSurface) {
  const list = (await read($, turns)).slice(-10).reverse()
  if (!list.length) return <el.Text color={C.text2}>Nothing yet. Each turn that uses tools adds a summary here.</el.Text>
  return (
    <el.Box flexDirection="column" gap={1}>
      {list.map(t => (
        <el.Box flexDirection="column" borderStyle="round" borderColor={C.line} paddingX={1}>
          <el.Text mono size="caption" color={C.teal}>
            {new Date(t.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · {duration(t.durationMs)}
          </el.Text>
          <TurnBody el={el} turn={t} />
        </el.Box>
      ))}
    </el.Box>
  )
}

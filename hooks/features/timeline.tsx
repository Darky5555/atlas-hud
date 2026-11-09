// Timeline: what each turn did, in plain English, beneath the answer and in
// the pane.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderSurface, SessionStartInput, ToolCallInput, ToolCallResult, TurnCompleteInput, TurnStartInput } from 'claude-code'

import type { Step, Turn } from '../../types'
import { DONE_WORDS, classify, describe, parseTests, summaryText, turnDuration, verdict } from '../lib'
import { Icon } from '../ui/icons'
import type { Els } from '../ui/kit'
import { Section, canSvg, str } from '../ui/kit'
import { C } from '../ui/theme'
import {
  CHART_TURNS,
  chartSvg,
  compact,
  filesTouched,
  shortPath,
  sparkline,
  stepIcons,
  tokenSeries,
  tokenStats,
  tokenTotal,
  tokensOf,
  toolCount,
} from './timeline-lib'

export const turns = atom({ plugin: 'atlas-hud', key: 'turns' } as const, [] as Turn[], { shape: 'turns-1' })

type Acc = {
  edited: Set<string>
  created: Set<string>
  reads: number
  searches: number
  steps: Step[]
  tests?: { passed: number; failed: number }
  tools: Record<string, number>
  fileEdits: Record<string, number>
  seq: number
  lastChange: number
  lastCheck: number
}

// Tool names kept per turn; past this the rest count under "other".
const MAX_TOOL_NAMES = 40

const freshAcc = (): Acc => ({
  edited: new Set(),
  created: new Set(),
  reads: 0,
  searches: 0,
  steps: [],
  tools: {},
  fileEdits: {},
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

  const name = tool in acc.tools || Object.keys(acc.tools).length < MAX_TOOL_NAMES ? tool : 'other'
  acc.tools[name] = (acc.tools[name] ?? 0) + 1

  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') {
    const path = str(input.file_path) || str(input.notebook_path)
    if (ok && path) {
      const isNew = tool === 'Write' && (result?.type === 'create' || !acc.edited.has(path)) && result?.type !== 'update'
      if (isNew && !acc.edited.has(path)) acc.created.add(path)
      else if (!acc.created.has(path)) acc.edited.add(path)
      if (path in acc.fileEdits || Object.keys(acc.fileEdits).length < 200) acc.fileEdits[path] = (acc.fileEdits[path] ?? 0) + 1
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
    const tokens = tokensOf(e.usage)
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
      ...(tokens ? { tokens } : {}),
      tools: { ...acc.tools },
      fileEdits: { ...acc.fileEdits },
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

// ---------- The Timeline tab ----------

const TokenChart = ({ el, surface, list }: { el: Els; surface: RenderSurface; list: readonly Turn[] }) => {
  const series = tokenSeries(list)
  const stats = tokenStats(series)
  const right = (
    <el.Text size="caption" color={C.text3}>
      last {series.length} {series.length === 1 ? 'turn' : 'turns'}
    </el.Text>
  )
  if (!stats) {
    return (
      <Section el={el} surface={surface} icon="cost" title="Tokens" right={right}>
        <el.Text size="footnote" color={C.text2}>
          Token counts start with the next turn that uses tools.
        </el.Text>
      </Section>
    )
  }
  const summary = `min ${compact(stats.min)} · max ${compact(stats.max)} · total ${compact(stats.total)}`
  return (
    <Section el={el} surface={surface} icon="cost" title="Tokens" right={right}>
      {canSvg(el, surface) && el.Svg ? (
        <el.Svg source={chartSvg(series)} alt={`Tokens per turn over the last ${series.length} turns: ${summary}`} />
      ) : (
        <el.Text color={C.teal}>{sparkline(series)}</el.Text>
      )}
      <el.Text mono tabular size="footnote" color={C.text2}>
        {summary}
      </el.Text>
    </Section>
  )
}

const FilesTouched = ({ el, surface, list }: { el: Els; surface: RenderSurface; list: readonly Turn[] }) => {
  const rows = filesTouched(list)
  return (
    <Section el={el} surface={surface} icon="file" title="Files touched">
      {rows.length ? (
        rows.map(r => (
          <el.Box flexDirection="row" justifyContent="space-between" gap={1}>
            <el.Box flexDirection="row" gap={1}>
              <Icon el={el} surface={surface} name={r.isCreated ? 'write' : 'edit'} color={r.isCreated ? C.gold : C.teal} />
              <el.Text color={C.text} wrap="truncate-start">
                {shortPath(r.path)}
              </el.Text>
            </el.Box>
            <el.Text mono tabular color={C.text2}>
              {r.count === 1 ? '1 edit' : `${r.count} edits`}
            </el.Text>
          </el.Box>
        ))
      ) : (
        <el.Text size="footnote" color={C.text2}>
          No files changed yet.
        </el.Text>
      )}
    </Section>
  )
}

const VERDICT_ICON = { ok: 'check', warn: 'warning', dim: 'task-pending' } as const
const VERDICT_COLOR = { ok: C.green, warn: C.gold, dim: C.text2 } as const

const TurnCard = ({ el, surface, turn }: { el: Els; surface: RenderSurface; turn: Turn }) => {
  const v = verdict(turn)
  const tools = toolCount(turn)
  const tokens = tokenTotal(turn.tokens)
  const head = [
    new Date(turn.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    turnDuration(turn.durationMs),
    ...(tools !== undefined ? [tools === 1 ? '1 tool' : `${tools} tools`] : []),
    ...(tokens !== undefined ? [`${compact(tokens)} tokens`] : []),
  ].join(' · ')
  const icons = stepIcons(turn)
  return (
    <el.Box flexDirection="column" gap={0} borderStyle="round" borderColor={v?.tone === 'warn' ? C.gold : C.line} backgroundColor={C.panel} paddingX={1}>
      <el.Box flexDirection="row" gap={1}>
        <Icon el={el} surface={surface} name="clock" color={C.teal} />
        <el.Text mono tabular size="caption" color={C.teal}>
          {head}
        </el.Text>
      </el.Box>
      {icons.length > 0 && (
        <el.Box flexDirection="row" gap={1}>
          {icons.map(name => (
            <Icon el={el} surface={surface} name={name} color={C.text2} />
          ))}
        </el.Box>
      )}
      {turn.lines.map(line => (
        <el.Text color={C.text}>{line}</el.Text>
      ))}
      {v && (
        <el.Box flexDirection="row" gap={1}>
          <Icon el={el} surface={surface} name={VERDICT_ICON[v.tone]} color={VERDICT_COLOR[v.tone]} />
          <el.Text color={VERDICT_COLOR[v.tone]}>{v.text}</el.Text>
        </el.Box>
      )}
    </el.Box>
  )
}

/** The Timeline tab: tokens per turn, the files changed most, and the latest turns, newest first. */
export async function timelineView($: EngineInterface, el: Els, surface: RenderSurface) {
  const all = await read($, turns)
  if (!all.length) return <el.Text color={C.text2}>Nothing yet. Each turn that uses tools adds a summary here.</el.Text>
  const recent = all.slice(-10).reverse()
  return (
    <el.Box flexDirection="column" gap={1}>
      <TokenChart el={el} surface={surface} list={all.slice(-CHART_TURNS)} />
      <FilesTouched el={el} surface={surface} list={all} />
      <Section el={el} surface={surface} icon="timeline" title="Turns">
        <el.Box flexDirection="column" gap={1}>
          {recent.map(t => (
            <TurnCard el={el} surface={surface} turn={t} />
          ))}
        </el.Box>
      </Section>
    </el.Box>
  )
}

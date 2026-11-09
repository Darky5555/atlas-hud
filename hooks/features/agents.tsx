// Agents: the subagents and teammates this session runs, as a tree by who
// spawned whom, with what each is doing, how long, its tools, its tokens and
// the start of its last report.
//
// Fed by `agent.spawn` (hooked here alone: name, type, parent, the moment it
// started), the shared events with `agentId` (turns, tools, usage, reports)
// and `$.agent.list()` (the engine's own view, merged in at each turn's start
// and end). The engine drops an agent from its list soon after it ends, so the
// tab keeps its own record, bounded to the last 40.
import { atom, read, update } from 'claude-code'
import type {
  AgentInfo,
  AgentSpawnInput,
  AgentSpawnResult,
  EngineInterface,
  RenderSurface,
  SessionStartInput,
  ToolCallInput,
  ToolCallResult,
  TurnCompleteInput,
  TurnStartInput,
  TurnUsage,
} from 'claude-code'

import type { AgentRun, AgentRunStatus } from '../../types'
import { guard } from '../hub'
import type { IconName } from '../ui/icons'
import { Icon } from '../ui/icons'
import type { Els, On } from '../ui/kit'
import { Section } from '../ui/kit'
import { C } from '../ui/theme'

export const agents = atom({ plugin: 'atlas-hud', key: 'agents' } as const, [] as AgentRun[], { shape: 'agents-1' })

export const MAX_AGENTS = 40
const REPORT_LINES = 2
const REPORT_CHARS = 120

export const registerAgents = (on: On) => {
  // Only to learn of a spawn: the spawn itself is passed on unchanged, and a
  // failure here never reaches it.
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    await guard($, 'agents.spawn', () => agentsSpawned($, e, r))
    return r
  }).catch(($, e, next) => next(e))
}

// ---------- Pure helpers (no `$`; the tests call these directly) ----------

/** Elapsed time: "42s", "3m 05s", "1h 04m". */
export const elapsed = (ms: number) => {
  if (!Number.isFinite(ms) || ms < 0) return '0s'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** A token count: "860", "1.2k", "48k", "1.2M". */
export const tokenCount = (n: number) => {
  if (!Number.isFinite(n) || n < 1000) return String(Math.max(0, Math.round(Number.isFinite(n) ? n : 0)))
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** Every token a turn's requests counted: input, cache reads and writes, output. */
export const usageTokens = (u: TurnUsage | undefined) =>
  u ? (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) : 0

/** The first two non-empty lines of a report, each cut to a readable length. */
export const reportLines = (answer: string) =>
  answer
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .slice(0, REPORT_LINES)
    .map(l => (l.length > REPORT_CHARS ? `${l.slice(0, REPORT_CHARS - 1)}…` : l))

const isEnded = (s: AgentRunStatus) => s === 'completed' || s === 'failed' || s === 'killed'

export type AgentKind = 'running' | 'waiting' | 'done' | 'failed'

export const kindOf = (s: AgentRunStatus): AgentKind =>
  s === 'running' || s === 'pending' ? 'running' : s === 'completed' ? 'done' : s === 'failed' || s === 'killed' ? 'failed' : 'waiting'

export const counts = (list: readonly AgentRun[]) => {
  const c = { running: 0, waiting: 0, done: 0, failed: 0 }
  for (const a of list) c[kindOf(a.status)] += 1
  return c
}

/** Keeps at most `MAX_AGENTS`: the ones that changed longest ago give way, ended ones first. */
export const bound = (list: AgentRun[]) => {
  const out = [...list]
  while (out.length > MAX_AGENTS) {
    let drop = -1
    for (let i = 0; i < out.length; i++) if (isEnded(out[i]!.status) && (drop < 0 || out[i]!.at < out[drop]!.at)) drop = i
    if (drop < 0) for (let i = 0; i < out.length; i++) if (drop < 0 || out[i]!.at < out[drop]!.at) drop = i
    out.splice(drop, 1)
  }
  return out
}

/** The record without the keys named (state holds no `undefined`). */
const without = (a: AgentRun, ...keys: (keyof AgentRun)[]): AgentRun => {
  const out = { ...a }
  for (const k of keys) delete out[k]
  return out
}

/** Applies `fn` to the record for `id`, made fresh at `now` if there is none. */
export const upsert = (list: AgentRun[], id: string, now: number, fn: (a: AgentRun) => AgentRun) => {
  const i = list.findIndex(a => a.id === id)
  const before: AgentRun = i >= 0 ? list[i]! : { id, status: 'running', startedAt: now, tools: 0, tokens: 0, at: now }
  const after = { ...fn(before), at: now }
  return bound(i >= 0 ? list.map((a, j) => (j === i ? after : a)) : [...list, after])
}

const sameRecord = (x: AgentRun, y: AgentRun) =>
  x.name === y.name &&
  x.type === y.type &&
  x.description === y.description &&
  x.parentId === y.parentId &&
  x.isTeammate === y.isTeammate &&
  x.status === y.status &&
  x.endedAt === y.endedAt

/**
 * The list's status for an agent, unless the tab's own events say otherwise:
 * the list can lag a turn's start and end. An end the tab saw stands; a turn the
 * tab heard open is not undone by a lagging `idle` or `pending`, nor one it heard
 * close by a lagging `running`, `pending` or `waiting`. An end the list reports
 * still stands, and an agent whose turns the tab never heard follows the list.
 */
export const listStatus = (known: AgentRun | undefined, s: AgentRunStatus): AgentRunStatus => {
  if (!known) return s
  if (isEnded(known.status)) return known.status
  if (known.turnOpen === true && (s === 'idle' || s === 'pending')) return known.status
  if (known.turnOpen === false && !isEnded(s)) return known.status
  return s
}

/** Merges the engine's list: names, types and parents fill in; its status as `listStatus` lets it. */
export const mergeList = (list: AgentRun[], infos: readonly AgentInfo[], now: number) => {
  let out = list
  for (const info of infos) {
    if (!info || typeof info.id !== 'string') continue
    const known = out.find(a => a.id === info.id)
    const merged = (a: AgentRun): AgentRun => {
      const status = listStatus(known, info.status)
      const r: AgentRun = { ...a, status }
      if (info.name) r.name = info.name
      if (info.type) r.type = info.type
      if (info.description) r.description = info.description
      if (info.parentId) r.parentId = info.parentId
      if (info.teammateId !== undefined) r.isTeammate = true
      if (isEnded(status) && r.endedAt === undefined) r.endedAt = now
      return r
    }
    if (known && sameRecord(known, merged(known))) continue
    out = upsert(out, info.id, now, merged)
  }
  return out
}

/** The tree by parent: each agent once, with its depth; one whose parent is not kept is a root. */
export const treeOf = (list: readonly AgentRun[]) => {
  const ids = new Set(list.map(a => a.id))
  const kids = new Map<string, AgentRun[]>()
  const roots: AgentRun[] = []
  for (const a of list) {
    if (a.parentId && a.parentId !== a.id && ids.has(a.parentId)) kids.set(a.parentId, [...(kids.get(a.parentId) ?? []), a])
    else roots.push(a)
  }
  // Running ones first, then the newest; children in the order they started.
  const isRunning = (a: AgentRun) => Number(kindOf(a.status) === 'running')
  roots.sort((x, y) => isRunning(y) - isRunning(x) || y.startedAt - x.startedAt)
  const out: { agent: AgentRun; depth: number }[] = []
  const seen = new Set<string>()
  const walk = (a: AgentRun, depth: number) => {
    if (seen.has(a.id)) return
    seen.add(a.id)
    out.push({ agent: a, depth })
    for (const k of [...(kids.get(a.id) ?? [])].sort((x, y) => x.startedAt - y.startedAt)) walk(k, depth + 1)
  }
  for (const r of roots) walk(r, 0)
  // Agents whose parents form a loop are reached by no root: shown as roots.
  for (const a of list) walk(a, 0)
  return out
}

/** The icon for the tool an agent is running. */
export const toolIcon = (tool: string): IconName => {
  if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') return 'edit'
  if (tool === 'Write') return 'write'
  if (tool === 'Read' || tool === 'Glob' || tool === 'Grep' || tool === 'LS') return 'read'
  if (tool === 'Bash' || tool === 'BashOutput' || tool === 'PowerShell') return 'terminal'
  if (tool === 'WebFetch' || tool === 'WebSearch') return 'web'
  if (tool === 'Agent' || tool === 'Task') return 'agent'
  return 'spark'
}

const STATUS_ICON: Record<AgentKind, IconName> = {
  running: 'agent-running',
  waiting: 'agent-waiting',
  done: 'agent-done',
  failed: 'agent-failed',
}

const STATUS_COLOR: Record<AgentKind, string> = {
  running: C.teal,
  waiting: C.gold,
  done: C.ok,
  failed: C.bad,
}

const statusLabel = (s: AgentRunStatus) => (s === 'completed' ? 'done' : s === 'killed' ? 'stopped' : s === 'pending' ? 'starting' : s)

// ---------- Collecting ----------

async function nowMs($: EngineInterface) {
  try {
    return await $.clock.now()
  } catch {
    return Date.now()
  }
}

/** Merges `$.agent.list()` into the record; quiet when the engine has none to give. */
async function syncList($: EngineInterface) {
  let infos: AgentInfo[]
  try {
    infos = await $.agent.list()
  } catch {
    return
  }
  if (!Array.isArray(infos) || !infos.length) return
  const now = await nowMs($)
  await update($, agents, l => mergeList(l, infos, now))
}

/** A spawn the engine started: its name, type, task and parent, timed from now. */
export async function agentsSpawned($: EngineInterface, e: AgentSpawnInput, r: AgentSpawnResult) {
  const id = r.agentId
  if (!id) return
  const now = await nowMs($)
  await update($, agents, l =>
    upsert(l, id, now, a => {
      // A resumed run starts its clock again.
      const out: AgentRun = e.resume ? { ...without(a, 'endedAt', 'tool', 'turnOpen'), startedAt: now } : { ...a }
      out.status = 'running'
      if (e.name) out.name = e.name
      if (e.subagentType) out.type = e.subagentType
      if (e.description) out.description = e.description
      if (e.parentAgentId) out.parentId = e.parentAgentId
      if (e.isTeammate) out.isTeammate = true
      return out
    }),
  )
}

// ---------- The shared events, called from register.tsx (see hub.ts) ----------

export function agentsSessionStart(_$: EngineInterface, _e: SessionStartInput) {}

export async function agentsTurnStart($: EngineInterface, e: TurnStartInput) {
  const id = e.agentId
  if (id !== undefined) {
    const now = await nowMs($)
    await update($, agents, l =>
      upsert(l, id, now, a =>
        // An agent woken again (a teammate's next turn) times from here.
        a.endedAt !== undefined
          ? { ...without(a, 'endedAt', 'tool'), startedAt: now, status: 'running', turnOpen: true }
          : { ...a, status: 'running', turnOpen: true },
      ),
    )
  }
  await syncList($)
}

export async function agentsToolStart($: EngineInterface, e: ToolCallInput) {
  const id = e.agentId
  if (id === undefined) return
  const now = await nowMs($)
  const tool = String(e.tool)
  await update($, agents, l => upsert(l, id, now, a => ({ ...a, tool, tools: a.tools + 1 })))
}

export async function agentsToolEnd($: EngineInterface, e: ToolCallInput, _ran: ToolCallResult) {
  const id = e.agentId
  if (id === undefined) return
  const tool = String(e.tool)
  const now = await nowMs($)
  await update($, agents, l => (l.some(a => a.id === id && a.tool === tool) ? upsert(l, id, now, a => without(a, 'tool')) : l))
}

/** On the main loop, a string returned is shown beneath the answer; this feature shows none. */
export async function agentsTurnComplete($: EngineInterface, e: TurnCompleteInput): Promise<string | undefined> {
  const id = e.agentId
  if (id !== undefined) {
    const now = await nowMs($)
    const lines = reportLines(typeof e.answer === 'string' ? e.answer : '')
    const tokens = usageTokens(e.usage)
    await update($, agents, l =>
      upsert(l, id, now, a => ({
        ...without(a, 'tool'),
        tokens: a.tokens + tokens,
        ...(lines.length ? { report: lines } : {}),
        endedAt: now,
        turnOpen: false,
        status: e.reason === 'error' || e.reason === 'refusal' ? 'failed' : e.reason === 'aborted' ? 'killed' : a.isTeammate ? 'idle' : 'completed',
      })),
    )
  }
  await syncList($)
  return undefined
}

// ---------- Drawing ----------

const AgentRow = ({ el, surface, a, depth, now }: { el: Els; surface: RenderSurface; a: AgentRun; depth: number; now: number }) => {
  const kind = kindOf(a.status)
  const color = STATUS_COLOR[kind]
  const isLive = kind === 'running'
  const took = (isLive ? now : (a.endedAt ?? now)) - a.startedAt
  const stats = [elapsed(took), `${a.tools.toLocaleString('en-US')} ${a.tools === 1 ? 'tool' : 'tools'}`, `${tokenCount(a.tokens)} tok`].join(' · ')
  return (
    <el.Box flexDirection="column" gap={0} paddingLeft={depth * 2}>
      <el.Box flexDirection="row" gap={1} flexWrap="wrap">
        {depth > 0 && <el.Text color={C.line2}>└</el.Text>}
        <Icon el={el} surface={surface} name={STATUS_ICON[kind]} color={color} isLive={isLive} />
        <el.Text weight="semibold" color={C.violet}>
          {a.name ?? a.type ?? 'agent'}
        </el.Text>
        {a.name && a.type && <el.Text color={C.text3}>{a.type}</el.Text>}
        <el.Text mono size="caption" color={color}>
          {statusLabel(a.status).toUpperCase()}
        </el.Text>
        <el.Text mono tabular size="footnote" color={C.text2}>
          {stats}
        </el.Text>
      </el.Box>
      <el.Box flexDirection="column" gap={0} paddingLeft={2}>
        {a.description && <el.Text color={C.text}>{a.description}</el.Text>}
        {isLive && a.tool && (
          <el.Box flexDirection="row" gap={1}>
            <Icon el={el} surface={surface} name={toolIcon(a.tool)} color={C.teal} isLive />
            <el.Text mono size="footnote" color={C.teal}>
              {a.tool}
            </el.Text>
          </el.Box>
        )}
        {(a.report ?? []).map(line => (
          <el.Text size="footnote" color={C.text2} wrap="truncate-end">
            {line}
          </el.Text>
        ))}
      </el.Box>
    </el.Box>
  )
}

/** The Agents tab. */
export async function agentsView($: EngineInterface, el: Els, surface: RenderSurface) {
  const list = await read($, agents)
  const now = await nowMs($)
  const c = counts(list)
  const header = (
    <el.Text mono tabular size="caption" color={C.text2}>
      {`${c.running} running · ${c.done} done · ${c.failed} failed`}
    </el.Text>
  )
  return (
    <Section el={el} surface={surface} icon="agents" title="Agents" accent={C.violet} right={header}>
      {list.length ? (
        <el.Box flexDirection="column" gap={1}>
          {treeOf(list).map(({ agent, depth }) => (
            <AgentRow el={el} surface={surface} a={agent} depth={depth} now={now} />
          ))}
        </el.Box>
      ) : (
        <el.Box flexDirection="column" gap={0}>
          <el.Text color={C.text2}>No agents yet.</el.Text>
          <el.Text size="footnote" color={C.text3}>
            When Claude hands work to a subagent or a teammate, it shows here: what it is doing, its tools, its time and its report.
          </el.Text>
        </el.Box>
      )}
    </Section>
  )
}

/** One line for Overview ("2 running · 5 done"); undefined when there are no agents. */
export async function agentsSummary($: EngineInterface, el: Els, surface: RenderSurface): Promise<any> {
  const list = await read($, agents)
  if (!list.length) return undefined
  const c = counts(list)
  const parts: string[] = []
  if (c.running) parts.push(`${c.running} running`)
  if (c.waiting) parts.push(`${c.waiting} waiting`)
  if (c.done) parts.push(`${c.done} done`)
  if (c.failed) parts.push(`${c.failed} failed`)
  return (
    <el.Box flexDirection="row" gap={1}>
      <Icon el={el} surface={surface} name="agents" color={C.violet} isLive={c.running > 0} />
      <el.Text mono size="caption" weight="bold" color={C.violet}>
        AGENTS
      </el.Text>
      <el.Text mono tabular color={C.text}>
        {parts.join(' · ')}
      </el.Text>
    </el.Box>
  )
}

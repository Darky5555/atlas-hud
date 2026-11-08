// Work: Claude's tasks (task tools, TodoWrite, the desktop plan tool) and the
// decisions it proposes, kept ones sent back to it each request.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderSurface, SessionStartInput, ToolCallInput, ToolCallResult, TurnCompleteInput, TurnStartInput } from 'claude-code'

import type { Decision, Task } from '../../types'
import { PLAN_TOOL, WRAP_TOOL, applyPlan, bar, decisionsIn, keptSection, wrapPlan } from '../lib'
import { C } from '../ui/theme'
import type { Els, On } from '../ui/kit'
import { Heading, str } from '../ui/kit'

export const tasks = atom({ plugin: 'atlas-hud', key: 'tasks' } as const, [] as Task[], { shape: 'tasks-1' })
export const decisions = atom({ plugin: 'atlas-hud', key: 'decisions' } as const, [] as Decision[], { shape: 'decisions-1' })

// The one instruction this mod adds to the system prompt (about 45 tokens,
// served from the prompt cache after the first turn). The HTML comment is
// hidden by the desktop and mobile Markdown renderers.
const DECISION_RULE =
  'When the user settles a decision worth keeping for this work (a choice, a constraint, a "do not"), ' +
  'end that reply with one hidden line: <!-- decision: the decision in under 15 words -->. ' +
  'At most one per reply; most replies have none.'

export const registerWork = (on: On) => {
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    const kept = keptSection(await read($, decisions))
    return {
      sections: [
        ...r.sections,
        { id: 'atlas-hud-decisions', text: DECISION_RULE, scope: 'session' as const },
        ...(kept ? [{ id: 'atlas-hud-kept-decisions', text: kept, scope: 'session' as const }] : []),
      ],
    }
  })

  // The compaction guard: open tasks and kept decisions survive the summary.
  on('session.compact', async ($, e, next) => {
    const open = (await read($, tasks)).filter(t => t.status !== 'completed')
    const kept = (await read($, decisions)).filter(d => d.status === 'kept')
    if (!open.length && !kept.length) return next(e)
    const keep = [
      'Keep these in the summary word for word.',
      open.length ? `Open tasks:\n${open.map(t => `- [${t.status === 'in_progress' ? 'doing' : 'todo'}] ${t.subject}`).join('\n')}` : '',
      kept.length ? `Decisions the user agreed to:\n${kept.map(d => `- ${d.text}`).join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n')
    return next({ ...e, instructions: [e.instructions, keep].filter(Boolean).join('\n\n') })
  }).catch(($, e, next) => next(e))
}

// ---------- The shared events, called from register.tsx (see hub.ts) ----------

export function workSessionStart(_$: EngineInterface, _e: SessionStartInput) {}

export function workTurnStart(_$: EngineInterface, _e: TurnStartInput) {}

export function workToolStart($: EngineInterface, e: ToolCallInput) {
  const tool = String(e.tool)
  if (tool === 'AskUserQuestion' || tool === 'ExitPlanMode') $.ui.toast('Claude is waiting on your answer')
}

export async function workToolEnd($: EngineInterface, e: ToolCallInput, ran: ToolCallResult) {
  const tool = String(e.tool)
  const input = e as unknown as Record<string, unknown>
  const ok = ran.deny === undefined && ran.isError !== true
  const result = (ran.deny === undefined ? ran.result : undefined) as Record<string, unknown> | undefined
  if (tool === 'TaskCreate' && ok) {
    const task = (result?.task ?? {}) as Record<string, unknown>
    const id = str(task.id)
    if (id) {
      await update($, tasks, l => [...l.filter(t => t.id !== id), { id, subject: str(input.subject), status: 'pending' as const }].slice(-60))
    }
  } else if (tool === 'TaskUpdate' && ok) {
    const id = str(input.taskId)
    const status = str(input.status)
    await update($, tasks, l =>
      status === 'deleted'
        ? l.filter(t => t.id !== id)
        : l.map(t =>
            t.id === id
              ? {
                  ...t,
                  subject: str(input.subject) || t.subject,
                  status: status === 'pending' || status === 'in_progress' || status === 'completed' ? status : t.status,
                }
              : t,
          ),
    )
  } else if (tool === PLAN_TOOL && ok) {
    await update($, tasks, l => applyPlan(l, input))
  } else if (tool === WRAP_TOOL && ok) {
    await update($, tasks, wrapPlan)
  } else if (tool === 'TodoWrite' && ok) {
    const todos = (Array.isArray(input.todos) ? input.todos : []) as Record<string, unknown>[]
    await update($, tasks, () =>
      todos.map((t, i) => {
        const s = str(t.status)
        return {
          id: `todo-${i}`,
          subject: str(t.content),
          status: s === 'in_progress' || s === 'completed' ? s : ('pending' as const),
        }
      }),
    )
  }
}

// Decisions Claude proposed in hidden comments.
export async function workTurnComplete($: EngineInterface, e: TurnCompleteInput): Promise<string | undefined> {
  if (e.agentId !== undefined) return undefined
  const found = decisionsIn(e.answer)
  if (!found.length) return undefined
  const now = await $.clock.now()
  await update($, decisions, l => {
    const have = new Set(l.map(d => d.text.toLowerCase()))
    const add = found
      .filter(t => !have.has(t.toLowerCase()))
      .map((text, i) => ({ id: `${now}-${i}`, text, status: 'proposed' as const, at: now }))
    return [...l, ...add].slice(-80)
  })
  $.ui.toast(`Decision proposed: ${found[0]}`)
  return undefined
}

export function setDecision($: EngineInterface, id: string, status: Decision['status'] | 'drop') {
  return update($, decisions, l => (status === 'drop' ? l.filter(d => d.id !== id) : l.map(d => (d.id === id ? { ...d, status } : d))))
}

export async function proposedCount($: EngineInterface) {
  return (await read($, decisions)).filter(d => d.status === 'proposed').length
}

/** Claude's newest proposal, for the band above the prompt; undefined with none. */
export async function decisionBand($: EngineInterface, el: Els, _surface: RenderSurface) {
  const proposed = (await read($, decisions)).filter(d => d.status === 'proposed')
  const d = proposed.at(-1)
  if (!d) return undefined
  return (
    <el.Box flexDirection="row" flexWrap="wrap" gap={1} borderStyle="round" borderColor={C.gold} paddingX={1}>
      <el.Text mono size="caption" color={C.gold}>
        DECISION
      </el.Text>
      <el.Text color={C.text}>{d.text}</el.Text>
      <el.Button key={`band-keep-${d.id}`} label="Keep" variant="primary" onPress={() => setDecision($, d.id, 'kept')} />
      <el.Button key={`band-drop-${d.id}`} label="Drop" onPress={() => setDecision($, d.id, 'drop')} />
      {proposed.length > 1 && <el.Text color={C.text2}>+{proposed.length - 1} more in /hud</el.Text>}
    </el.Box>
  )
}

/** The Work tab: tasks, then decisions. */
export async function workView($: EngineInterface, el: Els, _surface: RenderSurface) {
  return (
    <el.Box flexDirection="column" gap={1}>
      {await tasksView($, el)}
      {decisionsView($, el, await read($, decisions))}
    </el.Box>
  )
}

async function tasksView($: EngineInterface, el: Els) {
  const list = await read($, tasks)
  if (!list.length) return <el.Text color={C.text2}>No tasks yet. They appear here when Claude plans multi-step work.</el.Text>
  const done = list.filter(t => t.status === 'completed').length
  const order = { in_progress: 0, pending: 1, completed: 2 } as const
  const sorted = [...list].sort((a, b) => order[a.status] - order[b.status])
  return (
    <el.Box flexDirection="column" gap={0}>
      <Heading el={el}>
        {done} OF {list.length} DONE
      </Heading>
      <el.Text mono color={C.teal}>
        {bar((done / list.length) * 100, 24)}
      </el.Text>
      {sorted.map(t => (
        <el.Text
          color={t.status === 'in_progress' ? C.teal : t.status === 'completed' ? C.text2 : C.text}
          dimColor={t.status === 'completed'}
          weight={t.status === 'in_progress' ? 'semibold' : 'regular'}
        >
          {t.status === 'completed' ? '✓ ' : t.status === 'in_progress' ? '▸ ' : '○ '}
          {t.subject}
        </el.Text>
      ))}
    </el.Box>
  )
}

function decisionsView($: EngineInterface, el: Els, list: Decision[]) {
  const proposed = list.filter(d => d.status === 'proposed')
  const kept = list.filter(d => d.status === 'kept')
  return (
    <el.Box flexDirection="column" gap={1}>
      {proposed.length > 0 && <Heading el={el}>CLAUDE PROPOSES</Heading>}
      {proposed.map(d => (
        <el.Box flexDirection="column" borderStyle="round" borderColor={C.gold} paddingX={1}>
          <el.Text color={C.text}>{d.text}</el.Text>
          <el.Box flexDirection="row" gap={1}>
            <el.Button key={`keep-${d.id}`} label="Keep" variant="primary" onPress={() => setDecision($, d.id, 'kept')} />
            <el.Button key={`drop-${d.id}`} label="Drop" onPress={() => setDecision($, d.id, 'drop')} />
          </el.Box>
        </el.Box>
      ))}
      <Heading el={el}>KEPT</Heading>
      {kept.length === 0 && <el.Text color={C.text2}>None yet. Kept decisions survive compaction.</el.Text>}
      {kept.map(d => (
        <el.Box flexDirection="row" justifyContent="space-between" gap={1}>
          <el.Box flexShrink={1}>
            <el.Text color={C.text}>· {d.text}</el.Text>
          </el.Box>
          <el.Button key={`rm-${d.id}`} label="Remove" plain dimColor onPress={() => setDecision($, d.id, 'drop')} />
        </el.Box>
      ))}
    </el.Box>
  )
}

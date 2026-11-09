// Work: Claude's tasks (task tools, TodoWrite, the desktop plan tool) and the
// decisions it proposes, kept ones sent back to it each request.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderSurface, SessionStartInput, ToolCallInput, ToolCallResult, TurnCompleteInput, TurnStartInput } from 'claude-code'

import type { Decision, Task } from '../../types'
import { PLAN_TOOL, WRAP_TOOL, applyPlan, decisionsIn, keptSection, wrapPlan } from '../lib'
import { C } from '../ui/theme'
import type { Els, On } from '../ui/kit'
import { Bar, Card, Chip, Note, PROGRESS_RAMP, Pill, Section, str } from '../ui/kit'
import type { IconName } from '../ui/icons'
import { Icon } from '../ui/icons'

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

// ---------- Views ----------

/**
 * An icon beside a Button: the icon sits outside the Button, since a Button
 * takes only strings and Text (an Svg icon inside one is refused).
 */
const IconButton = ({
  el,
  surface,
  icon,
  color,
  bkey,
  label,
  variant,
  onPress,
}: {
  el: Els
  surface: RenderSurface
  icon: IconName
  color: string
  bkey: string
  label: string
  variant?: 'primary'
  onPress: () => unknown
}) => (
  <el.Box flexDirection="row" gap={1} alignItems="center">
    <Icon el={el} surface={surface} name={icon} color={color} />
    <el.Button key={bkey} label={label} {...(variant ? { variant } : {})} onPress={() => void onPress()} />
  </el.Box>
)

/** Claude's newest proposal, for the band above the prompt; undefined with none. */
export async function decisionBand($: EngineInterface, el: Els, surface: RenderSurface) {
  const proposed = (await read($, decisions)).filter(d => d.status === 'proposed')
  const d = proposed.at(-1)
  if (!d) return undefined
  return (
    <el.Box flexDirection="row" flexWrap="wrap" gap={1} alignItems="center" borderStyle="round" borderColor={C.gold} backgroundColor={C.panel} paddingX={1}>
      <el.Box flexDirection="row" gap={1} alignItems="center">
        <Icon el={el} surface={surface} name="decision" color={C.gold} />
        <el.Text mono size="caption" weight="bold" color={C.gold}>
          DECISION
        </el.Text>
      </el.Box>
      <el.Text color={C.text}>{d.text}</el.Text>
      <IconButton el={el} surface={surface} icon="keep" color={C.ok} bkey={`band-keep-${d.id}`} label="Keep" variant="primary" onPress={() => setDecision($, d.id, 'kept')} />
      <IconButton el={el} surface={surface} icon="drop" color={C.bad} bkey={`band-drop-${d.id}`} label="Drop" onPress={() => setDecision($, d.id, 'drop')} />
      {proposed.length > 1 && <el.Text color={C.text2}>{`+${proposed.length - 1} more in /hud`}</el.Text>}
    </el.Box>
  )
}

/** The Work tab: tasks, then decisions. */
export async function workView($: EngineInterface, el: Els, surface: RenderSurface) {
  return (
    <el.Box flexDirection="column" gap={1}>
      {await tasksView($, el, surface)}
      {decisionsView($, el, surface, await read($, decisions))}
    </el.Box>
  )
}

const TASK_ICON: Record<Task['status'], IconName> = { pending: 'task-pending', in_progress: 'task-active', completed: 'task-done' }

async function tasksView($: EngineInterface, el: Els, surface: RenderSurface) {
  const list = await read($, tasks)
  if (!list.length) {
    return (
      <Section el={el} surface={surface} icon="work" title="Tasks">
        <Note el={el} surface={surface} icon="task-pending">
          No tasks yet. They appear here when Claude plans multi-step work.
        </Note>
      </Section>
    )
  }
  const done = list.filter(t => t.status === 'completed').length
  const pct = (done / list.length) * 100
  const order = { in_progress: 0, pending: 1, completed: 2 } as const
  const sorted = [...list].sort((a, b) => order[a.status] - order[b.status])
  return (
    <Section el={el} surface={surface} icon="work" title={`${done} of ${list.length} done`}>
      <el.Box flexDirection="row" gap={1} alignItems="center">
        <Bar el={el} surface={surface} pct={pct} ramp={PROGRESS_RAMP} alt={`${done} of ${list.length} tasks done`} />
        <el.Text mono tabular weight="bold" color={C.teal}>
          {`${Math.round(pct)}%`}
        </el.Text>
      </el.Box>
      {sorted.map(t => (
        <el.Box flexDirection="row" gap={1}>
          <Icon
            el={el}
            surface={surface}
            name={TASK_ICON[t.status]}
            color={t.status === 'in_progress' ? C.teal : t.status === 'completed' ? C.ok : C.text3}
            isLive={t.status === 'in_progress'}
          />
          <el.Text
            color={t.status === 'in_progress' ? C.text : t.status === 'completed' ? C.text3 : C.text2}
            weight={t.status === 'in_progress' ? 'semibold' : 'regular'}
            strikethrough={t.status === 'completed'}
          >
            {t.subject}
          </el.Text>
        </el.Box>
      ))}
    </Section>
  )
}

function decisionsView($: EngineInterface, el: Els, surface: RenderSurface, list: Decision[]) {
  const proposed = list.filter(d => d.status === 'proposed')
  const kept = list.filter(d => d.status === 'kept')
  return (
    <el.Box flexDirection="column" gap={1}>
      {proposed.length > 0 && (
        <Section el={el} surface={surface} icon="decision" title="Claude proposes" accent={C.gold} right={<Chip el={el} label={String(proposed.length)} />}>
          <el.Box flexDirection="column" gap={1}>
            {proposed.map(d => (
              <Card el={el} accent={C.gold}>
                <el.Text color={C.text}>{d.text}</el.Text>
                <el.Box flexDirection="row" flexWrap="wrap" gap={1}>
                  <IconButton el={el} surface={surface} icon="keep" color={C.ok} bkey={`keep-${d.id}`} label="Keep" variant="primary" onPress={() => setDecision($, d.id, 'kept')} />
                  <IconButton el={el} surface={surface} icon="drop" color={C.bad} bkey={`drop-${d.id}`} label="Drop" onPress={() => setDecision($, d.id, 'drop')} />
                </el.Box>
              </Card>
            ))}
          </el.Box>
        </Section>
      )}
      <Section el={el} surface={surface} icon="keep" title="Kept" right={kept.length ? <Pill el={el} label={String(kept.length)} /> : undefined}>
        {kept.length === 0 && (
          <Note el={el} surface={surface} icon="decision">
            None yet. Kept decisions survive compaction.
          </Note>
        )}
        {kept.map(d => (
          <el.Box flexDirection="row" justifyContent="space-between" gap={1}>
            <el.Box flexDirection="row" gap={1} flexShrink={1}>
              <Icon el={el} surface={surface} name="check" color={C.teal} />
              <el.Text color={C.text}>{d.text}</el.Text>
            </el.Box>
            <el.Button key={`rm-${d.id}`} label="Remove" plain dimColor onPress={() => void setDecision($, d.id, 'drop')} />
          </el.Box>
        ))}
      </Section>
    </el.Box>
  )
}

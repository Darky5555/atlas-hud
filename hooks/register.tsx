import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Decision, Step, Tab, Task, Turn, Usage } from '../types'
import {
  C,
  DONE_WORDS,
  bar,
  classify,
  decisionsIn,
  describe,
  duration,
  levelColor,
  limitLabel,
  parseTests,
  projectFull,
  resetsIn,
  statusText,
  summaryText,
  verdict,
} from './lib'

const PANE = 'atlas-hud'
const TITLE = 'Atlas HUD'

const EMPTY_USAGE: Usage = { contextWindow: 0, limits: [], samples: [], alerted: {} }

const usage = atom({ plugin: 'atlas-hud', key: 'usage' } as const, EMPTY_USAGE, { shape: 'usage-1' })
const tasks = atom({ plugin: 'atlas-hud', key: 'tasks' } as const, [] as Task[], { shape: 'tasks-1' })
const decisions = atom({ plugin: 'atlas-hud', key: 'decisions' } as const, [] as Decision[], { shape: 'decisions-1' })
const turns = atom({ plugin: 'atlas-hud', key: 'turns' } as const, [] as Turn[], { shape: 'turns-1' })
const tab = atom({ plugin: 'atlas-hud', key: 'tab' } as const, 'usage' as Tab)

// The one instruction this mod adds to the system prompt (about 45 tokens,
// served from the prompt cache after the first turn). The HTML comment is
// hidden by the desktop and mobile Markdown renderers.
const DECISION_RULE =
  'When the user settles a decision worth keeping for this work (a choice, a constraint, a "do not"), ' +
  'end that reply with one hidden line: <!-- decision: the decision in under 15 words -->. ' +
  'At most one per reply; most replies have none.'

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

const str = (v: unknown) => (typeof v === 'string' ? v : '')

export const register: Register = on => {
  // Module variables start over on a reload; that only loses the turn in flight.
  let acc = freshAcc()
  let startPct: Record<string, number> = {}
  let burnToasted = false

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'hud', description: 'Open the Atlas HUD pane' })
    void openPane($)
    return next(e)
  })

  on('command.run', { command: 'hud' }, async $ => {
    await openPane($)
    return { text: 'Atlas HUD opened.' }
  })

  // ---------- Usage: pushed by the engine, never polled ----------

  on('session.measure', async ($, e, next) => {
    const now = await $.clock.now()
    const toasts: string[] = []

    const u = await update($, usage, prev => {
      const alerted = { ...prev.alerted }
      for (const l of e.rateLimits) {
        const key = `${l.kind}@${l.resetsAt ?? ''}`
        const done = alerted[key] ?? 0
        const hit = l.percentUsed >= 90 ? 90 : l.percentUsed >= 75 ? 75 : 0
        if (hit > done) {
          alerted[key] = hit
          const reset = resetsIn(l, now)
          toasts.push(`${limitLabel(l.kind)} limit at ${Math.round(l.percentUsed)}%${reset ? `, resets in ${reset}` : ''}`)
        }
      }
      const samples = [
        ...prev.samples.filter(s => now - s.at <= 3_600_000),
        ...e.rateLimits.map(l => ({ at: now, kind: l.kind, pct: l.percentUsed })),
      ].slice(-240)
      return {
        contextPercent: e.context.percent,
        contextTokens: e.context.tokens,
        contextWindow: e.context.window,
        limits: e.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
        costUsd: e.cost?.usd,
        samples,
        alerted,
      }
    })

    if (!burnToasted) {
      for (const l of e.rateLimits) {
        const before = startPct[l.kind]
        if (before !== undefined && l.percentUsed - before > 5) {
          burnToasted = true
          toasts.push(`That turn used ${Math.round(l.percentUsed - before)}% of your ${limitLabel(l.kind)} limit`)
          break
        }
      }
    }

    $.ui.status(statusText(u))
    for (const t of toasts) $.ui.toast(t)
    return next(e)
  })

  // ---------- Turn tracking ----------

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      acc = freshAcc()
      burnToasted = false
      const u = await read($, usage)
      startPct = Object.fromEntries(u.limits.map(l => [l.kind, l.percentUsed]))
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>

    if (tool === 'AskUserQuestion' || tool === 'ExitPlanMode') {
      $.ui.toast('Claude is waiting on your answer')
    }

    const ran = await next(e)
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
    } else if (tool === 'TaskCreate' && ok) {
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

    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const now = await $.clock.now()

    // Decisions Claude proposed in hidden comments.
    const found = decisionsIn(e.answer)
    if (found.length) {
      await update($, decisions, l => {
        const have = new Set(l.map(d => d.text.toLowerCase()))
        const add = found
          .filter(t => !have.has(t.toLowerCase()))
          .map((text, i) => ({ id: `${now}-${i}`, text, status: 'proposed' as const, at: now }))
        return [...l, ...add].slice(-80)
      })
      $.ui.toast(`Decision proposed: ${found[0]}`)
    }

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
    const r = await next(e)
    // A text other than the answer is drawn beneath it, on every surface.
    return card ? { ...r, text: card } : r
  })

  // ---------- Context: one small rule, and the compaction guard ----------

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    return { sections: [...r.sections, { id: 'atlas-hud-decisions', text: DECISION_RULE, scope: 'session' as const }] }
  })

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

  // ---------- Drawing ----------

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const row = await next(e)
    if (e.props.isExpanded) return row
    const tag = badge(String(e.props.tool), e.props.input)
    if (!tag) return row
    const { Box, Text } = $.ui.resolve(e)
    const color = e.props.isErrored ? C.danger : tag.color
    return (
      <Box flexDirection="column">
        {row}
        <Text mono size="caption" color={color}>
          {e.props.isErrored ? `${tag.label} FAILED` : tag.label}
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const current = await read($, tab)
    const now = await $.clock.now()
    const T: [Tab, string][] = [
      ['usage', 'Usage'],
      ['tasks', 'Tasks'],
      ['decisions', 'Decisions'],
      ['changes', 'Changes'],
    ]
    const decs = await read($, decisions)
    const proposed = decs.filter(d => d.status === 'proposed').length

    let body
    if (current === 'usage') body = await usageView($, Box, Text, now)
    else if (current === 'tasks') body = await tasksView($, Box, Text)
    else if (current === 'decisions') body = decisionsView($, Box, Text, Button, decs)
    else body = await changesView($, Box, Text)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {T.map(([k, label]) => (
            <Button
              key={`tab-${k}`}
              label={k === 'decisions' && proposed ? `${label} (${proposed})` : label}
              variant={k === current ? 'primary' : 'secondary'}
              onPress={() => update($, tab, () => k)}
            />
          ))}
        </Box>
        {body}
      </Box>
    )
  })
}

function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: TITLE })
}

// ---------- Views ----------

type El = (props: any) => any

const Heading = ({ Text, children }: { Text: El; children?: any }) => (
  <Text mono size="caption" color={C.teal}>
    {children}
  </Text>
)

const TurnBody = ({ Box, Text, turn }: { Box: El; Text: El; turn: Turn }) => {
  const v = verdict(turn)
  return (
    <Box flexDirection="column">
      {turn.lines.map(line => (
        <Text color={C.text}>{line}</Text>
      ))}
      {v && (
        <Text color={v.tone === 'ok' ? C.green : v.tone === 'warn' ? C.gold : C.text2} dimColor={v.tone === 'dim'}>
          {v.tone === 'ok' ? '✓ ' : v.tone === 'warn' ? '! ' : '· '}
          {v.text}
        </Text>
      )}
    </Box>
  )
}

const Gauge = ({ Box, Text, label, pct, note }: { Box: El; Text: El; label: string; pct: number; note?: string }) => (
  <Box flexDirection="column">
    <Box flexDirection="row" justifyContent="space-between">
      <Text weight="semibold" color={C.text}>
        {label}
      </Text>
      <Text mono tabular color={levelColor(pct)}>
        {Math.round(pct)}%
      </Text>
    </Box>
    <Text mono color={levelColor(pct)}>
      {bar(pct, 24)}
    </Text>
    {note && (
      <Text size="footnote" color={C.text2}>
        {note}
      </Text>
    )}
  </Box>
)

async function usageView($: EngineInterface, Box: El, Text: El, now: number) {
  const u = await read($, usage)
  if (!u.limits.length && u.contextPercent === undefined) {
    return <Text color={C.text2}>Waiting for the first usage reading. It arrives after Claude's next reply.</Text>
  }
  return (
    <Box flexDirection="column" gap={1}>
      <Heading Text={Text}>LIMITS</Heading>
      {u.limits.map(l => {
        const reset = resetsIn(l, now)
        const full = projectFull(u, l.kind, now)
        const resetMs = l.resetsAt ? Date.parse(l.resetsAt) - now : Infinity
        const pace =
          full === undefined ? '' : full < resetMs ? ` At this pace you hit 100% in ~${duration(full)}, before it resets.` : ' At this pace you stay under it.'
        return <Gauge Box={Box} Text={Text} label={limitLabel(l.kind)} pct={l.percentUsed} note={`${reset ? `Resets in ${reset}.` : ''}${pace}`} />
      })}
      {u.contextPercent !== undefined && (
        <Box flexDirection="column" gap={1}>
          <Heading Text={Text}>THIS CONVERSATION</Heading>
          <Gauge
            Box={Box}
            Text={Text}
            label="Context window"
            pct={u.contextPercent}
            note={`${(u.contextTokens ?? 0).toLocaleString('en-US')} of ${u.contextWindow.toLocaleString('en-US')} tokens. When it fills, Claude compacts; open tasks and kept decisions are carried through.`}
          />
        </Box>
      )}
      {u.costUsd !== undefined && (
        <Box flexDirection="row" justifyContent="space-between">
          <Text color={C.text2}>Session cost (API rates)</Text>
          <Text mono tabular color={C.gold}>
            ${u.costUsd.toFixed(2)}
          </Text>
        </Box>
      )}
    </Box>
  )
}

async function tasksView($: EngineInterface, Box: El, Text: El) {
  const list = await read($, tasks)
  if (!list.length) return <Text color={C.text2}>No tasks yet. They appear here when Claude plans multi-step work.</Text>
  const done = list.filter(t => t.status === 'completed').length
  const order = { in_progress: 0, pending: 1, completed: 2 } as const
  const sorted = [...list].sort((a, b) => order[a.status] - order[b.status])
  return (
    <Box flexDirection="column" gap={0}>
      <Heading Text={Text}>
        {done} OF {list.length} DONE
      </Heading>
      <Text mono color={C.teal}>
        {bar((done / list.length) * 100, 24)}
      </Text>
      {sorted.map(t => (
        <Text
          color={t.status === 'in_progress' ? C.teal : t.status === 'completed' ? C.text2 : C.text}
          dimColor={t.status === 'completed'}
          weight={t.status === 'in_progress' ? 'semibold' : 'regular'}
        >
          {t.status === 'completed' ? '✓ ' : t.status === 'in_progress' ? '▸ ' : '○ '}
          {t.subject}
        </Text>
      ))}
    </Box>
  )
}

function decisionsView($: EngineInterface, Box: El, Text: El, Button: El, list: Decision[]) {
  const proposed = list.filter(d => d.status === 'proposed')
  const kept = list.filter(d => d.status === 'kept')
  const set = (id: string, status: Decision['status'] | 'drop') =>
    update($, decisions, l => (status === 'drop' ? l.filter(d => d.id !== id) : l.map(d => (d.id === id ? { ...d, status } : d))))
  return (
    <Box flexDirection="column" gap={1}>
      {proposed.length > 0 && <Heading Text={Text}>CLAUDE PROPOSES</Heading>}
      {proposed.map(d => (
        <Box flexDirection="column" borderStyle="round" borderColor={C.gold} paddingX={1}>
          <Text color={C.text}>{d.text}</Text>
          <Box flexDirection="row" gap={1}>
            <Button key={`keep-${d.id}`} label="Keep" variant="primary" onPress={() => set(d.id, 'kept')} />
            <Button key={`drop-${d.id}`} label="Drop" onPress={() => set(d.id, 'drop')} />
          </Box>
        </Box>
      ))}
      <Heading Text={Text}>KEPT</Heading>
      {kept.length === 0 && <Text color={C.text2}>None yet. Kept decisions survive compaction.</Text>}
      {kept.map(d => (
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Box flexShrink={1}>
            <Text color={C.text}>· {d.text}</Text>
          </Box>
          <Button key={`rm-${d.id}`} label="Remove" plain dimColor onPress={() => set(d.id, 'drop')} />
        </Box>
      ))}
    </Box>
  )
}

async function changesView($: EngineInterface, Box: El, Text: El) {
  const list = (await read($, turns)).slice(-10).reverse()
  if (!list.length) return <Text color={C.text2}>Nothing yet. Each turn that uses tools adds a summary here.</Text>
  return (
    <Box flexDirection="column" gap={1}>
      {list.map(t => (
        <Box flexDirection="column" borderStyle="round" borderColor={C.line} paddingX={1}>
          <Text mono size="caption" color={C.teal}>
            {new Date(t.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · {duration(t.durationMs)}
          </Text>
          <TurnBody Box={Box} Text={Text} turn={t} />
        </Box>
      ))}
    </Box>
  )
}

// ---------- Tool badges ----------

function badge(tool: string, input: unknown): { label: string; color: string } | undefined {
  const i = (input ?? {}) as Record<string, unknown>
  const file = str(i.file_path).split('/').at(-1)
  switch (tool) {
    case 'Edit':
    case 'NotebookEdit':
      return { label: `EDIT${file ? ` · ${file}` : ''}`, color: C.gold }
    case 'Write':
      return { label: `WRITE${file ? ` · ${file}` : ''}`, color: C.gold }
    case 'WebSearch':
    case 'WebFetch':
      return { label: 'WEB', color: C.text2 }
    case 'Agent':
      return { label: 'AGENT', color: C.text2 }
    case 'Bash': {
      const k = classify(str(i.command))
      const map: Record<Step['kind'], { label: string; color: string } | undefined> = {
        test: { label: 'TEST', color: C.green },
        build: { label: 'BUILD', color: C.green },
        check: { label: 'CHECK', color: C.green },
        commit: { label: 'COMMIT', color: C.orange },
        push: { label: 'PUSH', color: C.orange },
        install: { label: 'INSTALL', color: C.text2 },
        git: { label: 'GIT', color: C.text2 },
        command: undefined,
      }
      return map[k]
    }
    default:
      return undefined
  }
}

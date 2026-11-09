// Pure helpers: no `$`, so the tests can call them directly.
import type { Decision, Limit, Step, Task, Turn, Usage } from '../types'

import { C } from './ui/theme'

export { C }

export const levelColor = (pct: number) =>
  pct >= 90 ? C.danger : pct >= 75 ? C.gold : C.teal

export const bar = (pct: number, cells = 16) => {
  const filled = Math.max(0, Math.min(cells, Math.round((pct / 100) * cells)))
  return '█'.repeat(filled) + '░'.repeat(cells - filled)
}

export const limitLabel = (kind: string) => {
  const k = kind.toLowerCase()
  if (k.includes('five') || k.includes('5h') || k === 'session') return '5-hour'
  if (k.includes('opus')) return 'Weekly (Opus)'
  if (k.includes('sonnet')) return 'Weekly (Sonnet)'
  if (k.includes('seven') || k.includes('week')) return 'Weekly'
  return kind.replace(/_/g, ' ')
}

export const shortLabel = (kind: string) =>
  limitLabel(kind).replace('Weekly', 'wk').replace('5-hour', '5h')

export const duration = (ms: number) => {
  if (!Number.isFinite(ms) || ms <= 0) return 'now'
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

/**
 * A turn's length to the second: "<1s", "42s", "3m 05s", "1h 02m". `duration`
 * stays the coarse one (reset notes); it reads "0m" for a short turn.
 */
export const turnDuration = (ms: number) => {
  if (!Number.isFinite(ms) || ms < 1000) return '<1s'
  const total = Math.round(ms / 1000)
  if (total < 60) return `${total}s`
  const m = Math.floor(total / 60)
  if (m < 60) return `${m}m ${String(total % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export const resetsIn = (limit: Limit, now: number) =>
  limit.resetsAt ? duration(Date.parse(limit.resetsAt) - now) : undefined

/** Minutes until 100% at the pace of the last hour, or undefined if flat. */
export const projectFull = (usage: Usage, kind: string, now: number) => {
  const pts = usage.samples.filter(s => s.kind === kind && now - s.at <= 3_600_000)
  const first = pts[0]
  const last = pts.at(-1)
  if (!first || !last || last.at - first.at < 5 * 60_000) return undefined
  const rate = (last.pct - first.pct) / (last.at - first.at) // pct per ms
  if (rate <= 0) return undefined
  return (100 - last.pct) / rate
}

export const statusText = (usage: Usage) => {
  const parts = usage.limits.map(l => `${shortLabel(l.kind)} ${Math.round(l.percentUsed)}%`)
  if (usage.contextPercent !== undefined) parts.push(`ctx ${Math.round(usage.contextPercent)}%`)
  if (usage.costUsd !== undefined) parts.push(`$${usage.costUsd.toFixed(2)}`)
  return parts.length ? parts.join(' · ') : undefined
}

// ---------- Turn summaries ----------

const base = (p: string) => p.split('/').filter(Boolean).at(-1) ?? p

export const classify = (command: string): Step['kind'] => {
  const c = command
  if (/\b(vitest|jest|pytest|mocha|playwright test|go test|cargo test|npm (run )?test|node --test|plugin test)\b/.test(c)) return 'test'
  if (/\b(npm run build|vite build|tsc\b|cargo build|next build|make\b)/.test(c)) return 'build'
  if (/\b(audit|lint|eslint|lighthouse|curl|screenshot|chromium|playwright|plugin validate)\b/.test(c)) return 'check'
  if (/\bgit (push)\b/.test(c)) return 'push'
  if (/\bgit commit\b/.test(c)) return 'commit'
  if (/\b(npm (i|install|ci)|pip install|yarn add|pnpm add)\b/.test(c)) return 'install'
  if (/\bgit\b/.test(c)) return 'git'
  return 'command'
}

const num = (s: string | undefined) => (s ? Number(s.replace(/,/g, '')) : 0)

/** Pass/fail counts from vitest, jest, pytest or node --test output. */
export const parseTests = (out: string) => {
  // node --test summary lines: `ℹ pass 3` (spec reporter) or `# pass 3` (TAP).
  const nodePass = out.match(/^[ℹ#]\s*pass\s+(\d[\d,]*)\s*$/m)
  const nodeFail = out.match(/^[ℹ#]\s*fail\s+(\d[\d,]*)\s*$/m)
  if (nodePass || nodeFail) return { passed: num(nodePass?.[1]), failed: num(nodeFail?.[1]) }
  const vitest = out.match(/Tests\s+(?:(\d[\d,]*) failed\s*\|\s*)?(\d[\d,]*) passed/)
  if (vitest) return { passed: num(vitest[2]), failed: num(vitest[1]) }
  const passed = out.match(/(\d[\d,]*) (?:passed|passing)/)
  const failed = out.match(/(\d[\d,]*) (?:failed|failing)/)
  if (passed || failed) return { passed: num(passed?.[1]), failed: num(failed?.[1]) }
  return undefined
}

const list = (names: string[]) => {
  const shown = names.slice(0, 3).map(base)
  const more = names.length - shown.length
  if (more > 0) return `${shown.join(', ')} and ${more} more`
  if (shown.length <= 1) return shown.join('')
  return `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

export const DONE_WORDS = /\b(done|fixed|works|working now|complete[d]?|ready|shipped|finished)\b/i

/** Plain-English lines for one turn, built only from what the tools did. */
export const describe = (t: Omit<Turn, 'lines'>): string[] => {
  const out: string[] = []
  if (t.created.length) out.push(`Created ${plural(t.created.length, 'file')}: ${list(t.created)}.`)
  if (t.edited.length) out.push(`Changed ${plural(t.edited.length, 'file')}: ${list(t.edited)}.`)

  const of = (k: Step['kind']) => t.steps.filter(s => s.kind === k)
  const tests = of('test')
  if (tests.length) {
    if (t.tests) {
      out.push(
        t.tests.failed
          ? `Ran the tests: ${t.tests.passed.toLocaleString('en-US')} passed, ${t.tests.failed.toLocaleString('en-US')} failed.`
          : `Ran the tests: all ${t.tests.passed.toLocaleString('en-US')} passed.`,
      )
    } else out.push(tests.every(s => s.ok) ? 'Ran the tests and they passed.' : 'Ran the tests and something failed.')
  }
  const builds = of('build')
  if (builds.length) out.push(builds.every(s => s.ok) ? 'Built the project without errors.' : 'Tried to build, and the build failed.')
  const checks = of('check')
  if (checks.length) out.push(`Ran ${plural(checks.length, 'check')} (audits, screenshots or live requests).`)
  if (of('install').length) out.push('Installed packages.')
  if (of('commit').length) out.push(of('commit').every(s => s.ok) ? 'Saved a commit.' : 'Tried to commit, and it failed.')
  if (of('push').length) out.push(of('push').every(s => s.ok) ? 'Pushed the branch.' : 'Tried to push the branch, and it failed.')
  const other = [...of('command'), ...of('git')]
  if (other.length) {
    const failed = other.filter(s => !s.ok).length
    out.push(`Ran ${plural(other.length, 'other command')}${failed ? `, ${failed} failed` : ''}.`)
  }
  if (t.searches) out.push(`Searched the web ${plural(t.searches, 'time')}.`)
  if (t.reads && !t.edited.length && !t.created.length) out.push(`Looked through ${plural(t.reads, 'file')} without changing any.`)
  if (!out.length) out.push('Answered without changing anything.')
  return out
}

/** Verified means a test, build or check ran after the last file change. */
export const verdict = (t: Pick<Turn, 'edited' | 'created' | 'isVerified' | 'claimsDone'>) => {
  const changed = t.edited.length + t.created.length > 0
  if (!changed) return undefined
  if (t.isVerified) return { tone: 'ok' as const, text: 'Checked: a test, build or check ran after the last change.' }
  if (t.claimsDone) return { tone: 'warn' as const, text: 'Says done, but nothing was run to check the change.' }
  return { tone: 'dim' as const, text: 'Not checked yet: no test, build or check after the last change.' }
}

/** The turn's summary as text: `turn.complete` shows it beneath the answer. */
export const summaryText = (t: Turn) => {
  const v = verdict(t)
  const mark = v ? `${v.tone === 'ok' ? '✓' : v.tone === 'warn' ? '!' : '·'} ${v.text}` : undefined
  return [`WHAT CHANGED · ${turnDuration(t.durationMs)}`, ...t.lines, ...(mark ? [mark] : [])].join('\n')
}

export const DECISION =/<!--\s*decision:\s*([\s\S]+?)\s*-->/gi

export const decisionsIn = (answer: string) =>
  [...answer.matchAll(DECISION)].map(m => (m[1] ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean)

// ---------- The desktop app's plan tool ----------

export const PLAN_TOOL = 'mcp__ccd_turn__update_plan'
export const WRAP_TOOL = 'mcp__ccd_turn__wrap_up'

const planStatus = (s: unknown): Task['status'] => (s === 'in_progress' || s === 'completed' ? s : 'pending')
const isPlan = (t: Task) => t.id.startsWith('plan-')

/**
 * The task list after one plan call: `items` replaces the plan, `advance`
 * completes the step in progress and starts the next pending one, and `done`
 * / `start` (1-based) set steps by number. Tasks from other tools stay.
 */
export const applyPlan = (list: Task[], input: Record<string, unknown>): Task[] => {
  if (Array.isArray(input.items)) {
    const plan = input.items.slice(0, 60).map((it, i) => {
      const o = (it ?? {}) as Record<string, unknown>
      return { id: `plan-${i + 1}`, subject: typeof o.content === 'string' ? o.content : '', status: planStatus(o.status) }
    })
    return [...list.filter(t => !isPlan(t)), ...plan]
  }
  let out = list
  const set = (n: number, status: Task['status']) => {
    out = out.map(t => (t.id === `plan-${n}` ? { ...t, status } : t))
  }
  if (input.advance === true) {
    const plan = out.filter(isPlan)
    const at = plan.findIndex(t => t.status === 'in_progress')
    if (at >= 0) set(at + 1, 'completed')
    const nextAt = plan.findIndex((t, i) => i > at && t.status === 'pending')
    if (nextAt >= 0) set(nextAt + 1, 'in_progress')
  }
  if (Array.isArray(input.done)) for (const n of input.done) if (typeof n === 'number') set(n, 'completed')
  if (typeof input.start === 'number') set(input.start, 'in_progress')
  return out
}

/** Wrapping up checks off the plan step still in progress. */
export const wrapPlan = (list: Task[]): Task[] =>
  list.map(t => (isPlan(t) && t.status === 'in_progress' ? { ...t, status: 'completed' as const } : t))

// ---------- Kept decisions, sent to Claude ----------

/** The system-prompt text for the decisions the user kept, or undefined with none. */
export const keptSection = (list: Decision[]) => {
  const kept = list.filter(d => d.status === 'kept').slice(-20)
  if (!kept.length) return undefined
  return `Decisions the user has agreed to for this work. Follow them unless the user changes one:\n${kept.map(d => `- ${d.text}`).join('\n')}`
}

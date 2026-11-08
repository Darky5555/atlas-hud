// Usage: limits, context and cost, pushed by the engine and never polled.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, SessionStartInput, ToolCallInput, ToolCallResult, TurnCompleteInput, TurnStartInput } from 'claude-code'

import type { Usage } from '../../types'
import { duration, limitLabel, projectFull, resetsIn, statusText } from '../lib'
import { C } from '../ui/theme'
import type { Els, On } from '../ui/kit'
import { Gauge, Heading } from '../ui/kit'

const EMPTY_USAGE: Usage = { contextWindow: 0, limits: [], samples: [], alerted: {} }

export const usage = atom({ plugin: 'atlas-hud', key: 'usage' } as const, EMPTY_USAGE, { shape: 'usage-1' })

// Module variables start over on a reload; that only loses the turn in flight.
let startPct: Record<string, number> = {}
let burnToasted = false

export const registerUsage = (on: On) => {
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
}

// ---------- The shared events, called from register.tsx (see hub.ts) ----------

export async function usageTurnStart($: EngineInterface, e: TurnStartInput) {
  if (e.agentId !== undefined) return
  burnToasted = false
  const u = await read($, usage)
  startPct = Object.fromEntries(u.limits.map(l => [l.kind, l.percentUsed]))
}

export function usageSessionStart(_$: EngineInterface, _e: SessionStartInput) {}

export function usageToolStart(_$: EngineInterface, _e: ToolCallInput) {}

export function usageToolEnd(_$: EngineInterface, _e: ToolCallInput, _ran: ToolCallResult) {}

export function usageTurnComplete(_$: EngineInterface, _e: TurnCompleteInput): string | undefined {
  return undefined
}

export async function usageView($: EngineInterface, el: Els, now: number) {
  const u = await read($, usage)
  if (!u.limits.length && u.contextPercent === undefined) {
    return <el.Text color={C.text2}>Waiting for the first usage reading. It arrives after Claude's next reply.</el.Text>
  }
  return (
    <el.Box flexDirection="column" gap={1}>
      <Heading el={el}>LIMITS</Heading>
      {u.limits.map(l => {
        const reset = resetsIn(l, now)
        const full = projectFull(u, l.kind, now)
        const resetMs = l.resetsAt ? Date.parse(l.resetsAt) - now : Infinity
        const pace =
          full === undefined ? '' : full < resetMs ? ` At this pace you hit 100% in ~${duration(full)}, before it resets.` : ' At this pace you stay under it.'
        return <Gauge el={el} label={limitLabel(l.kind)} pct={l.percentUsed} note={`${reset ? `Resets in ${reset}.` : ''}${pace}`} />
      })}
      {u.contextPercent !== undefined && (
        <el.Box flexDirection="column" gap={1}>
          <Heading el={el}>THIS CONVERSATION</Heading>
          <Gauge
            el={el}
            label="Context window"
            pct={u.contextPercent}
            note={`${(u.contextTokens ?? 0).toLocaleString('en-US')} of ${u.contextWindow.toLocaleString('en-US')} tokens. When it fills, Claude compacts; open tasks and kept decisions are carried through.`}
          />
        </el.Box>
      )}
      {u.costUsd !== undefined && (
        <el.Box flexDirection="row" justifyContent="space-between">
          <el.Text color={C.text2}>Session cost (API rates)</el.Text>
          <el.Text mono tabular color={C.gold}>
            ${u.costUsd.toFixed(2)}
          </el.Text>
        </el.Box>
      )}
    </el.Box>
  )
}

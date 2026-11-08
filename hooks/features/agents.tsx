// Agents: the subagents and teammates this session runs. (Placeholder until
// the Agents feature lands.)
import type { EngineInterface, RenderSurface, SessionStartInput, ToolCallInput, ToolCallResult, TurnCompleteInput, TurnStartInput } from 'claude-code'

import { C } from '../ui/theme'
import type { Els, On } from '../ui/kit'

export const registerAgents = (_on: On) => {}

// ---------- The shared events, called from register.tsx (see hub.ts) ----------

export function agentsSessionStart(_$: EngineInterface, _e: SessionStartInput) {}

export function agentsTurnStart(_$: EngineInterface, _e: TurnStartInput) {}

export function agentsToolStart(_$: EngineInterface, _e: ToolCallInput) {}

export function agentsToolEnd(_$: EngineInterface, _e: ToolCallInput, _ran: ToolCallResult) {}

/** On the main loop, a string returned is shown beneath the answer. */
export function agentsTurnComplete(_$: EngineInterface, _e: TurnCompleteInput): string | undefined | Promise<string | undefined> {
  return undefined
}

/** The Agents tab. */
export async function agentsView(_$: EngineInterface, el: Els, _surface: RenderSurface) {
  return <el.Text color={C.text2}>No agents yet.</el.Text>
}

// Git and the done-check. (Placeholder until the Git feature lands.)
import type { EngineInterface, RenderSurface, SessionStartInput, ToolCallInput, ToolCallResult, TurnCompleteInput, TurnStartInput } from 'claude-code'

import type { Els, On } from '../ui/kit'

export const registerGit = (_on: On) => {}

// ---------- The shared events, called from register.tsx (see hub.ts) ----------

export function gitSessionStart(_$: EngineInterface, _e: SessionStartInput) {}

export function gitTurnStart(_$: EngineInterface, _e: TurnStartInput) {}

export function gitToolStart(_$: EngineInterface, _e: ToolCallInput) {}

export function gitToolEnd(_$: EngineInterface, _e: ToolCallInput, _ran: ToolCallResult) {}

/** On the main loop, a string returned is shown beneath the answer. */
export function gitTurnComplete(_$: EngineInterface, _e: TurnCompleteInput): string | undefined | Promise<string | undefined> {
  return undefined
}

/** The git block on the Overview tab; undefined draws nothing. */
export async function gitPanel(_$: EngineInterface, _el: Els, _surface: RenderSurface): Promise<any> {
  return undefined
}

/** A done-check warning for the band above the prompt; undefined draws nothing. */
export async function doneBand(_$: EngineInterface, _el: Els, _surface: RenderSurface): Promise<any> {
  return undefined
}

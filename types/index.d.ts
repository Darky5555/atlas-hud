export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Usage = {
  contextPercent?: number
  contextTokens?: number
  contextWindow: number
  limits: Limit[]
  costUsd?: number
  // Samples of each limit over time, used for the burn-rate projection.
  samples: { at: number; kind: string; pct: number }[]
  // Thresholds already toasted, keyed "<kind>@<resetsAt>".
  alerted: Record<string, number>
}

export type Task = {
  id: string
  subject: string
  status: 'pending' | 'in_progress' | 'completed'
}

export type Decision = {
  id: string
  text: string
  status: 'proposed' | 'kept'
  at: number
}

export type Step = {
  kind: 'test' | 'build' | 'check' | 'commit' | 'push' | 'install' | 'git' | 'command'
  label: string
  ok: boolean
}

export type Turn = {
  id: string
  at: number
  durationMs: number
  edited: string[]
  created: string[]
  reads: number
  searches: number
  steps: Step[]
  tests?: { passed: number; failed: number }
  isVerified: boolean
  claimsDone: boolean
  lines: string[]
}

export type Tab = 'usage' | 'tasks' | 'decisions' | 'changes'

declare module 'claude-code' {
  interface PluginState {
    'atlas-hud': {
      usage: Shaped<Usage>
      tasks: Shaped<Task[]>
      decisions: Shaped<Decision[]>
      turns: Shaped<Turn[]>
      tab: Tab
    }
  }
}

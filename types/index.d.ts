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

export type Tab = 'overview' | 'work' | 'agents' | 'timeline'

// ---- Agents feature types (agents.tsx) ----



// ---- Git feature types (git.tsx) ----

export type GitCommit = { sha: string; subject: string }

export type GitInfo = {
  /** unknown: not read yet; none: not a repository, or git is missing. */
  status: 'unknown' | 'none' | 'repo'
  branch?: string
  isDetached?: boolean
  headSha?: string
  upstream?: string
  ahead: number
  behind: number
  /** The newest unpushed commits, at most 5. */
  unpushed: GitCommit[]
  unpushedCount: number
  uncommitted: number
  lastCommit?: string
  at: number
}


// ---- Timeline feature types (timeline.tsx) ----



// ---- Theme feature types (icons.tsx, chrome.tsx, transcript.tsx) ----




declare module 'claude-code' {
  interface PluginState {
    'atlas-hud': {
      usage: Shaped<Usage>
      tasks: Shaped<Task[]>
      decisions: Shaped<Decision[]>
      turns: Shaped<Turn[]>
      tab: Tab

      // ---- Agents feature state ----


      // ---- Git feature state ----
      git: Shaped<GitInfo>
      doneDismissed: string[]


      // ---- Timeline feature state ----


      // ---- Theme feature state ----


    }
  }
}

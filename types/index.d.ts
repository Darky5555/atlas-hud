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

/**
 * Where an agent's loop stands: the engine's AgentStatus, spelled out (the
 * contract may not import). agents.tsx assigns AgentInfo's status to it with
 * no cast, so the type-check fails if the engine adds a status.
 */
export type AgentRunStatus = 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'

/** One subagent or teammate of this session, as the Agents tab keeps it. */
export type AgentRun = {
  /** The engine's agent id (`$.agent.list()` id, the events' `agentId`). */
  id: string
  name?: string
  type?: string
  description?: string
  /** The agent whose loop spawned it; absent when the main loop did. */
  parentId?: string
  isTeammate?: boolean
  status: AgentRunStatus
  /**
   * Whether the tab last heard this loop's turn start (true) or end (false);
   * absent when it heard neither (a teammate in a pane of its own). Where it is
   * set, the tab's own word outranks a `$.agent.list()` that lags it.
   */
  turnOpen?: boolean
  /** When it was first seen (ms); its end when it last finished a turn. */
  startedAt: number
  endedAt?: number
  /** The tool it is running now, if any. */
  tool?: string
  /** Tool calls so far. */
  tools: number
  /** Tokens across its turns (input, cache and output). */
  tokens: number
  /** The first two lines of its last report. */
  report?: string[]
  /** Last change (ms): which records give way past the bound. */
  at: number
}


// ---- Git feature types (git.tsx) ----

export type GitCommit = { sha: string; subject: string }

export type GitInfo = {
  /** unknown: not read yet; none: not a repository, or git is missing. */
  status: 'unknown' | 'none' | 'repo'
  branch?: string
  isDetached?: boolean
  headSha?: string
  upstream?: string
  /** The upstream is set but no longer exists (deleted on the remote, pruned). */
  isUpstreamGone?: boolean
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
      agents: Shaped<AgentRun[]>

      // ---- Git feature state ----
      git: Shaped<GitInfo>
      doneDismissed: string[]


      // ---- Timeline feature state ----


      // ---- Theme feature state ----


    }
  }
}

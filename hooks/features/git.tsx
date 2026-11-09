// Git and the done-check: the branch, what is not pushed or not committed yet,
// and a warning above the prompt when Claude says done without checking.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderSurface, SessionStartInput, ToolCallInput, ToolCallResult, TurnCompleteInput, TurnStartInput } from 'claude-code'

import type { GitCommit, GitInfo, Turn } from '../../types'
import { verdict } from '../lib'
import type { IconName } from '../ui/icons'
import { Icon } from '../ui/icons'
import type { Els, On } from '../ui/kit'
import { Section, str } from '../ui/kit'
import { C } from '../ui/theme'

const EMPTY_GIT: GitInfo = { status: 'unknown', ahead: 0, behind: 0, unpushed: [], unpushedCount: 0, uncommitted: 0, at: 0 }

export const git = atom({ plugin: 'atlas-hud', key: 'git' } as const, EMPTY_GIT, { shape: 'git-1' })
// The timeline feature's turns, declared here too: read() takes only an atom the
// engine's scan can resolve in this file.
const turns = atom({ plugin: 'atlas-hud', key: 'turns' } as const, [] as Turn[], { shape: 'turns-1' })
export const doneDismissed = atom({ plugin: 'atlas-hud', key: 'doneDismissed' } as const, [] as string[])

const MAX_UNPUSHED = 5
const MIN_GAP_MS = 2000
const GIT_TIMEOUT_MS = 3000

export const registerGit = (_on: On) => {}

// ---------- Parsing (pure; the tests call these directly) ----------

/**
 * `git status --porcelain=v2 --branch`: branch, upstream, ahead/behind, changed
 * paths. An upstream that is set but no longer exists (deleted on the remote,
 * then pruned) comes without its `# branch.ab` line: `isUpstreamGone`.
 */
export const parseStatus = (out: string) => {
  let head: string | undefined
  let oid: string | undefined
  let upstream: string | undefined
  let ahead = 0
  let behind = 0
  let changes = 0
  let hasAb = false
  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.head ')) head = line.slice('# branch.head '.length).trim()
    else if (line.startsWith('# branch.oid ')) oid = line.slice('# branch.oid '.length).trim()
    else if (line.startsWith('# branch.upstream ')) upstream = line.slice('# branch.upstream '.length).trim()
    else if (line.startsWith('# branch.ab ')) {
      hasAb = true
      const m = line.match(/\+(\d+)\s+-(\d+)/)
      if (m) {
        ahead = Number(m[1])
        behind = Number(m[2])
      }
    } else if (line.trim() && !line.startsWith('#')) changes += 1
  }
  return { head, oid, upstream, isUpstreamGone: upstream !== undefined && !hasAb, ahead, behind, changes }
}

/** `git log --format=%h%x09%s`: one commit per line. */
export const parseLog = (out: string): GitCommit[] =>
  out
    .split('\n')
    .filter(l => l.trim())
    .map(l => {
      const at = l.indexOf('\t')
      return at < 0 ? { sha: l.trim(), subject: '' } : { sha: l.slice(0, at).trim(), subject: l.slice(at + 1).trim() }
    })

// ---------- Collecting ----------

/**
 * One git command: its output on exit 0; `undefined` on any other exit (not a
 * repository, no upstream); `null` when git could not run at all (missing,
 * refused, or killed at the timeout).
 */
async function runGit($: EngineInterface, args: string[], cwd: string | undefined): Promise<string | undefined | null> {
  try {
    const r = await $.process.run(['git', ...args], {
      ...(cwd ? { cwd } : {}),
      env: { GIT_OPTIONAL_LOCKS: '0' },
      timeoutMs: GIT_TIMEOUT_MS,
    })
    return r.exitCode === 0 && typeof r.stdout === 'string' ? r.stdout : undefined
  } catch {
    return null
  }
}

async function sessionCwd($: EngineInterface) {
  try {
    return await $.session.cwd()
  } catch {
    return undefined
  }
}

async function nowMs($: EngineInterface) {
  try {
    return await $.clock.now()
  } catch {
    return Date.now()
  }
}

/**
 * Reads the repository in the session's directory; `status: 'none'` outside
 * one. `undefined` when git itself could not run (the caller keeps what it had).
 */
export async function collectGit($: EngineInterface): Promise<GitInfo | undefined> {
  // The session's directory, not `session.repo().root`: in a worktree that is
  // the main working tree's root, a different branch.
  const cwd = await sessionCwd($)
  const at = await nowMs($)
  const status = await runGit($, ['status', '--porcelain=v2', '--branch'], cwd)
  if (status === null) return undefined
  if (status === undefined) return { ...EMPTY_GIT, status: 'none', at }

  const s = parseStatus(status)
  const hasCommits = s.oid !== undefined && s.oid !== '(initial)'
  const isDetached = s.head === '(detached)'
  // A gone upstream can't be compared against: count what is on no remote.
  const isTracking = s.upstream !== undefined && !s.isUpstreamGone
  const range = isTracking ? ['@{upstream}..HEAD'] : ['HEAD', '--not', '--remotes']

  const [last, unpushed, count] = hasCommits
    ? await Promise.all([
        runGit($, ['log', '-1', '--format=%h%x09%s'], cwd),
        runGit($, ['log', '--format=%h%x09%s', '-n', String(MAX_UNPUSHED), ...range], cwd),
        isTracking ? Promise.resolve(undefined) : runGit($, ['rev-list', '--count', ...range], cwd),
      ])
    : [undefined, undefined, undefined]

  const lastCommit = typeof last === 'string' ? parseLog(last)[0] : undefined
  const list = typeof unpushed === 'string' ? parseLog(unpushed) : []
  const counted = typeof count === 'string' && /^\s*\d+\s*$/.test(count) ? Number(count.trim()) : NaN
  return {
    status: 'repo',
    branch: isDetached ? undefined : s.head,
    isDetached,
    headSha: hasCommits ? s.oid?.slice(0, 7) : undefined,
    upstream: s.upstream,
    isUpstreamGone: s.isUpstreamGone,
    ahead: s.ahead,
    behind: s.behind,
    unpushed: list.slice(0, MAX_UNPUSHED),
    unpushedCount: isTracking ? s.ahead : Number.isFinite(counted) ? counted : list.length,
    uncommitted: s.changes,
    lastCommit: lastCommit?.subject || undefined,
    at,
  }
}

// At most one refresh in flight, and none within 2s of the last after a tool
// call; every main-loop turn ends with a forced one, which catches up what was
// skipped and what changed without a git command or an edit (rm, a formatter,
// git outside Claude). Once git
// could not run at all (missing, or too slow), tool calls stop waiting on it
// until a refresh at the end of a turn or a session start works again.
let inFlight: Promise<void> | undefined
let lastAt = Number.NEGATIVE_INFINITY
let stale = false
let isBackedOff = false

async function runRefresh($: EngineInterface) {
  try {
    const info = await collectGit($)
    isBackedOff = info === undefined
    if (info) await update($, git, () => info)
    // Git could not run: keep what was read before; with nothing read yet,
    // say there is no repository rather than draw nothing.
    else await update($, git, g => (g.status === 'unknown' ? { ...EMPTY_GIT, status: 'none' as const, at: g.at } : g))
  } catch {
    // Never let git trouble reach the tool call or the turn.
  }
}

export async function refreshGit($: EngineInterface, force: boolean) {
  if (inFlight) {
    stale = true
    return
  }
  const now = await nowMs($)
  if (!force && now - lastAt < MIN_GAP_MS) {
    stale = true
    return
  }
  lastAt = now
  stale = false
  const run = runRefresh($)
  inFlight = run
  try {
    await run
  } finally {
    inFlight = undefined
  }
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** Whether a finished tool call can have changed what git reports. */
export const touchesGit = (tool: string, command: string) => EDIT_TOOLS.has(tool) || (tool === 'Bash' && /\bgit\b/.test(command))

// ---------- The shared events, called from register.tsx (see hub.ts) ----------

export async function gitSessionStart($: EngineInterface, _e: SessionStartInput) {
  await refreshGit($, true)
}

export function gitTurnStart(_$: EngineInterface, _e: TurnStartInput) {}

export function gitToolStart(_$: EngineInterface, _e: ToolCallInput) {}

export async function gitToolEnd($: EngineInterface, e: ToolCallInput, _ran: ToolCallResult) {
  const input = e as unknown as Record<string, unknown>
  if (!touchesGit(String(e.tool), str(input.command))) return
  if (isBackedOff) stale = true
  else await refreshGit($, false)
}

/** On the main loop, a string returned is shown beneath the answer. */
export async function gitTurnComplete($: EngineInterface, e: TurnCompleteInput): Promise<string | undefined> {
  if (e.agentId !== undefined) return undefined
  // A refresh still running started before the turn's last changes: read again after it.
  if (inFlight) await inFlight
  await refreshGit($, true)
  return undefined
}

// ---------- Drawing ----------

const GitChip = ({ el, surface, icon, color, text }: { el: Els; surface: RenderSurface; icon?: IconName; color: string; text: string }) => (
  <el.Box flexDirection="row" gap={1} borderStyle="round" borderColor={color} paddingX={1}>
    {icon && <Icon el={el} surface={surface} name={icon} color={color} />}
    <el.Text mono tabular size="footnote" color={color}>
      {text}
    </el.Text>
  </el.Box>
)

const plural = (n: number, one: string) => `${n.toLocaleString('en-US')} ${one}`

/** The git block on the Overview tab; undefined draws nothing. */
export async function gitPanel($: EngineInterface, el: Els, surface: RenderSurface): Promise<any> {
  const g = await read($, git)
  if (g.status === 'unknown') return undefined
  if (g.status === 'none') {
    return (
      <Section el={el} surface={surface} icon="git" title="Git">
        <el.Text color={C.text2}>No git repository here.</el.Text>
      </Section>
    )
  }

  const hasUnpushed = g.unpushedCount > 0
  const isTracking = g.upstream !== undefined && !g.isUpstreamGone
  // A detached HEAD has no upstream by nature: no note for it.
  const upstreamNote = g.isUpstreamGone
    ? `Upstream ${g.upstream} is gone${hasUnpushed ? ': these commits are on no remote' : ''}`
    : !g.upstream && !g.isDetached
      ? hasUnpushed
        ? 'No upstream: not pushed anywhere yet'
        : 'No upstream set'
      : undefined
  const name = g.isDetached ? `detached at ${g.headSha ?? 'HEAD'}` : (g.branch ?? 'unknown branch')
  return (
    <Section el={el} surface={surface} icon="git" title="Git">
      <el.Box flexDirection="column" gap={1} borderStyle="round" borderColor={C.line} backgroundColor={C.panel} paddingX={1}>
        <el.Box flexDirection="row" flexWrap="wrap" gap={1}>
          <Icon el={el} surface={surface} name="branch" color={C.teal} />
          <el.Text weight="semibold" color={C.text}>
            {name}
          </el.Text>
          {g.upstream && !g.isUpstreamGone && <el.Text color={C.text2}>tracks {g.upstream}</el.Text>}
        </el.Box>

        <el.Box flexDirection="row" flexWrap="wrap" gap={1}>
          {hasUnpushed && <GitChip el={el} surface={surface} icon="push" color={C.orange} text={`${plural(g.unpushedCount, 'unpushed')}`} />}
          {g.uncommitted > 0 ? (
            <GitChip el={el} surface={surface} icon="dirty" color={C.gold} text={`${plural(g.uncommitted, 'uncommitted')}`} />
          ) : (
            <GitChip el={el} surface={surface} icon="clean" color={C.green} text="clean" />
          )}
          {isTracking && g.behind > 0 && <GitChip el={el} surface={surface} color={C.gold} text={`↓${g.behind} behind`} />}
          {isTracking && !hasUnpushed && g.behind === 0 && <GitChip el={el} surface={surface} icon="check" color={C.green} text="in sync" />}
        </el.Box>

        {upstreamNote && (
          <el.Box flexDirection="row" gap={1}>
            <Icon el={el} surface={surface} name="push" color={C.orange} />
            <el.Text color={C.orange}>{upstreamNote}</el.Text>
          </el.Box>
        )}

        {hasUnpushed && g.unpushed.length > 0 && (
          <el.Box flexDirection="column">
            <el.Text mono size="caption" color={C.text2}>
              NOT PUSHED
            </el.Text>
            {g.unpushed.map(c => (
              <el.Box key={`git-unpushed-${c.sha}`} flexDirection="row" gap={1}>
                <Icon el={el} surface={surface} name="commit" color={C.gold} />
                <el.Text mono color={C.gold}>
                  {c.sha}
                </el.Text>
                <el.Text color={C.text} wrap="truncate-end">
                  {c.subject}
                </el.Text>
              </el.Box>
            ))}
            {g.unpushedCount > g.unpushed.length && (
              <el.Text color={C.text2} dimColor>
                and {(g.unpushedCount - g.unpushed.length).toLocaleString('en-US')} more
              </el.Text>
            )}
          </el.Box>
        )}

        {g.lastCommit && (
          <el.Box flexDirection="row" gap={1}>
            <Icon el={el} surface={surface} name="commit" color={C.text2} />
            <el.Text color={C.text2}>Last commit: {g.lastCommit}</el.Text>
          </el.Box>
        )}
      </el.Box>
    </Section>
  )
}

export function dismissDone($: EngineInterface, turnId: string) {
  return update($, doneDismissed, l => [...l.filter(id => id !== turnId), turnId].slice(-30))
}

/** A done-check warning for the band above the prompt; undefined draws nothing. */
export async function doneBand($: EngineInterface, el: Els, surface: RenderSurface): Promise<any> {
  const latest = (await read($, turns)).at(-1)
  if (!latest || verdict(latest)?.tone !== 'warn') return undefined
  if ((await read($, doneDismissed)).includes(latest.id)) return undefined
  return (
    <el.Box flexDirection="row" flexWrap="wrap" gap={1} borderStyle="round" borderColor={C.gold} paddingX={1}>
      <Icon el={el} surface={surface} name="warning" color={C.gold} isLive />
      <el.Text mono size="caption" color={C.gold}>
        DONE CHECK
      </el.Text>
      <el.Text color={C.text}>Claude said done, but nothing was run to check it</el.Text>
      <el.Button key={`done-dismiss-${latest.id}`} label="Dismiss" onPress={() => dismissDone($, latest.id)} />
    </el.Box>
  )
}

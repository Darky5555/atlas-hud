import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { parseLog, parseStatus, touchesGit } from '../hooks/features/git'

const NOW = Date.parse('2026-11-05T12:00:00Z')
const GIT_TIMEOUT_MS = 3000
/** How long after a tool call or a turn end the git read runs. */
const SOON = 300

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const
// The band above the prompt is raised on these two only.
const BAND_SURFACES = ['terminal', 'desktop'] as const

const PANE = {
  plugin: 'atlas-hud',
  component: 'Pane',
  requestId: 'atlas-hud',
  props: {
    title: 'Atlas HUD',
    isFocused: false,
    bodyColumns: 44,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const BAND = {
  plugin: 'atlas-hud',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 100, scroll: { offset: 0, bodyRows: 8 }, view: {} },
} as const

// ---------- A repository the test describes, answered as git would ----------

type Repo = {
  /** Not a repository: every command exits 128. */
  isRepo?: boolean
  /** git cannot run at all: the call rejects. */
  isMissing?: boolean
  /** These subcommands (`status`, `rev-list`, ...) run past the timeout: the call rejects 3s later. */
  timesOut?: string[]
  branch?: string
  upstream?: string
  /** The upstream is set but was deleted on the remote: no `# branch.ab`, and `@{upstream}` fails. */
  isUpstreamGone?: boolean
  ahead?: number
  behind?: number
  /** Newest first. */
  commits?: { sha: string; subject: string }[]
  /** How many of `commits` (from the newest) are not pushed. */
  unpushed?: number
  /** Changed or untracked paths. */
  changes?: string[]
}

const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
const fail = (stderr: string) => ({ exitCode: 128, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false })

/** What `git <args>` prints for the repository, as the engine's `$.process.run` resolves it. */
const answer = (repo: Repo, argv: readonly string[]) => {
  if (repo.isRepo === false) return fail('fatal: not a git repository (or any of the parent directories): .git')
  const [cmd, ...rest] = argv.slice(1)
  const commits = repo.commits ?? []
  const lines = (list: { sha: string; subject: string }[]) => list.map(c => `${c.sha}\t${c.subject}`).join('\n') + (list.length ? '\n' : '')
  if (cmd === 'status') {
    const out = [`# branch.oid ${commits[0] ? `${commits[0].sha}0000000000000000000000000000000` : '(initial)'}`, `# branch.head ${repo.branch ?? 'main'}`]
    if (repo.upstream) out.push(`# branch.upstream ${repo.upstream}`)
    if (repo.upstream && !repo.isUpstreamGone) out.push(`# branch.ab +${repo.ahead ?? 0} -${repo.behind ?? 0}`)
    for (const path of repo.changes ?? []) out.push(path.startsWith('?') ? `? ${path.slice(1)}` : `1 .M N... 100644 100644 100644 aaaaaaa bbbbbbb ${path}`)
    return ok(`${out.join('\n')}\n`)
  }
  if (cmd === 'log') {
    if (rest[0] === '-1') return ok(lines(commits.slice(0, 1)))
    const n = Number(rest[rest.indexOf('-n') + 1])
    if (rest.includes('@{upstream}..HEAD') && (!repo.upstream || repo.isUpstreamGone)) return fail("fatal: ambiguous argument '@{upstream}..HEAD'")
    return ok(lines(commits.slice(0, Math.min(n, repo.unpushed ?? 0))))
  }
  if (cmd === 'rev-list') return ok(`${repo.unpushed ?? 0}\n`)
  return fail(`unexpected: git ${argv.slice(1).join(' ')}`)
}

type World = {
  repo: Repo
  calls: string[]
  /** How long each git command takes to answer, on the mocked clock. */
  delayMs?: number
}

/**
 * Stands for the engine beneath the plugin: the session, the pane, the clock,
 * and git through `$.process.run`, answered from `world.repo`.
 */
const engine = (on: On, world: World) => {
  const clock = mock.clock(on, { now: NOW })
  on('command.register', () => ({ value: { command: 'hud' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/work/repo' }))
  on('process.run', async (_, e) => {
    world.calls.push(e.argv.join(' '))
    if (world.repo.isMissing) throw new Error('spawn git ENOENT')
    if (world.repo.timesOut?.includes(e.argv[1] ?? '')) {
      await clock.sleep(GIT_TIMEOUT_MS)
      throw new Error('git timed out')
    }
    if (world.delayMs) await clock.sleep(world.delayMs)
    return { value: answer(world.repo, e.argv) }
  })
  return clock
}

/** Starts the session and lets the git read it scheduled run. */
const start = async (
  $: { session: { start: (e: { cwd: string; surface: 'desktop'; isInteractive: boolean }) => Promise<unknown> } },
  clock: { settle: () => Promise<void> },
) => {
  await $.session.start({ cwd: '/work/repo', surface: 'desktop', isInteractive: true })
  await clock.settle()
}

const statusCalls = (world: World) => world.calls.filter(c => c.startsWith('git status')).length

const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) => (await ui.findAll({ type: 'Text' })).map(t => t.text)

// ---------- Parsing ----------

test('git status --porcelain=v2 --branch parses branch, upstream, ahead/behind and changes', async () => {
  const s = parseStatus(
    [
      '# branch.oid 1a2b3c4d5e6f',
      '# branch.head feat/atlas',
      '# branch.upstream origin/feat/atlas',
      '# branch.ab +3 -1',
      '1 .M N... 100644 100644 100644 aaa bbb hooks/a.ts',
      '2 R. N... 100644 100644 100644 aaa bbb R100 b.ts\ta.ts',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc c.ts',
      '? notes.txt',
      '',
    ].join('\n'),
  )
  expect(s).toEqual({ head: 'feat/atlas', oid: '1a2b3c4d5e6f', upstream: 'origin/feat/atlas', isUpstreamGone: false, ahead: 3, behind: 1, changes: 4 })
  expect(parseStatus('# branch.oid (initial)\n# branch.head main\n')).toEqual({
    head: 'main',
    oid: '(initial)',
    upstream: undefined,
    isUpstreamGone: false,
    ahead: 0,
    behind: 0,
    changes: 0,
  })
  // An upstream deleted on the remote: git prints it but no ahead/behind line.
  expect(parseStatus('# branch.oid 1a2b3c4d5e6f\n# branch.head master\n# branch.upstream origin/main\n')).toEqual({
    head: 'master',
    oid: '1a2b3c4d5e6f',
    upstream: 'origin/main',
    isUpstreamGone: true,
    ahead: 0,
    behind: 0,
    changes: 0,
  })
})

test('git log lines parse into commits, a subject with tabs kept whole', async () => {
  expect(parseLog('abc1234\tFix the band\ndef5678\tSplit\ton tabs\n\n')).toEqual([
    { sha: 'abc1234', subject: 'Fix the band' },
    { sha: 'def5678', subject: 'Split\ton tabs' },
  ])
  expect(parseLog('')).toEqual([])
})

test('only edits and git commands refresh git', async () => {
  expect(touchesGit('Edit', '')).toBe(true)
  expect(touchesGit('Write', '')).toBe(true)
  expect(touchesGit('Bash', 'git commit -m x')).toBe(true)
  expect(touchesGit('Bash', 'ls -la')).toBe(false)
  expect(touchesGit('Read', '')).toBe(false)
})

// ---------- The Overview panel ----------

test('the panel shows the branch, unpushed commits and uncommitted changes on every surface', async ($, on) => {
  const world = {
    calls: [] as string[],
    repo: {
      branch: 'feat/atlas',
      upstream: 'origin/feat/atlas',
      ahead: 2,
      commits: [
        { sha: 'abc1234', subject: 'Draw the git panel' },
        { sha: 'def5678', subject: 'Parse porcelain v2' },
        { sha: '0123456', subject: 'Older, pushed' },
      ],
      unpushed: 2,
      changes: ['hooks/a.ts', 'hooks/b.ts', '?notes.txt'],
    } as Repo,
  }
  const clock = engine(on, world)
  await start($, clock)

  expect(world.calls[0]).toBe('git status --porcelain=v2 --branch')
  expect(world.calls).toContain('git log --format=%h%x09%s -n 5 @{upstream}..HEAD')

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const t = await texts(ui)
    expect(t).toContain('GIT')
    expect(t).toContain('feat/atlas')
    expect(t).toContain('tracks origin/feat/atlas')
    expect(t).toContain('2 unpushed')
    expect(t).toContain('3 uncommitted')
    expect(t).toContain('NOT PUSHED')
    expect(t).toContain('abc1234')
    expect(t).toContain('Parse porcelain v2')
    expect(t.includes('Older, pushed')).toBe(false)
    expect(t.includes('in sync')).toBe(false)
    expect(t).toContain('Last commit: Draw the git panel')
    await ui.unmount()
  }
})

test('a branch with no upstream says so and counts what is not pushed anywhere', async ($, on) => {
  const commits = Array.from({ length: 7 }, (_, i) => ({ sha: `c0ffee${i}`, subject: `Commit ${7 - i}` }))
  const world = { calls: [] as string[], repo: { branch: 'local-only', commits, unpushed: 7 } as Repo }
  const clock = engine(on, world)
  await start($, clock)

  expect(world.calls).toContain('git rev-list --count HEAD --not --remotes')
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const t = await texts(ui)
    expect(t).toContain('local-only')
    expect(t).toContain('No upstream: not pushed anywhere yet')
    expect(t).toContain('7 unpushed')
    expect(t).toContain('clean')
    // Five are listed, the rest counted.
    expect(t).toContain('c0ffee4')
    expect(t.includes('c0ffee5')).toBe(false)
    expect(t).toContain('and 2 more')
    await ui.unmount()
  }
})

test('a count that times out on a long local-only history reads as at least the listed five', async ($, on) => {
  const commits = Array.from({ length: 7 }, (_, i) => ({ sha: `c0ffee${i}`, subject: `Commit ${7 - i}` }))
  const world: World = { calls: [], repo: { branch: 'local-only', commits, unpushed: 7, timesOut: ['rev-list'] } }
  const clock = engine(on, world)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await start($, clock)
  await clock.advance(GIT_TIMEOUT_MS)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const t = await texts(ui)
    expect(t).toContain('5+ unpushed')
    expect(t.includes('5 unpushed')).toBe(false)
    expect(t).toContain('c0ffee4')
    expect(t.some(x => /and \d+ more/.test(x))).toBe(false)
    await ui.unmount()
  }

  // Once slow, the count is not asked again this session.
  const revLists = () => world.calls.filter(c => c.startsWith('git rev-list')).length
  expect(revLists()).toBe(1)
  await $.turn.start({ text: 'go', turnId: 'c1' })
  await $.turn.complete({ answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 'c1', reason: 'answer' })
  await clock.advance(SOON)
  expect(statusCalls(world)).toBe(2)
  expect(revLists()).toBe(1)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await texts(ui)).toContain('5+ unpushed')
  await ui.unmount()
})

test('a branch whose upstream is gone says so and counts what is on no remote', async ($, on) => {
  const commits = [
    { sha: 'abc1234', subject: 'Local one' },
    { sha: 'def5678', subject: 'Local two' },
    { sha: '0123456', subject: 'Pushed long ago' },
  ]
  const world = { calls: [] as string[], repo: { branch: 'master', upstream: 'origin/main', isUpstreamGone: true, commits, unpushed: 2 } as Repo }
  const clock = engine(on, world)
  await start($, clock)

  expect(world.calls).toContain('git rev-list --count HEAD --not --remotes')
  expect(world.calls.some(c => c.includes('@{upstream}'))).toBe(false)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const t = await texts(ui)
    expect(t).toContain('master')
    expect(t).toContain('Upstream origin/main is gone: these commits are on no remote')
    expect(t).toContain('2 unpushed')
    expect(t).toContain('Local two')
    expect(t.some(x => /in sync|tracks |No upstream/.test(x))).toBe(false)
    await ui.unmount()
  }
})

test('a gone upstream with nothing local reads gone, not in sync', async ($, on) => {
  const world = {
    calls: [] as string[],
    repo: { branch: 'master', upstream: 'origin/main', isUpstreamGone: true, commits: [{ sha: 'abc1234', subject: 'x' }], unpushed: 0 } as Repo,
  }
  const clock = engine(on, world)
  await start($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const t = await texts(ui)
  expect(t).toContain('Upstream origin/main is gone')
  expect(t.some(x => /in sync|unpushed/.test(x))).toBe(false)
  await ui.unmount()
})

test('a branch with no upstream and nothing unpushed says only that no upstream is set', async ($, on) => {
  const world = { calls: [] as string[], repo: { branch: 'scratch', commits: [{ sha: 'abc1234', subject: 'x' }], unpushed: 0 } as Repo }
  const clock = engine(on, world)
  await start($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  const t = await texts(ui)
  expect(t).toContain('No upstream set')
  expect(t.some(x => /not pushed anywhere|unpushed/.test(x))).toBe(false)
  await ui.unmount()
})

test('a branch level with its upstream reads in sync and clean', async ($, on) => {
  const world = {
    calls: [] as string[],
    repo: { branch: 'main', upstream: 'origin/main', commits: [{ sha: 'abc1234', subject: 'Ship it' }], unpushed: 0 } as Repo,
  }
  const clock = engine(on, world)
  await start($, clock)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const t = await texts(ui)
    expect(t).toContain('main')
    expect(t).toContain('in sync')
    expect(t).toContain('clean')
    expect(t.some(x => /unpushed|uncommitted|NOT PUSHED|No upstream/.test(x))).toBe(false)
    await ui.unmount()
  }
})

test('behind its upstream, the panel says how far', async ($, on) => {
  const world = {
    calls: [] as string[],
    repo: { branch: 'main', upstream: 'origin/main', behind: 3, commits: [{ sha: 'abc1234', subject: 'Ship it' }], unpushed: 0 } as Repo,
  }
  const clock = engine(on, world)
  await start($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const t = await texts(ui)
  expect(t).toContain('↓3 behind')
  expect(t.includes('in sync')).toBe(false)
  await ui.unmount()
})

test('a detached HEAD is named by its commit', async ($, on) => {
  const world = { calls: [] as string[], repo: { branch: '(detached)', commits: [{ sha: 'abc1234', subject: 'Bisect here' }], unpushed: 0 } as Repo }
  const clock = engine(on, world)
  await start($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const t = await texts(ui)
  expect(t).toContain('detached at abc1234')
  expect(t.includes('(detached)')).toBe(false)
  // A detached HEAD has no upstream by nature: no note about one.
  expect(t.some(x => /No upstream/.test(x))).toBe(false)
  await ui.unmount()
})

test('outside a repository the panel says so on every surface', async ($, on) => {
  const world = { calls: [] as string[], repo: { isRepo: false } as Repo }
  const clock = engine(on, world)
  await start($, clock)

  // Not a repository: one status call, nothing more asked.
  expect(world.calls).toEqual(['git status --porcelain=v2 --branch'])
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const t = await texts(ui)
    expect(t).toContain('No git repository here.')
    expect(t.includes('NOT PUSHED')).toBe(false)
    await ui.unmount()
  }
})

test('before git is read the Overview draws no git block', async ($, on) => {
  mock.clock(on, { now: NOW })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const t = await texts(ui)
  expect(t.includes('GIT')).toBe(false)
  expect(t.includes('No git repository here.')).toBe(false)
  await ui.unmount()
})

// ---------- Refreshing ----------

test('an edit or a git command refreshes the panel a moment later, at most once in two seconds', async ($, on) => {
  const world: World = {
    calls: [],
    repo: { branch: 'main', upstream: 'origin/main', commits: [{ sha: 'aaa1111', subject: 'One' }], unpushed: 0 },
  }
  const clock = engine(on, world)
  on('tool.call', () => ({ result: { stdout: '', stderr: '' } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await start($, clock)
  expect(statusCalls(world)).toBe(1)

  // A commit lands; the git command asks for a read, which runs a moment later.
  await clock.advance(3000)
  world.repo = { ...world.repo, ahead: 1, commits: [{ sha: 'bbb2222', subject: 'Two' }, ...(world.repo.commits ?? [])], unpushed: 1 }
  await $.tool.call({ tool: 'Bash', command: 'git commit -m Two' })
  expect(statusCalls(world)).toBe(1)
  await clock.advance(SOON)
  expect(statusCalls(world)).toBe(2)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await texts(ui)).toContain('1 unpushed')
  await ui.unmount()

  // A command that is not git asks nothing.
  await clock.advance(3000)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.advance(3000)
  expect(statusCalls(world)).toBe(2)

  // Within the gap an edit's read waits; the end of the turn reads at once,
  // and that one read covers the edit's.
  await $.turn.start({ text: 'edit', turnId: 'r1' })
  await $.tool.call({ tool: 'Bash', command: 'git push' })
  await clock.advance(SOON)
  expect(statusCalls(world)).toBe(3)
  world.repo = { ...world.repo, changes: ['a.ts'] }
  await $.tool.call({ tool: 'Edit', file_path: '/work/repo/a.ts', old_string: 'a', new_string: 'b' })
  await clock.advance(SOON)
  expect(statusCalls(world)).toBe(3)
  await $.turn.complete({ answer: 'Edited.', durationMs: 1000, isAborted: false, turnId: 'r1', reason: 'answer' })
  await clock.advance(SOON)
  expect(statusCalls(world)).toBe(4)
  const after = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await texts(after)).toContain('1 uncommitted')
  await after.unmount()
  await clock.advance(10_000)
  expect(statusCalls(world)).toBe(4)
})

test('the end of a turn reads git again after a command that is not git changed files', async ($, on) => {
  const world: World = {
    calls: [],
    repo: { branch: 'main', upstream: 'origin/main', commits: [{ sha: 'aaa1111', subject: 'One' }], unpushed: 0, changes: ['a.ts'] },
  }
  const clock = engine(on, world)
  on('tool.call', () => ({ result: { stdout: '', stderr: '' } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await start($, clock)
  const before = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await texts(before)).toContain('1 uncommitted')
  await before.unmount()

  await clock.advance(3000)
  await $.turn.start({ text: 'clean up', turnId: 'rm1' })
  world.repo = { ...world.repo, changes: [] }
  await $.tool.call({ tool: 'Bash', command: 'rm a.ts' })
  await $.turn.complete({ answer: 'Removed it.', durationMs: 1000, isAborted: false, turnId: 'rm1', reason: 'answer' })
  await clock.advance(SOON)
  expect(statusCalls(world)).toBe(2)
  const after = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const t = await texts(after)
  expect(t).toContain('clean')
  expect(t.includes('1 uncommitted')).toBe(false)
  await after.unmount()
})

test('a slow git holds neither the tool result nor the turn, and what changed during a read is read after it', async ($, on) => {
  const world: World = {
    calls: [],
    repo: { branch: 'main', upstream: 'origin/main', commits: [{ sha: 'aaa1111', subject: 'One' }], unpushed: 0 },
  }
  const clock = engine(on, world)
  on('tool.call', () => ({ result: { type: 'update', filePath: '/work/repo/a.ts' } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await start($, clock)
  await clock.advance(3000)

  // Each git command now takes a second and a half to answer.
  world.delayMs = 1500
  await $.turn.start({ text: 'edit', turnId: 's1' })
  await $.tool.call({ tool: 'Edit', file_path: '/work/repo/a.ts', old_string: 'a', new_string: 'b' })
  await clock.advance(SOON)
  // The read is under way, waiting on git.
  expect(statusCalls(world)).toBe(2)

  // A tool call and the turn's end come back at once, git still busy.
  world.repo = { ...world.repo, changes: ['a.ts'] }
  const at = clock.now()
  const ran = await $.tool.call({ tool: 'Edit', file_path: '/work/repo/a.ts', old_string: 'b', new_string: 'c' })
  expect((ran as { result?: unknown }).result).toEqual({ type: 'update', filePath: '/work/repo/a.ts' })
  const done = await $.turn.complete({ answer: 'Changed it.', durationMs: 1000, isAborted: false, turnId: 's1', reason: 'answer' })
  expect(done.text?.startsWith('WHAT CHANGED')).toBe(true)
  expect(clock.now()).toBe(at)
  expect(statusCalls(world)).toBe(2)

  // The read in flight finishes (status, then the logs: 3s) and one more follows it.
  await clock.advance(3000 + SOON)
  expect(statusCalls(world)).toBe(3)
  await clock.advance(3000)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await texts(ui)).toContain('1 uncommitted')
  await ui.unmount()
  await clock.advance(10_000)
  expect(statusCalls(world)).toBe(3)
})

test('a git status that times out says git did not answer, not that there is no repository', async ($, on) => {
  const world: World = { calls: [], repo: { branch: 'main', upstream: 'origin/main', commits: [{ sha: 'abc1234', subject: 'x' }], timesOut: ['status'] } }
  const clock = engine(on, world)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await start($, clock)
  await clock.advance(GIT_TIMEOUT_MS)
  expect(statusCalls(world)).toBe(1)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const t = await texts(ui)
    expect(t).toContain('GIT')
    expect(t).toContain('Git did not answer (too slow, or not installed). Trying again later.')
    expect(t.includes('No git repository here.')).toBe(false)
    await ui.unmount()
  }

  // Git answers again: read once the backoff is over, and the note goes.
  world.repo = { ...world.repo, timesOut: [] }
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete({ answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(10_000)
  expect(statusCalls(world)).toBe(2)
  const back = await $.ui.mount({ ...PANE, surface: 'terminal' })
  let t = await texts(back)
  expect(t).toContain('in sync')
  expect(t.some(x => /did not answer/.test(x))).toBe(false)
  await back.unmount()

  // A read that times out after a good one keeps the repository, marked out of date.
  world.repo = { ...world.repo, timesOut: ['status'] }
  await $.turn.start({ text: 'go', turnId: 't2' })
  await $.turn.complete({ answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 't2', reason: 'answer' })
  await clock.advance(SOON + GIT_TIMEOUT_MS)
  expect(statusCalls(world)).toBe(3)
  const stale = await $.ui.mount({ ...PANE, surface: 'desktop' })
  t = await texts(stale)
  expect(t).toContain('main')
  expect(t).toContain('Git did not answer the latest read: this may be out of date.')
  await stale.unmount()
})

test('a failing git never reaches the tool call or the turn, and is retried on a growing interval', async ($, on) => {
  const world: World = { calls: [], repo: { isMissing: true } }
  const clock = engine(on, world)
  on('tool.call', () => ({ result: { type: 'update', filePath: '/work/repo/a.ts' } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await start($, clock)
  expect(world.calls.length).toBe(1)

  // git missing: the panel says git did not answer, not that there is no repository.
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const t = await texts(ui)
  expect(t).toContain('Git did not answer (too slow, or not installed). Trying again later.')
  expect(t.includes('No git repository here.')).toBe(false)
  await ui.unmount()

  await clock.advance(3000)
  await $.turn.start({ text: 'edit', turnId: 'f1' })
  const ran = await $.tool.call({ tool: 'Edit', file_path: '/work/repo/a.ts', old_string: 'a', new_string: 'b' })
  expect(ran.isError === true).toBe(false)
  expect((ran as { result?: unknown }).result).toEqual({ type: 'update', filePath: '/work/repo/a.ts' })

  const done = await $.turn.complete({ answer: 'Changed it.', durationMs: 1000, isAborted: false, turnId: 'f1', reason: 'answer' })
  // The turn ends as it would without git: the timeline's summary beneath the answer.
  expect(done.text?.startsWith('WHAT CHANGED')).toBe(true)
  expect(done.text?.includes('Changed 1 file: a.ts.')).toBe(true)
  // Backed off: nothing is asked of git until 10s after the failure.
  await clock.advance(SOON)
  expect(world.calls.length).toBe(1)
  await clock.advance(7000)
  // Then once for the edit and the turn's end together, failing quietly.
  expect(world.calls.length).toBe(2)

  // A git that works again is read once the next, longer, wait is over (20s).
  world.repo = { branch: 'main', upstream: 'origin/main', commits: [{ sha: 'abc1234', subject: 'Back' }], unpushed: 0 }
  await $.turn.start({ text: 'again', turnId: 'f2' })
  await $.tool.call({ tool: 'Edit', file_path: '/work/repo/a.ts', old_string: 'b', new_string: 'c' })
  await $.turn.complete({ answer: 'Again.', durationMs: 1000, isAborted: false, turnId: 'f2', reason: 'answer' })
  await clock.advance(10_000)
  expect(world.calls.length).toBe(2)
  await clock.advance(10_000)
  expect(statusCalls(world)).toBe(3)
  const back = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await texts(back)).toContain('in sync')
  await back.unmount()
})

test('a git that did not answer is retried by itself while the session is idle', async ($, on) => {
  const world: World = { calls: [], repo: { isMissing: true } }
  const clock = engine(on, world)
  await start($, clock)
  expect(world.calls.length).toBe(1)

  // No tool call and no turn from here on: the retries come on their own, 10s then 20s apart.
  await clock.advance(10_000 - 1000)
  expect(world.calls.length).toBe(1)
  await clock.advance(1000 + SOON)
  expect(world.calls.length).toBe(2)
  await clock.advance(20_000)
  expect(world.calls.length).toBe(3)

  // Git answers again: the next retry (40s on) reads it, and the panel recovers.
  world.repo = { branch: 'main', upstream: 'origin/main', commits: [{ sha: 'abc1234', subject: 'Back' }], unpushed: 0 }
  await clock.advance(40_000 + 3000)
  expect(statusCalls(world)).toBe(4)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const t = await texts(ui)
    expect(t).toContain('in sync')
    expect(t.some(x => /did not answer/.test(x))).toBe(false)
    await ui.unmount()
  }

  // Once it works, an idle session asks nothing more of git.
  const after = world.calls.length
  await clock.advance(10 * 60_000)
  expect(world.calls.length).toBe(after)
})

test('a git that exits non-zero on a later read keeps the tool call whole', async ($, on) => {
  const world: World = { calls: [], repo: { branch: 'main', upstream: 'origin/main', commits: [{ sha: 'abc1234', subject: 'x' }] } }
  const clock = engine(on, world)
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '' } }))
  await start($, clock)
  await clock.advance(3000)
  world.repo = { isRepo: false }
  const ran = await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect((ran as { result?: { stdout?: string } }).result?.stdout).toBe('ok')
  await clock.advance(SOON)
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await texts(ui)).toContain('No git repository here.')
  await ui.unmount()
})

// ---------- The done-check band ----------

test('Claude saying done without a check raises the band, and Dismiss hides it', async ($, on) => {
  const world = { calls: [] as string[], repo: { isRepo: false } as Repo }
  engine(on, world)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: { type: 'update' } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })

  for (const surface of BAND_SURFACES) {
    const id = `done-${surface}`
    await $.turn.start({ text: 'fix it', turnId: id })
    await $.tool.call({ tool: 'Edit', file_path: '/work/repo/a.css', old_string: 'a', new_string: 'b' })
    await $.turn.complete({ answer: 'Fixed, all done.', durationMs: 4000, isAborted: false, turnId: id, reason: 'answer' })

    const band = await $.ui.mount({ ...BAND, surface })
    const t = await texts(band)
    expect(t).toContain('DONE CHECK')
    expect(t).toContain('Claude said done, but nothing was run to check it')
    expect((await band.find({ type: 'Button', key: `done-dismiss-${id}` }))?.text).toBe('Dismiss')
    await band.press({ key: `done-dismiss-${id}` })
    // Dismissed, the band hands back to the engine's own.
    expect((await band.find({ type: 'Text', text: /engine band/ }))?.text).toBe('engine band')
    expect(await band.find({ type: 'Text', text: /DONE CHECK/ })).toBe(undefined)
    await band.unmount()

    // And stays dismissed when drawn again.
    const again = await $.ui.mount({ ...BAND, surface })
    expect(await again.find({ type: 'Text', text: /DONE CHECK/ })).toBe(undefined)
    await again.unmount()
  }
})

test('a turn that ran a check after its edit raises no band', async ($, on) => {
  const world = { calls: [] as string[], repo: { isRepo: false } as Repo }
  engine(on, world)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', (_, e) =>
    (e as { tool: string }).tool === 'Bash' ? { result: { stdout: ' Tests  12 passed (12)', stderr: '' } } : { result: { type: 'update' } },
  )
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })

  await $.turn.start({ text: 'fix it', turnId: 'v1' })
  await $.tool.call({ tool: 'Edit', file_path: '/work/repo/a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'npx vitest run' })
  await $.turn.complete({ answer: 'Fixed, all done.', durationMs: 4000, isAborted: false, turnId: 'v1', reason: 'answer' })

  for (const surface of BAND_SURFACES) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ type: 'Text', text: /DONE CHECK/ })).toBe(undefined)
    expect((await band.find({ type: 'Text', text: /engine band/ }))?.text).toBe('engine band')
    await band.unmount()
  }
})

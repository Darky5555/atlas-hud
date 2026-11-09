# Atlas HUD v2: build plan

The owner wants a heavily themed "Atlas" look (deep-space ink panels, teal and gold accents), real drawn icons (not emoji), animation where the surface allows it, Claude's replies and messages framed in the theme where that can be done reliably, and features that actually get used: an Agents tab, a git panel with a done-check, and a timeline with cost and files.

Pane layout: four tabs, **Overview** (usage + git), **Work** (tasks + decisions), **Agents**, **Timeline**.

## How to check your work

- Load the `plugin-authoring` skill first: it names this build's engine types file (about 14,000 lines; grep it for the names at hand), `reference.md` and the examples.
- `claude plugin test .` runs `tests/*.test.tsx`; `claude plugin validate .` must say "Validation passed". The known warnings (marketplace description, LICENSE, icon) stay: adding a LICENSE is the owner's call.
- Tests cannot show what a drawing looks like. Say so; don't claim visuals were checked.

## Architecture (in place)

- `hooks/register.tsx` only wires: `/hud`, `session.start`, the Pane render hook (the four tabs), the AbovePrompt band (stacks `doneBand` and `decisionBand`), and the shared events.
- `hooks/hub.ts`: `register.tsx` hooks `session.start`, `turn.start`, `tool.call` and `turn.complete` once, and calls each feature's named functions `<feature>SessionStart / TurnStart / ToolStart / ToolEnd / TurnComplete` in turn, each in `guard()`. Every feature file already has these stubs. A string returned from `<feature>TurnComplete` on the main loop is shown beneath the answer.
- `hooks/features/`: `usage`, `work`, `timeline`, `agents`, `git`, `transcript`. `hooks/ui/`: `theme` (palette `C`), `kit` (shared pieces), `icons` (the `<Icon>` contract), `chrome` (`PaneFrame`).
- `types/index.d.ts` is the `$.state` contract, with a marked region per feature.

## Engine rules that already bit us

The engine refuses the module (validate and tests fail) otherwise.

1. A plugin may hook each event once without a matcher. Never `on()` the four shared events in a feature; use your stubs.
2. `$` may only be passed to functions declared at the top level of a file (a function declaration, or a const bound to one) or imported from the mod's own files. No arrays of handlers, no storing `$`.
3. A function that calls `on(...)` must not return a value. `registerX(on)` returns nothing.
4. `read($, atom)` / `update($, atom, fn)` take an atom made with `atom(...)` in the same file (or a literal `{ plugin, key }` reference). To read another feature's state, declare the same atom again locally (same plugin, key and shape), as `git.tsx` does for `turns`.
5. Each `ui.render` component matcher has one owner. AbovePrompt and Pane: `register.tsx`. ToolUse and every other transcript component: `transcript.tsx`.
6. Trees are validated per component. Check each element's props in the types (e.g. `Text` has no `flexShrink`: that once blanked the pane). A tree a component refuses makes the engine skip the hook.
7. Elements differ by surface. Terminal: Box Text Button Input Select Link Code Markdown Client Raster Image, no Svg. Desktop, vscode, mobile: Svg, no Image/Raster. Branch on the surface and degrade. `Svg` with `isInteractive: true` runs SMIL animation in a sandboxed frame.
8. Every `$.state` atom is declared in `types/index.d.ts` under `'atlas-hud'`, in your feature's region.

Colours come from `C` in `hooks/ui/theme.ts`. Icons are drawn only through `<Icon el={el} surface={surface} name="..." isLive? />` with names from `ICONS`.

## Features

Each feature owns its files, adds its own `tests/<feature>.test.tsx`, keeps every existing test passing, and lands as one commit `<Feature>: <what it does>`.

### Icons: `hooks/ui/icons.tsx` (+ `hooks/ui/icons/*`), `tests/icons.test.tsx`

- Every name in `ICONS` gets a hand-authored SVG (24x24 viewBox, consistent ~1.5px stroke, rounded joins, the Atlas palette, layered detail such as orbit rings, star points or a subtle inner fill) so they read as one designed set. Never emoji. The `atlas` brand mark is distinctive (a globe or compass rose with an orbit and a star).
- `isLive` animates with SMIL inside `Svg isInteractive` (agent-running spins an orbit, spark twinkles, check draws its stroke, warning pulses). Static icons are plain `Svg` (cheaper).
- `size` is CSS px on Svg surfaces (default 16); `alt` always set.
- Terminal: a non-emoji Unicode glyph per icon in its colour. Optional terminal animation must never redraw while nothing is live (an optional `frame` prop; a ticker in `iconsSessionStart` via `$.clock.every` only while something is live).
- Add names (append), never rename or remove.
- Tests: every name renders on terminal, desktop, vscode and mobile; a live icon on desktop is an interactive Svg; sources under 131072 chars with no `<script>` or `on*` attributes.

### Theme: `hooks/ui/theme.ts`, `kit.tsx`, `chrome.tsx`, the view functions in `features/usage.tsx` and `features/work.tsx`, `tests/theme.test.tsx`

Already started (commit "WIP: salvaged theme and git work"): palette and ramps, the header with its animated SVG rule, the icon tab bar, Section / Rule / Bar / Gauge / Note. Finish it:

- Restyle `usageView` (limits as gauges with reset and pace notes, context window, cost, with icons) and the Work views: tasks with task-pending/active/done icons and a progress gauge; proposed decisions as gold-bordered cards with keep/drop icons; the kept list; `decisionBand` with the decision icon.
- Keep every Button key (`tab-<key>`, `keep-<id>`, `drop-<id>`, `rm-<id>`, `band-keep-<id>`, `band-drop-<id>`) and all hook logic unchanged. Update `tests/hud.test.tsx` assertions only where visible text intentionally changed.
- Tests: header and tab bar on all four surfaces; tabs switch; the Work tab still keeps and drops decisions.

### Transcript: `hooks/features/transcript.tsx`, `tests/transcript.test.tsx`

- Read each component's props and doc comment (RenderPropsOf: ToolUse, ToolResult, ToolGroup, CommandOutput, Spinner, TurnDuration, PromptHint, SessionMode, UserMessage, AssistantMessage, InfoNotice): what a rewrite or wrapping tree may do, and which surfaces raise it.
- ToolUse: icon + tag line under the row (edit, write, read, test, build, web, agent, terminal, commit, push); FAILED in danger colour; pass through when `isExpanded`.
- Spinner: Atlas wording by mode ("Charting course", "Plotting", "Scanning the stars", "Transmitting"), teal; keep the engine's suffix rules and timer text.
- TurnDuration (terminal): an Atlas closing line.
- UserMessage and AssistantMessage: only wrap the engine's own node (`await next(e)`) in a frame (thin accent bar, small label row). Never rewrite or re-render their text, so code blocks and tables stay intact. Pass through wherever the docs say a wrapper is refused, on `isExpanded`, on `isSummary`. If one can't be wrapped reliably, leave it alone and say why.
- Tests: each hooked component on each surface it's raised on, with a stub engine row beneath; the engine row is still present unchanged; pass-through cases.

### Agents: `hooks/features/agents.tsx`, `tests/agents.test.tsx`

- Data: `$.agent.list()` (id, teammateId, description, type, status, parentId, spawnedBy, name), `agent.spawn` if useful (only this feature may hook it), and the stubs: `agentsTurnStart` / `agentsTurnComplete` (`e.agentId`, duration, usage tokens, the answer as its report), `agentsToolStart` / `agentsToolEnd` (current tool, tool counts). Bounded state (last 40 agents).
- `agentsView`: a tree by parentId; each row has a status icon (agent-running live while running, agent-waiting, agent-done, agent-failed), name or type, description, current tool with its icon, elapsed time, tool-call count, tokens, and the first two lines of its last report. A header with counts (running, done, failed); a helpful empty state.
- Also export `agentsSummary($, el, surface)`: a one-line summary ("2 running · 5 done") or undefined; wire it into Overview in `register.tsx`.
- Tests: simulate an agent's run via `$.tool.call` / `$.turn.start` / `$.turn.complete` with `agentId` (mock `$.agent.list` as the test kit allows); assert the tree, statuses and counts on all four surfaces.

### Git: `hooks/features/git.tsx`, `tests/git.test.tsx`

Already started (same WIP commit): parsing, the debounced refresh, `gitPanel`, `doneBand`. Finish it:

- Write the tests: mock `$.process.run` per the test kit to answer `git status --porcelain=v2 --branch`, `git log`, `git rev-list`; the panel on all four surfaces (branch, unpushed, uncommitted, no-upstream, in sync); the not-a-repo state; the done band shows for an unverified "done" turn, hides on Dismiss (`done-dismiss-<turnId>`), stays hidden for a verified turn.
- Check every element and prop it uses against the types, and that a failing git never reaches the tool call or the turn.

### Timeline: `hooks/features/timeline.tsx`, summary helpers in `hooks/lib.ts` (or `features/timeline-lib.ts`), `tests/timeline.test.tsx`

- Per turn, also keep tokens (`e.usage` on turn.complete, see TurnUsage) and tool counts, as optional fields (older stored turns lack them).
- Fix: sub-minute turns show "0m". Show seconds ("42s", "3m 05s") beneath the answer and in the tab.
- View: (1) a token chart of the last 20 turns, an SVG bar chart on Svg surfaces, a ▁▂▃▄▅▆▇█ sparkline with min/max in the terminal; (2) "Files touched": the 8 files changed most, with counts and edit/write icons; (3) the turn list, newest first, with time, duration, step icons, the plain-English lines and the verdict.
- Keep the summary beneath the answer working.
- Tests: several turns; chart, files and list on all four surfaces; the seconds format; old turns without the new fields.

## Process

1. Build the features in parallel (one agent per feature, each in its own worktree; Theme and Git continue from the WIP commit).
2. Each feature: an independent reviewer runs the tests and validate itself, reads the diff, checks every element, prop and event against the types and the rules above, and returns issues; a fixer fixes high and medium ones; a second review confirms. Up to two rounds.
3. Merge each feature onto `feat/atlas-hud-v2` as one commit (`git merge --squash`), resolving overlaps in `types/index.d.ts`, `register.tsx` wiring and `tests/hud.test.tsx`. Wire `agentsSummary` into Overview.
4. Full test and validate run; one final review of the merged branch (bugs and spec gaps); fix what it finds.
5. Push `feat/atlas-hud-v2` only. Never push to or merge into `main`; no pull request.

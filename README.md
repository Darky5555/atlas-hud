# Atlas HUD

A Claude Code mod in a dark Deep Space theme: ink panels, teal and gold accents. One pane (`/hud`) with four tabs:

- **Usage**: 5-hour and weekly limit gauges with reset times and a pace projection, context-window fill, session cost. Toasts at 75% and 90%, and when one turn uses more than 5% of a limit. The same numbers sit in the status line.
- **Tasks**: Claude's own task list, live, with in-progress items first.
- **Decisions**: decisions Claude proposes (in a hidden comment at the end of a reply), which you Keep or Drop.
- **Changes**: a plain-English summary of each turn: files changed, tests passed and failed, builds, commits, pushes, and whether anything was run to check the change.

Each turn that used tools also gets the same summary as plain text beneath Claude's reply. Tool rows get small tags (EDIT, TEST, PUSH and so on).

## Token cost

- Gauges, tasks, turn summaries, badges, toasts: zero tokens. They are drawn from data the engine already has.
- Decision proposals: one system-prompt line, about 45 tokens per turn, served from the prompt cache after the first turn.
- Compaction guard: open tasks and kept decisions are added to the compaction instructions, once per compaction.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install atlas-hud --marketplace darky5555/atlas-hud
```

Answer `y` to add the marketplace, then pick a scope (user scope is first).

From a shell:

```
claude plugin install atlas-hud --marketplace darky5555/atlas-hud
```

In the Claude desktop app: click + next to the prompt box, then Plugins, Add marketplace with `darky5555/atlas-hud`, then Add plugin.

Then type `/hud` to open the pane.

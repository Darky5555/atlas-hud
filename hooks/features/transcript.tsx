// The transcript: Atlas tags on tool rows, Atlas words on the spinner and the
// closing line, and a thin labelled frame around the person's prompts and the
// opening block of each reply. Every hook here wraps the engine's own node
// (`await next(e)`) or rewrites a prop the engine then draws; none re-draws a
// row's text, so code blocks, tables and tool output stay as the engine drew
// them. Rule 5 of the build plan: this file is the one owner of ToolUse and of
// every other transcript component matcher.
import type { EngineInterface, RenderSurface, SessionStartInput, ToolCallInput, ToolCallResult, TurnCompleteInput, TurnStartInput } from 'claude-code'

import type { Step } from '../../types'
import { classify } from '../lib'
import type { IconName } from '../ui/icons'
import { Icon } from '../ui/icons'
import type { Els, On } from '../ui/kit'
import { str } from '../ui/kit'
import { C } from '../ui/theme'

export const registerTranscript = (on: On) => {
  // A tool call's row: the engine's row, then one quiet line under it with the
  // tag's icon and words. ctrl+o (isExpanded) shows the engine's row alone.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const row = await next(e)
    if (e.props.isExpanded) return row
    const tag = badge(String(e.props.tool), e.props.input)
    if (!tag) return row
    const el = $.ui.resolve(e) as unknown as Els
    const failed = e.props.isErrored && !e.props.isInterrupted
    const color = failed ? C.danger : tag.color
    return (
      <el.Box flexDirection="column">
        {row}
        <el.Box flexDirection="row" gap={1}>
          <Icon el={el} surface={e.surface} name={tag.icon} color={color} isLive={e.props.isRunning} />
          <el.Text mono size="caption" color={color}>
            {failed ? `${tag.label} FAILED` : tag.label}
          </el.Text>
        </el.Box>
      </el.Box>
    )
  })

  // The live line: Atlas words by mode. Only `word` is rewritten, so the
  // engine still draws its glyph, its suffix rules, the timer and the tokens.
  // The spec's teal is not applied: the doc lets a hook rewrite `word`,
  // `message` and `suffix` (text only, no colour prop) or draw a tree in place
  // of the whole line, and a tree would lose the elapsed time, tokens and
  // effort that no prop carries. Keeping the engine's timer wins.
  on('ui.render', { component: 'Spinner' }, async (_$, e, next) => {
    const word = spinnerWord(e.surface, e.props.word, e.props.mode)
    if (word === undefined) return next(e)
    return next({ ...e, props: { ...e.props, word } })
  })

  // The closing line (terminal only): an Atlas word in the engine's own line
  // ("Charted a course for 3s"), with the Atlas mark before it.
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isExpanded || e.props.waitingFor) return next(e)
    const row = await next({ ...e, props: { ...e.props, word: closingWord(e.requestId) } })
    const el = $.ui.resolve(e) as unknown as Els
    return (
      <el.Box flexDirection="row" gap={1}>
        <Icon el={el} surface={e.surface} name="atlas" color={C.teal} />
        {row}
      </el.Box>
    )
  })

  // The person's own prompt, framed: a small label row over the engine's row.
  // Rows from others (notifications, peers, channels) are compact dim lines
  // the engine draws itself; they pass through, as ctrl+o does.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const row = await next(e)
    if (e.props.isExpanded || !isOwnPrompt(e.props.origin.kind)) return row
    const el = $.ui.resolve(e) as unknown as Els
    return <Frame el={el} surface={e.surface} label="YOU" accent={C.gold} columns={e.viewport?.columns} row={row} />
  })

  // A reply, framed once at its first block; later blocks of the same reply
  // and summary blocks pass through.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const row = await next(e)
    if (e.props.isSummary || !e.props.isFirstOfReply) return row
    const el = $.ui.resolve(e) as unknown as Els
    return <Frame el={el} surface={e.surface} label="ATLAS" icon="atlas" accent={C.teal} columns={e.viewport?.columns} row={row} />
  })
}

// ---------- The shared events, called from register.tsx (see hub.ts) ----------

export function transcriptSessionStart(_$: EngineInterface, _e: SessionStartInput) {}

export function transcriptTurnStart(_$: EngineInterface, _e: TurnStartInput) {}

export function transcriptToolStart(_$: EngineInterface, _e: ToolCallInput) {}

export function transcriptToolEnd(_$: EngineInterface, _e: ToolCallInput, _ran: ToolCallResult) {}

/** On the main loop, a string returned is shown beneath the answer. */
export function transcriptTurnComplete(_$: EngineInterface, _e: TurnCompleteInput): string | undefined | Promise<string | undefined> {
  return undefined
}

// ---------- Pieces ----------

/** A label row (icon, CAPS label, a thin accent rule) over the engine's row, which is kept whole. */
const Frame = ({
  el,
  surface,
  label,
  icon,
  accent,
  columns,
  row,
}: {
  el: Els
  surface: RenderSurface
  label: string
  icon?: IconName
  accent: string
  columns?: number
  row: unknown
}) => (
  <el.Box flexDirection="column" gap={0}>
    <el.Box flexDirection="row" gap={1}>
      {icon && <Icon el={el} surface={surface} name={icon} color={accent} />}
      <el.Text mono size="caption" weight="bold" color={accent}>
        {label}
      </el.Text>
      <el.Text color={accent} wrap="truncate-end">
        {'─'.repeat(ruleWidth(columns, label))}
      </el.Text>
    </el.Box>
    {row}
  </el.Box>
)

/** The rule after a label: 24 cells, less where the transcript is narrow. */
export const ruleWidth = (columns: number | undefined, label: string) => Math.max(4, Math.min(24, (columns ?? 80) - label.length - 6))

/** Prompts the person sent: typed at the prompt, from the phone or web bridge, or the SDK host's own turn. */
export const isOwnPrompt = (kind: string) => kind === 'composer' || kind === 'bridge' || kind === 'sdk'

/** The spinner's Atlas word per mode. */
export const SPINNER_WORDS: Record<string, string> = {
  thinking: 'Charting course',
  requesting: 'Scanning the stars',
  'tool-input': 'Plotting',
  'tool-use': 'Plotting',
  responding: 'Transmitting',
}

/**
 * The word to draw, or undefined to leave the engine's. On the desktop the
 * word names the step (`Creating notes.md`), which says more than a theme
 * word, so there only the bare `Working` is replaced. The terminal and vscode
 * send a sampled word (`Sauteing`), which is always replaced.
 */
export const spinnerWord = (surface: RenderSurface, word: string, mode: string) => {
  const atlas = SPINNER_WORDS[mode]
  if (atlas === undefined) return undefined
  if (surface === 'desktop' && word !== 'Working') return undefined
  return atlas
}

/** Past-tense Atlas words for the closing line; the engine draws "<word> for 3s". */
export const CLOSING_WORDS = ['Charted a course', 'Navigated', 'Surveyed the stars', 'Plotted a course', 'Held orbit'] as const

/** One closing word per turn line, the same on every redraw of it. */
export const closingWord = (id: string) => {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return CLOSING_WORDS[h % CLOSING_WORDS.length] ?? CLOSING_WORDS[0]
}

type Tag = { label: string; color: string; icon: IconName }

/** The tag under a tool row: its kind, the file it touched, its colour and icon. */
export function badge(tool: string, input: unknown): Tag | undefined {
  const i = (input ?? {}) as Record<string, unknown>
  const file = (str(i.file_path) || str(i.notebook_path)).split('/').at(-1)
  const at = file ? ` · ${file}` : ''
  switch (tool) {
    case 'Edit':
    case 'NotebookEdit':
      return { label: `EDIT${at}`, color: C.gold, icon: 'edit' }
    case 'Write':
      return { label: `WRITE${at}`, color: C.gold, icon: 'write' }
    case 'Read':
      return { label: `READ${at}`, color: C.text2, icon: 'read' }
    case 'WebSearch':
    case 'WebFetch':
      return { label: 'WEB', color: C.text2, icon: 'web' }
    case 'Agent':
      return { label: 'AGENT', color: C.violet, icon: 'agent' }
    case 'Bash': {
      const k = classify(str(i.command))
      const map: Record<Step['kind'], Tag> = {
        test: { label: 'TEST', color: C.green, icon: 'test' },
        build: { label: 'BUILD', color: C.green, icon: 'build' },
        check: { label: 'CHECK', color: C.green, icon: 'check' },
        commit: { label: 'COMMIT', color: C.orange, icon: 'commit' },
        push: { label: 'PUSH', color: C.orange, icon: 'push' },
        install: { label: 'INSTALL', color: C.text2, icon: 'terminal' },
        git: { label: 'GIT', color: C.text2, icon: 'git' },
        command: { label: 'RUN', color: C.text3, icon: 'terminal' },
      }
      return map[k]
    }
    default:
      return undefined
  }
}

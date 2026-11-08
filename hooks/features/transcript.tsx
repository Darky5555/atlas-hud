// The transcript: tags on tool rows. Wraps the engine's rows, never rewrites
// their text.
import type { Step } from '../../types'
import { classify } from '../lib'
import { C } from '../ui/theme'
import type { On } from '../ui/kit'
import { str } from '../ui/kit'

export const registerTranscript = (on: On) => {
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const row = await next(e)
    if (e.props.isExpanded) return row
    const tag = badge(String(e.props.tool), e.props.input)
    if (!tag) return row
    const { Box, Text } = $.ui.resolve(e)
    const color = e.props.isErrored ? C.danger : tag.color
    return (
      <Box flexDirection="column">
        {row}
        <Text mono size="caption" color={color}>
          {e.props.isErrored ? `${tag.label} FAILED` : tag.label}
        </Text>
      </Box>
    )
  })
}

function badge(tool: string, input: unknown): { label: string; color: string } | undefined {
  const i = (input ?? {}) as Record<string, unknown>
  const file = str(i.file_path).split('/').at(-1)
  switch (tool) {
    case 'Edit':
    case 'NotebookEdit':
      return { label: `EDIT${file ? ` · ${file}` : ''}`, color: C.gold }
    case 'Write':
      return { label: `WRITE${file ? ` · ${file}` : ''}`, color: C.gold }
    case 'WebSearch':
    case 'WebFetch':
      return { label: 'WEB', color: C.text2 }
    case 'Agent':
      return { label: 'AGENT', color: C.text2 }
    case 'Bash': {
      const k = classify(str(i.command))
      const map: Record<Step['kind'], { label: string; color: string } | undefined> = {
        test: { label: 'TEST', color: C.green },
        build: { label: 'BUILD', color: C.green },
        check: { label: 'CHECK', color: C.green },
        commit: { label: 'COMMIT', color: C.orange },
        push: { label: 'PUSH', color: C.orange },
        install: { label: 'INSTALL', color: C.text2 },
        git: { label: 'GIT', color: C.text2 },
        command: undefined,
      }
      return map[k]
    }
    default:
      return undefined
  }
}

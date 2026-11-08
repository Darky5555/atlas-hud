// The engine lets a plugin hook each event once without a matcher, and lets
// `$` reach only functions declared at the top of a file or imported from the
// mod's own files. So register.tsx hooks the events several features share
// (session.start, turn.start, tool.call, turn.complete) once, and calls each
// feature's named function for it in turn: `<feature>SessionStart`,
// `<feature>TurnStart`, `<feature>ToolStart`, `<feature>ToolEnd`,
// `<feature>TurnComplete`. A feature whose function throws is logged to the
// debug log and skipped; the others still run.
import type { EngineInterface } from 'claude-code'

export async function guard<T>($: EngineInterface, name: string, run: () => T | Promise<T>): Promise<T | undefined> {
  try {
    return await run()
  } catch (err) {
    $.ui.log(`atlas-hud: ${name} failed: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
    return undefined
  }
}

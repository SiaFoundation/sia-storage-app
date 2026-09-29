/** What every command module needs: the session the command acts on, and output and argument parsing. */
import { type Command, InvalidArgumentError } from 'commander'
import { defaultSessionName, requireSession, type Session } from '../session'

export type CommandContext = {
  program: Command
  /** The session named by --session, SIM_SESSION, or this checkout. */
  sessionName(): string
  /** That session, which must exist. */
  current(): Session
}

export function createContext(program: Command): CommandContext {
  const sessionName = () =>
    program.opts().session ?? process.env.SIM_SESSION ?? defaultSessionName()
  return { program, sessionName, current: () => requireSession(sessionName()) }
}

/** Parses a whole-number option, so a typo fails here rather than as NaN downstream. */
export function integer(text: string): number {
  const n = Number(text)
  if (!Number.isInteger(n) || n < 0) throw new InvalidArgumentError('Not a whole number.')
  return n
}

export function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

/** Reads a CLI argument as JSON when it parses, and as a string otherwise. */
export function parseArg(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

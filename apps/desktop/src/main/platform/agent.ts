/*
 * Talking to the program that registers the Finder mount.
 *
 * `NSFileProviderManager.add` is entitled and this process is Node, so the call
 * is made by a signed helper bundle inside the app. It is spawned per operation
 * and answers with one line of JSON: no daemon, no state, nothing held open.
 */

import { app } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const AGENT_NAME = 'SiaDomainAgent'
/** Bounds a stuck helper so it cannot hold up startup or quit. */
const TIMEOUT_MS = 20_000

export type AgentResult = {
  ok: boolean
  domains?: string[]
  message?: string
  /** Where `unregister` left files it would not delete, when there were any. */
  preserved?: string
}

/** Inside the bundle: `Contents/Helpers/<name>.app/Contents/MacOS/<name>`. */
export function agentPath(): string {
  const contents = dirname(dirname(app.getAppPath()))
  return join(contents, 'Helpers', `${AGENT_NAME}.app`, 'Contents', 'MacOS', AGENT_NAME)
}

/**
 * Only the packaged app carries the helper. A run from source has no bundle to
 * carry it in, and no signature that would let it register a mount anyway.
 */
export function agentInstalled(): boolean {
  return existsSync(agentPath())
}

export function runAgent(args: string[]): Promise<AgentResult> {
  return new Promise((resolve, reject) => {
    execFile(agentPath(), args, { timeout: TIMEOUT_MS }, (error, stdout, stderr) => {
      const parsed = parse(stdout)
      // A non-zero exit still carries its reason on stdout, so the parsed
      // message is preferred over "Command failed".
      if (parsed && !parsed.ok) {
        reject(new Error(parsed.message ?? `${args[0]} failed`))
        return
      }
      if (error) {
        // stderr too: a helper that cannot load prints the reason there and
        // exits, leaving `error.message` as nothing but an exit code.
        const detail = stderr.trim().slice(0, 200)
        reject(new Error(`${args[0]}: ${error.message}${detail ? ` (${detail})` : ''}`))
        return
      }
      if (!parsed) {
        // Truncated: an unparseable stdout is whatever the OS printed instead of
        // the agent's reply, which for a load failure is a wall of paths.
        const answer = stdout.trim().slice(0, 200)
        reject(new Error(`${args[0]}: the domain agent answered with ${JSON.stringify(answer)}`))
        return
      }
      resolve(parsed)
    })
  })
}

function parse(stdout: string): AgentResult | null {
  const trimmed = stdout.trim()
  // The last line only: a failure prints whatever the loader had to say first,
  // and splitting all of it would allocate the wall of text to discard it.
  const line = trimmed.slice(trimmed.lastIndexOf('\n') + 1)
  if (!line) return null
  try {
    const value = JSON.parse(line) as AgentResult
    return typeof value.ok === 'boolean' ? value : null
  } catch {
    return null
  }
}

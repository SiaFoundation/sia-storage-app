/*
 * Talking to the program that registers the Finder mount.
 *
 * `NSFileProviderManager.add` is entitled and this process is Node, so the call
 * is made by a signed helper bundle inside the app. It is spawned per operation
 * and answers with one line of JSON: no daemon, no state, nothing held open.
 */

import { app } from 'electron'
import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'

const AGENT_NAME = 'SiaDomainAgent'
/** Registration talks to the system, not the network. Longer than it can take. */
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

export function runAgent(args: string[]): Promise<AgentResult> {
  return new Promise((resolve, reject) => {
    execFile(agentPath(), args, { timeout: TIMEOUT_MS }, (error, stdout) => {
      const parsed = parse(stdout)
      // A non-zero exit still carries its reason on stdout, so the parsed
      // message is preferred over "Command failed".
      if (parsed && !parsed.ok) {
        reject(new Error(parsed.message ?? `${args[0]} failed`))
        return
      }
      if (error) {
        reject(new Error(`${args[0]}: ${error.message}`))
        return
      }
      if (!parsed) {
        reject(new Error(`${args[0]}: the domain agent answered with ${JSON.stringify(stdout)}`))
        return
      }
      resolve(parsed)
    })
  })
}

function parse(stdout: string): AgentResult | null {
  const line = stdout.trim().split('\n').pop()
  if (!line) return null
  try {
    const value = JSON.parse(line) as AgentResult
    return typeof value.ok === 'boolean' ? value : null
  } catch {
    return null
  }
}

/** What every daemon-backed command does before it runs, and how it gives up. */
import { getPaths } from '@siastorage/node-adapters'
import { ensureDaemonRunning } from '../daemon/supervisor'

/**
 * Starts the daemon if needed and returns its socket path. The caller makes
 * the client: it forwards every property to the daemon, `then` included, so
 * a promise resolving to the client would send the daemon a `then` call.
 */
export async function ensureDaemon(dataDir: string): Promise<string> {
  const p = getPaths(dataDir)
  await ensureDaemonRunning(p)
  return p.sockPath
}

/** Prints `message` to stderr and exits with status 1. */
export function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

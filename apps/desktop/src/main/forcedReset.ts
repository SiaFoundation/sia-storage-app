/*
 * The desktop app's side of the forced reset in core. The daemon rebuilds the
 * library when it next starts on a new nonce. Finder's copy of the folder is
 * discarded first, best effort: it holds file names and downloaded contents
 * from the library being dropped. If the system keeps it, the rebuilt library
 * has a new feed epoch, so Finder's anchors expire and it relists, showing
 * every file vanish and come back once.
 */

import { resolveForcedReset, resolveVariant } from '@siastorage/core/lib/forcedReset'
import { existsSync, readFileSync } from 'node:fs'
import { buildVariant, daemonDbPath, daemonStoragePath } from './paths'

/** Whether the daemon's next start will rebuild the library. */
export async function forcedResetPending(): Promise<boolean> {
  let stored: Record<string, string> = {}
  try {
    stored = JSON.parse(readFileSync(daemonStoragePath(), 'utf8'))
  } catch {
    // Missing or unreadable settings read as no reset recorded.
  }
  const action = await resolveForcedReset(
    { getItem: async (key) => stored[key] ?? null },
    resolveVariant(buildVariant()),
    existsSync(daemonDbPath()),
  )
  return action === 'reset'
}

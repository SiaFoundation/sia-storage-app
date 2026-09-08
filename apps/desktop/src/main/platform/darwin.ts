/*
 * macOS: the OS owns the shell process.
 *
 * fileproviderd loads the extension when it decides to, so nothing here starts
 * or stops it. Bringing the mount up means registering a domain, which is an
 * entitled call this process cannot make, so a signed helper bundle inside the
 * app makes it. One `NSFileProviderManager.add` creates, renames, unhides and
 * reconnects, so start never branches on the current state.
 */

import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { DesktopConfig } from '../config'
import { log } from '../log'
import { agentInstalled, runAgent } from './agent'
import type { PlatformIntegration, ShellConfig, ShellPaths, ShellState } from './types'

/** How long a quit waits on the helper. It is not cancelled, so a slow hide
 * still lands, just after the app is gone. */
const HIDE_TIMEOUT_MS = 2_000

/**
 * Where the sandboxed extension and the daemon meet.
 *
 * Inside its sandbox the extension's home directory *is* this path, so it opens
 * `provider.sock` directly. From outside the container has to be addressed in
 * full, and the two must agree or Finder silently serves its last cache.
 */
function extensionContainer(extensionBundleId: string): string {
  return join(homedir(), 'Library', 'Containers', extensionBundleId, 'Data')
}

/**
 * The mount is named `<app>-<domain display name>`, and the app part comes from
 * the bundle, so matching on the domain suffix is what finds it. The system
 * strips whitespace from both halves, so "Sia Storage Dev" lands on disk as
 * "SiaStorageDev" and a literal comparison never matches.
 */
function findMount(displayName: string): string | null {
  const root = join(homedir(), 'Library', 'CloudStorage')
  const suffix = `-${displayName.replace(/\s+/g, '')}`
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    // The directory does not exist until something mounts, and is unreadable
    // if the user denied access to it. Both mean no mount, not a failure.
    return null
  }
  for (const entry of entries) {
    if (entry.endsWith(suffix)) return join(root, entry)
  }
  return null
}

export function createDarwinIntegration(): PlatformIntegration {
  let state: ShellState = 'absent'
  let displayName: string | null = null
  let domainId: string | null = null

  return {
    shellPaths(config: DesktopConfig): ShellPaths {
      const container = extensionContainer(config.extensionBundleId)
      return {
        shellSocket: join(container, 'provider.sock'),
        handoffDir: join(container, 'handoff'),
      }
    },

    async start(config: ShellConfig) {
      if (!agentInstalled()) {
        state = 'unsupported'
        log.info('mount', 'no_domain_agent', { domainId: config.domainId })
        return
      }

      // Observable while the agent runs below, which is what the status surface
      // shows instead of reporting no mount at all.
      state = 'starting'
      displayName = config.displayName
      domainId = config.domainId
      let registered = false
      let confirmed = true
      try {
        await runAgent(['register', config.domainId, config.displayName])
      } catch (e) {
        log.error('mount', 'agent_failed', { error: e as Error })
        state = 'error'
        return
      }
      try {
        // Asked, not assumed: a register that reports success and does not stick
        // leaves the last directory behind, which would read as a live mount.
        const { domains } = await runAgent(['list'])
        registered = domains?.includes(config.domainId) ?? false
        if (!registered) log.error('mount', 'register_did_not_stick', { domainId: config.domainId })
      } catch (e) {
        // The confirmation failed, not the registration, so this is unknown
        // rather than failed and `findMount` can still settle it later.
        log.error('mount', 'agent_failed', { error: e as Error })
        confirmed = false
      }
      // The system creates the directory on its own schedule, so a miss after a
      // register that stuck is still starting.
      if (registered && findMount(config.displayName)) state = 'mounted'
      else state = registered || !confirmed ? 'starting' : 'error'
    },

    /**
     * Hides the mount rather than removing it. A folder left in Finder would be
     * a live-looking view of a library that may have nothing serving it. Hiding
     * leaves every downloaded file on disk, and the `register` at the next
     * launch brings it back untouched.
     */
    async stop() {
      if (domainId) {
        // Bounded rather than awaited outright: the helper's timeout is 20s,
        // and a quit that hangs that long is worse than a folder that lingers.
        let timer: ReturnType<typeof setTimeout> | undefined
        await Promise.race([
          runAgent(['hide', domainId]).catch((e) =>
            log.error('mount', 'agent_failed', { error: e as Error }),
          ),
          new Promise((resolve) => {
            timer = setTimeout(resolve, HIDE_TIMEOUT_MS)
          }),
        ])
        clearTimeout(timer)
      }
      state = 'absent'
      displayName = null
      domainId = null
    },

    /**
     * Re-reads the mount rather than trusting the last answer. The system
     * creates the directory after `start` returns, and a domain removed from
     * under us would otherwise leave this reporting mounted forever.
     */
    status: () => {
      if (state === 'unsupported' || !displayName) return state
      const present = findMount(displayName) !== null
      if (state === 'starting' && present) state = 'mounted'
      else if (state === 'mounted' && !present) state = 'absent'
      return state
    },

    // Null unless mounted: the directory appears before the domain serves and
    // outlives one that failed, so its presence alone proves nothing.
    mountPath: () => (displayName && state === 'mounted' ? findMount(displayName) : null),
  }
}

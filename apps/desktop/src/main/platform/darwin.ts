/*
 * macOS: the OS owns the shell process.
 *
 * The File Provider extension is loaded by fileproviderd from the app bundle
 * whenever it decides to; nothing here starts or stops it. Bringing the mount up
 * means registering a domain, and the extension refreshes Finder for itself off
 * its own daemon subscription.
 *
 * Registering the domain is an entitled call this process cannot make, so it is
 * spawned: a signed helper bundle inside the app carries the entitlement and
 * makes it. Everything else here is reading what the system did with it.
 *
 * Registering is also the only restore path needed. One `addDomain` creates the
 * domain, renames it, unhides it, and clears a disconnected one, so start never
 * has to branch on the current state. It does read the filesystem afterwards,
 * through `findMount`, because the system creates the directory on its own
 * schedule and the mount is not there the moment the call returns.
 */

import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { DesktopConfig } from '../config'
import { log } from '../log'
import { runAgent } from './agent'
import type { PlatformIntegration, ShellConfig, ShellPaths, ShellState } from './types'

/**
 * Where the sandboxed extension and the daemon meet.
 *
 * Inside its sandbox the extension's home directory *is* this path, so it opens
 * `provider.sock` directly; from outside, the container has to be addressed in
 * full. The two must agree or the extension connects to nothing and Finder
 * silently serves whatever it last cached.
 */
function extensionContainer(extensionBundleId: string): string {
  return join(homedir(), 'Library', 'Containers', extensionBundleId, 'Data')
}

/**
 * The mount is named `<app>-<domain display name>`, and the app part comes from
 * the bundle rather than from anything we pass in, so it cannot be derived
 * reliably here. Matching on the domain suffix finds it whoever registered it.
 */
function findMount(displayName: string): string | null {
  const root = join(homedir(), 'Library', 'CloudStorage')
  if (!existsSync(root)) return null
  const suffix = `-${displayName}`
  for (const entry of readdirSync(root)) {
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
      // Observable while the agent runs below, which is what the status surface
      // shows instead of reporting no mount at all.
      state = 'starting'
      displayName = config.displayName
      domainId = config.domainId
      try {
        await runAgent(['register', config.domainId, config.displayName])
      } catch (e) {
        // A mount registered by an earlier build outlives the agent failing, so
        // the domain is still worth looking for before calling this an error.
        log.error(`domain agent: ${(e as Error).message}`)
      }
      // The system creates the directory asynchronously after the domain is
      // added, so a miss here is not yet a failure; `mountPath` keeps looking.
      state = findMount(config.displayName) ? 'mounted' : 'starting'
    },

    /**
     * Hides the mount rather than removing it. Quitting takes the daemon with
     * it, so a folder left in Finder would be a live-looking view of a library
     * nothing is serving. Hiding leaves every downloaded file on disk, and the
     * `register` at the next launch brings it back untouched.
     */
    async stop() {
      if (domainId) {
        await runAgent(['hide', domainId]).catch((e) =>
          // Logged, not thrown: a quit that hangs on a helper is worse than a
          // folder that lingers until the next launch clears it.
          log.error(`domain agent: ${(e as Error).message}`),
        )
      }
      state = 'absent'
      displayName = null
      domainId = null
    },

    /** Re-checks a mount the system had not created yet when `start` returned. */
    status: () => {
      if (state === 'starting' && displayName && findMount(displayName)) state = 'mounted'
      return state
    },

    mountPath: () => (displayName ? findMount(displayName) : null),
  }
}

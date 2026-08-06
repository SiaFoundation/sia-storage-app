/*
 * macOS: the OS owns the shell process.
 *
 * fileproviderd loads the extension when it decides to, so nothing here starts
 * or stops it, and the extension refreshes Finder off its own subscription.
 * Registering a domain needs the File Provider entitlement and a signed bundle
 * to carry it, neither of which this process has, so `start` reports the mount
 * it finds rather than creating one.
 */

import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { DesktopConfig } from '../config'
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
  const suffix = `-${displayName}`
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

  return {
    shellPaths(config: DesktopConfig): ShellPaths {
      const container = extensionContainer(config.extensionBundleId)
      return {
        shellSocket: join(container, 'provider.sock'),
        handoffDir: join(container, 'handoff'),
      }
    },

    async start(config: ShellConfig) {
      displayName = config.displayName
      state = findMount(config.displayName) ? 'mounted' : 'absent'
    },

    async stop() {
      state = 'absent'
      displayName = null
    },

    status: () => state,

    mountPath: () => (displayName ? findMount(displayName) : null),
  }
}

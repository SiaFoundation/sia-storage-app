/*
 * macOS: the OS owns the shell process.
 *
 * The File Provider extension is loaded by fileproviderd from the app bundle
 * whenever it decides to; nothing here starts or stops it. Bringing the mount up
 * means registering a domain, and the extension refreshes Finder for itself off
 * its own daemon subscription.
 *
 * Registering the domain is an entitled call this process does not make: it
 * needs the File Provider entitlement and a signed bundle to carry it. `start`
 * therefore looks for a mount that already exists and reports what it finds
 * rather than creating one.
 */

import { existsSync, readdirSync } from 'node:fs'
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

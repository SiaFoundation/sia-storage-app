/*
 * The integration for an OS with no storage-provider shell yet, Windows and
 * Linux today. The app runs as it does from source on macOS: the tray, the
 * window and the daemon work, and the status view reports the file manager
 * folder as unsupported rather than failed. With no shell there is no shell
 * socket, so the daemon serves only its own.
 */

import type { PlatformIntegration } from './types'

export function createUnmountedIntegration(): PlatformIntegration {
  return {
    shellPaths: () => ({}),
    start: async () => {},
    stop: async () => {},
    discard: async () => false,
    status: () => 'unsupported',
    mountPath: () => null,
    mount: () => null,
  }
}

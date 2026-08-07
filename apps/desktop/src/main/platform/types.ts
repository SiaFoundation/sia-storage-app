/*
 * The whole platform boundary, on the Electron side.
 *
 * Each OS integrates a storage provider differently: macOS loads a sandboxed
 * extension the system owns, while Windows and FUSE run a program of ours. What
 * they share is a lifecycle and nothing else. Every decision about what a file
 * is or where bytes live belongs to `app.provider` in core, which all three
 * call identically, so nothing here knows what a File Provider is.
 */

import type { DesktopConfig } from '../config'

/**
 * `unsupported` means this build cannot mount at all, which is different from a
 * mount that was attempted and failed: nothing is wrong and there is nothing to
 * retry. On macOS it is what a run from source gets, because registering a
 * mount needs a signed helper that only the packaged app carries.
 */
export type ShellState = 'absent' | 'starting' | 'mounted' | 'error' | 'unsupported'

export type ShellConfig = {
  /** Where the shell reaches the daemon: a unix socket, or a named pipe. */
  shellSocket: string
  /** Stable identifier for the mount, so a restart reattaches rather than duplicating. */
  domainId: string
  /** What the file manager shows in its sidebar. */
  displayName: string
}

/** What the daemon has to be told before it starts, for this platform's shell. */
export type ShellPaths = {
  shellSocket: string
  /** Only where the shell is sandboxed and cannot read managed storage. */
  handoffDir?: string
}

export interface PlatformIntegration {
  /**
   * Where this platform's shell and the daemon meet. Separate from `start`
   * because the daemon is told these before it runs, and the mount comes up
   * after it.
   */
  shellPaths(config: DesktopConfig): ShellPaths
  /** Brings the OS mount up. Calling it twice is not an error. */
  start(config: ShellConfig): Promise<void>
  /** Stops serving the mount. Whether the registration survives is the
   * platform's call: macOS hides the domain so downloaded files stay. */
  stop(): Promise<void>
  status(): ShellState
  /** Where the OS mounted us, for "open in file manager". Null until mounted. */
  mountPath(): string | null
}

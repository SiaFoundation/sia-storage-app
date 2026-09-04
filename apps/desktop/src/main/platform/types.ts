/*
 * The whole platform boundary, on the Electron side.
 *
 * Each OS integrates a storage provider in a different shape. macOS loads a
 * sandboxed extension the system owns. Windows delivers Cloud Files callbacks
 * into whichever process connected the sync root, and a FUSE host is the
 * filesystem, so on both the shell is a program of ours rather than one the OS
 * loads. What they share is a lifecycle, and only a lifecycle. Every decision
 * about what a file is, what a folder holds or where bytes live belongs to
 * `app.provider` in core, which all three call identically.
 *
 * Nothing here knows what a File Provider or a sync root is.
 */

import type { DesktopConfig } from '../config'

export type ShellState = 'absent' | 'starting' | 'mounted' | 'error'

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
  /** Takes it down and leaves no registration behind. */
  stop(): Promise<void>
  status(): ShellState
  /** Where the OS mounted us, for "open in file manager". Null until mounted. */
  mountPath(): string | null
}

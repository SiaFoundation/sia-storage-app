/*
 * The whole platform boundary, on the Electron side.
 *
 * Each OS integrates a storage provider differently: macOS loads a sandboxed
 * extension the system owns, while Windows and FUSE run a program of ours. What
 * they share is a lifecycle and nothing else. Every decision about what a file
 * is or where bytes live belongs to `app.provider` in core, which all three
 * call identically, so nothing here knows what a File Provider is.
 */

import type { Mount } from '@siastorage/core/adapters'
import type { BrowserWindowConstructorOptions, NativeImage } from 'electron'
import type { DesktopConfig } from '../config'

/**
 * `unsupported` means this build cannot mount at all, which is different from a
 * mount that was attempted and failed: nothing is wrong and there is nothing to
 * retry. On macOS it is what a run from source gets, because registering a
 * mount needs a signed helper that only the packaged app carries.
 */
export type ShellState = 'absent' | 'starting' | 'mounted' | 'error' | 'unsupported'

export type ShellConfig = {
  /** Where the shell reaches the daemon. None on a platform with no shell yet. */
  shellSocket?: string
  /** Stable identifier for the mount, so a restart reattaches rather than duplicating. */
  domainId: string
  /** What the file manager shows in its sidebar. */
  displayName: string
}

/** What the daemon has to be told before it starts, for this platform's shell. */
export type ShellPaths = {
  /** None on a platform with no shell yet, which leaves the daemon serving none. */
  shellSocket?: string
  /** Only where the shell is sandboxed and cannot read managed storage. */
  handoffDir?: string
}

export type StopOptions = {
  /** Sign-out: take the mount away and have the system delete its copy. */
  remove?: boolean
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
  /** Stops serving the mount. Without `remove` the platform may keep the
   * registration and its copy of the files, which is what makes a relaunch
   * cheap. With `remove` the copy is deleted. */
  stop(opts?: StopOptions): Promise<void>
  /**
   * Has the system delete its copy of a mount this app is not serving yet,
   * for a library about to be rebuilt. False when the system kept it, or when
   * this build has no Finder folder to discard.
   */
  discard(domainId: string): Promise<boolean>
  status(): ShellState
  /** Where the OS mounted us, for "open in file manager". Null until mounted. */
  mountPath(): string | null
  /**
   * The registered mount, with what the daemon's adapter needs to reach the
   * system about it, once `start` has registered it. On macOS that is the
   * path of the program the daemon runs to act on the Finder domain. Null
   * when this build cannot reach the system about a mount or nothing is
   * registered.
   */
  mount(): Mount | null
}

/**
 * How the app's windows and tray icon look and sit in the OS shell. Their
 * behaviour is the same everywhere and lives in windows.ts and tray.ts. What
 * differs is the title bar, what is drawn behind the page, the icons, and
 * whether showing a window adds a Dock tile.
 */
export interface WindowChrome {
  /** Appearance options for the main window. */
  mainWindow(): Pick<
    BrowserWindowConstructorOptions,
    'titleBarStyle' | 'transparent' | 'vibrancy' | 'backgroundColor' | 'icon'
  >
  /** Appearance options for the tray popover. */
  popover(): Pick<
    BrowserWindowConstructorOptions,
    'transparent' | 'vibrancy' | 'visualEffectState' | 'backgroundColor' | 'icon'
  >
  /** The tray icon's image. */
  trayImage(): NativeImage
  /** The app now has its main window on screen. */
  windowShown(): void
  /** The app has no window on screen, at launch and after the main window closes. */
  windowsHidden(): void
}

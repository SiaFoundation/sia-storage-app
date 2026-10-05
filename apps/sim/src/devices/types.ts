import type { ProcessSample } from '../process'
import type { DeviceKind } from '../session'
import type { Selector } from '../ui/tree'

/** One file as a device's library shows it, in terms every device shares. */
export type LibraryEntry = {
  id: string
  name: string
  hash: string
  size: number
  /** Directory path, or null at the root. */
  dir: string | null
  current: boolean
  trashed: boolean
  /** Tag names, sorted. */
  tags: string[]
  /** True once the file has an object on the network. */
  uploaded: boolean
}

/**
 * A device's own screen, driven by what a user sees: a phone's accessibility
 * tree, or the desktop app's windows. Gestures only a touch screen has are
 * optional, and a command asking a device for one it lacks says so.
 */
export interface UiSurface {
  describe(): Promise<unknown[]>
  tap(sel: Selector, timeoutMs?: number): Promise<void>
  type(sel: Selector, text: string, opts?: { clear?: boolean; submit?: boolean }): Promise<void>
  clear(sel: Selector): Promise<void>
  waitFor(sel: Selector, timeoutMs?: number): Promise<unknown>
  waitForGone(sel: Selector, timeoutMs?: number): Promise<void>
  /** The text of the first element matching `sel`, or null when none does. */
  read?(sel: Selector): Promise<string | null>
  /** The same surface limited to one of the device's windows, where it has several. */
  window?(name: string): UiSurface
  longPress?(sel: Selector, holdMs?: number): Promise<void>
  swipe?(direction: 'up' | 'down' | 'left' | 'right', sel?: Selector): Promise<void>
  scrollTo?(sel: Selector, direction?: 'up' | 'down' | 'left' | 'right'): Promise<void>
  back?(): Promise<void>
  hideKeyboard?(): Promise<void>
  close(): Promise<void>
}

/**
 * A running app instance attached to the session's network. The same surface
 * for every kind, so a scenario reads the same whether a step runs on a CLI
 * daemon or on the phone.
 */
export interface Device {
  readonly name: string
  readonly kind: DeviceKind
  /**
   * Starts the app and resolves once it answers calls. Signs in on first
   * start. With `relaunchAfterCrash`, a phone app that crashes while starting
   * is relaunched once and the crash is added to `startCrashes`.
   */
  start(opts?: { relaunchAfterCrash?: boolean }): Promise<void>
  /** The first crash line of each start a relaunch got past. */
  readonly startCrashes?: readonly string[]
  /** Asks the app to shut down and waits for it to exit. */
  stop(): Promise<void>
  /** Kills the process with no chance to clean up. */
  kill(): Promise<void>
  isRunning(): Promise<boolean>
  /** Calls an AppService method, e.g. `call('files.trashFile', id)`. */
  call<T = unknown>(method: string, ...args: unknown[]): Promise<T>
  /** A read-only query against the app's own database. */
  sql<T = Record<string, unknown>>(query: string, ...params: unknown[]): Promise<T[]>
  /** Adds a local file through the app's own add path. */
  addFile(path: string, opts?: { dir?: string }): Promise<{ id: string; name: string }>
  library(): Promise<LibraryEntry[]>
  /** The last `lines` lines of the app's log. */
  logs(lines?: number): Promise<string>
  /** Sends the app to the background. Only apps the OS can suspend have this. */
  background?(): Promise<void>
  /** Brings the app back to the foreground. */
  foreground?(): Promise<void>
  /** The device's screen, for devices that have one a user drives. */
  ui?(): UiSurface
  /**
   * One reading of the app's process: CPU percent and resident memory. A
   * daemon and an iOS simulator's app are host processes, read with ps, and an
   * emulator's app is read with top over adb.
   */
  sampleProcess?(): Promise<ProcessSample | null>
  /** Saves a screenshot of the device's screen to `path`. */
  screenshot?(path: string): Promise<void>
  /** Adds what only this kind of device shows to a capture's directory. */
  captureMore?(dir: string): Promise<void>
  /**
   * Puts the device on screen for a person to watch, and says what it did.
   * Devices run without a window, since nothing a scenario checks needs one.
   */
  show?(): Promise<string>
  /**
   * Copies what the device holds outside its session directory into `dir`, for
   * a failed run to keep: a phone's screen, database and log.
   */
  preserve?(dir: string): Promise<void>
  /** Hands back what the device holds outside its session directory, such as a pooled simulator. */
  dispose?(): Promise<void>
}

/*
 * The words the app's copy uses for things each OS names differently: the
 * computer, its file manager, and where the app's icon sits. Copy is written
 * with these rather than "Mac" and "Finder", so one sentence reads right on
 * every platform.
 *
 * Shared by the main process, which knows the platform from Node, and the
 * windows, which get it from the preload bridge.
 */

export type PlatformTerms = {
  /** What a person calls this computer, after "this": Mac, PC. */
  computer: string
  /** The app that shows the synced folder. */
  fileManager: string
  /** Where the app's icon lives while no window is open. */
  iconArea: string
  /** The file manager's command that drops a file's downloaded copy. */
  removeDownload: string
  /**
   * Whether the app puts a folder in the file manager on this platform. Copy
   * that points at the folder is left out where it does not.
   */
  hasFolder: boolean
}

const DARWIN: PlatformTerms = {
  computer: 'Mac',
  fileManager: 'Finder',
  iconArea: 'menu bar',
  removeDownload: 'Remove Download',
  hasFolder: true,
}
const WIN32: PlatformTerms = {
  computer: 'PC',
  fileManager: 'File Explorer',
  iconArea: 'taskbar',
  removeDownload: 'Free up space',
  hasFolder: false,
}
const OTHER: PlatformTerms = {
  computer: 'computer',
  fileManager: 'file manager',
  iconArea: 'system tray',
  removeDownload: 'free up space',
  hasFolder: false,
}

export function platformTerms(platform: string): PlatformTerms {
  if (platform === 'darwin') return DARWIN
  if (platform === 'win32') return WIN32
  return OTHER
}

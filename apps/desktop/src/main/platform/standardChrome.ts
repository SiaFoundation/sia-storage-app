/*
 * Windows and Linux: windows with the system's own title bar and a solid
 * background in the system's light or dark colour, and an app whose taskbar
 * entry comes and goes with its window, so there is nothing to show or hide.
 *
 * Neither has a material like AppKit's for a page to sit on, so the page
 * paints the background itself (`platform-standard.css`). The colour set here
 * is what shows before the page has painted, and matches it.
 *
 * The app runs here only from source so far, as Electron's own executable,
 * whose icon the title bar and taskbar show unless each window names one. The
 * Windows icons are drawn by `build/windows-icons.ts`, in the colours of the
 * build: camo greens for beta and the logo's own colours for every other
 * build. Electron loads .ico files only on Windows, so on Linux the windows
 * keep Electron's icon and the tray takes the macOS menu bar image.
 */

import { nativeImage, nativeTheme } from 'electron'
import { join } from 'node:path'
import { buildVariant } from '../paths'
import type { WindowChrome } from './types'

/** `--window-background` in `platform-standard.css`, dark and light. */
const BACKGROUND = { dark: '#202020', light: '#f3f3f3' }

const background = () => (nativeTheme.shouldUseDarkColors ? BACKGROUND.dark : BACKGROUND.light)

/** A Windows icon in `assets/icons`, with `-beta` before `.ico` for the beta build. */
export function windowsIcon(name: string): string {
  const suffix = buildVariant() === 'beta' ? '-beta' : ''
  return join(__dirname, '../../assets/icons', `${name}${suffix}.ico`)
}

/** None off Windows, where Electron loads no .ico file. */
const icon = (name: string) => (process.platform === 'win32' ? windowsIcon(name) : undefined)

export const standardChrome: WindowChrome = {
  mainWindow: () => ({
    titleBarStyle: 'default',
    backgroundColor: background(),
    icon: icon('windows'),
  }),
  popover: () => ({ backgroundColor: background(), icon: icon('windows') }),
  windowShown: () => {},
  windowsHidden: () => {},
  trayImage: () =>
    nativeImage.createFromPath(
      icon('windows-tray') ?? join(__dirname, '../../assets/tray-Template.png'),
    ),
}

/*
 * macOS: windows of AppKit material with the page drawn over it, and an app
 * that lives in the menu bar with a Dock tile only while its window is open.
 * The windows take the app bundle's icon, so they name none here.
 */

import { app, nativeImage } from 'electron'
import { join } from 'node:path'
import type { WindowChrome } from './types'

export const darwinChrome: WindowChrome = {
  // The material AppKit draws behind a standard window, so this one matches
  // native windows in light and dark, focused or not. The popover's material
  // lightens what is behind it, which across a whole window reads as flat
  // mid-gray. A solid `backgroundColor` is one fixed colour, so it would stay
  // dark after a switch to light appearance. The title bar is hidden and the
  // page draws its own drag strip under the traffic lights.
  mainWindow: () => ({ titleBarStyle: 'hiddenInset', transparent: true, vibrancy: 'window' }),
  // The popover loses focus only while a menu it opened holds it, see
  // `holdPopover`, and keeps its focused look then too.
  popover: () => ({ transparent: true, vibrancy: 'popover', visualEffectState: 'active' }),
  windowShown: () => void app.dock?.show(),
  // A Dock tile with no window behind it looks like an app that is running
  // with nothing to show.
  windowsHidden: () => app.dock?.hide(),
  // A template image, which the system tints for light and dark menu bars.
  trayImage: () => {
    const image = nativeImage.createFromPath(join(__dirname, '../../assets/tray-Template.png'))
    image.setTemplateImage(true)
    return image
  },
}

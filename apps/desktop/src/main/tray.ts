/*
 * The menu bar item on macOS, the notification area icon on Windows.
 *
 * Left click opens the popover, or the window when the daemon says this machine
 * has no account yet, since the window is where signing in happens.
 * Right click gives the menu.
 */

import { app, Menu, Tray } from 'electron'
import { Daemon } from './daemon'
import { windowChrome } from './platform'
import { updateMenuItems } from './updates'
import { beginQuit, hidePopover, showMainWindow, togglePopover } from './windows'

let tray: Tray | null = null

export function createTray(): Tray {
  if (tray) return tray

  const item = new Tray(windowChrome().trayImage())
  item.setToolTip('Sia Storage')

  item.on('click', (_event, bounds) => {
    // Only the daemon's own no opens sign-in. One that cannot answer gets the
    // popover, which says it is not running.
    void Daemon.accountState().then((has) =>
      has === false ? showMainWindow() : togglePopover(bounds),
    )
  })
  item.on('right-click', () => {
    hidePopover()
    item.popUpContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Sia Storage', click: () => showMainWindow() },
        ...updateMenuItems(),
        { type: 'separator' },
        {
          label: 'Quit',
          click: () => {
            beginQuit()
            app.quit()
          },
        },
      ]),
    )
  })

  tray = item
  return item
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}

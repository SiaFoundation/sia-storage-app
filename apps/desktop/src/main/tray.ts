/*
 * The menu bar item.
 *
 * Left click opens the popover, or the window when this machine has no account
 * yet: the popover reports the problem and the window is where it is fixed.
 * Right click gives the menu. The icon is a template image so the system tints
 * it for light and dark menu bars.
 */

import { app, Menu, Tray, nativeImage } from 'electron'
import { join } from 'node:path'
import { Daemon } from './daemon'
import { beginQuit, hidePopover, showMainWindow, togglePopover } from './windows'

let tray: Tray | null = null

function iconPath(): string {
  return join(__dirname, '../../assets/tray-Template.png')
}

export function createTray(): Tray {
  if (tray) return tray

  const image = nativeImage.createFromPath(iconPath())
  image.setTemplateImage(true)

  const item = new Tray(image)
  item.setToolTip('Sia Storage')

  item.on('click', (_event, bounds) => {
    void Daemon.hasAccount().then((has) => (has ? togglePopover(bounds) : showMainWindow()))
  })
  item.on('right-click', () => {
    hidePopover()
    item.popUpContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Sia Storage', click: () => showMainWindow() },
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

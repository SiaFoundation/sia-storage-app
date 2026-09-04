/*
 * The menu bar item.
 *
 * The icon is a template image on macOS so the system tints it for light and
 * dark menu bars.
 */

import { app, Menu, Tray, nativeImage } from 'electron'
import { join } from 'node:path'

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
  item.setContextMenu(Menu.buildFromTemplate([{ label: 'Quit', click: () => app.quit() }]))

  tray = item
  return item
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}

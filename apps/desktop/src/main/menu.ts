/*
 * The overflow menu behind the popover's ellipsis button.
 *
 * A system menu rather than markup: everything on it acts on the app, and it
 * dismisses itself the way every other menu does. The popover hides on focus
 * loss, so a menu over it would take the surface it belongs to, and
 * `holdPopover` suspends that while the menu is up.
 */

import { Menu } from 'electron'
import { openLogs } from './logs'
import { holdPopover } from './windows'

export function showMoreMenu(signOut: () => void): void {
  const menu = Menu.buildFromTemplate([
    { label: 'Open Logs', click: openLogs },
    { type: 'separator' },
    { label: 'Sign Out…', click: signOut },
  ])

  const release = holdPopover()
  menu.popup({ callback: release })
}

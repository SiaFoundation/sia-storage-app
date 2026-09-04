/*
 * The renderer's route to the daemon, and the few things it cannot do itself.
 *
 * `rpc` forwards to the daemon's reflected facade unchanged. The window is a
 * client of the same API the CLI calls over the same socket, so it is not held
 * to a subset of it. The rest are explicit verbs for things a page cannot do.
 */

import { app, ipcMain, shell } from 'electron'
import { Daemon } from './daemon'
import { daemonLogPath } from './paths'
import type { PlatformIntegration } from './platform'
import { call } from './rpc'
import { beginQuit, resizeToContent } from './windows'

export function registerBridge(platform: PlatformIntegration): void {
  ipcMain.handle('rpc', (_event, method: string, args: unknown[]) =>
    call(method, Array.isArray(args) ? args : []),
  )

  // The popover sizes to its content the way a menu does, so a section that
  // only appears mid-transfer does not leave dead space when it is gone.
  ipcMain.on('window:height', (event, height: number) => {
    if (typeof height === 'number' && height > 0) resizeToContent(event.sender, height)
  })

  // Asked rather than remembered: the window cannot infer this from a library
  // read, which keeps its last answer when the daemon stops answering.
  ipcMain.handle('shell:daemon', () => Daemon.isReachable())
  ipcMain.handle('shell:status', () => platform.status())
  ipcMain.handle('shell:mountPath', () => platform.mountPath())

  ipcMain.handle('open:mount', () => {
    const path = platform.mountPath()
    if (path) void shell.openPath(path)
  })
  ipcMain.handle('open:logs', () => {
    void shell.openPath(daemonLogPath())
  })

  ipcMain.handle('app:quit', () => {
    beginQuit()
    app.quit()
  })
}

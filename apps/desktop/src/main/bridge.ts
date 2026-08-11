/*
 * The renderer's route to the daemon, and the few things it cannot do itself.
 *
 * `rpc` forwards to the daemon's reflected facade unchanged, so the renderer
 * reaches the same `app.*` surface the CLI does over the same unix socket. The
 * other handlers are explicit verbs for calls that need Electron APIs.
 */

import { app, ipcMain, shell } from 'electron'
import { Daemon } from './daemon'
import { log } from './log'
import { daemonLogPath } from './paths'
import type { PlatformIntegration } from './platform'
import { call } from './rpc'
import { beginQuit, resizeToContent } from './windows'

async function openPath(path: string): Promise<void> {
  const reason = await shell.openPath(path)
  if (reason) log.error(`could not open ${path}: ${reason}`)
}

export function registerBridge(platform: PlatformIntegration): void {
  // The renderer supplies both, so neither is trusted: a non-string method
  // would reach the daemon as whatever it happens to serialise to.
  ipcMain.handle('rpc', (_event, method: unknown, args: unknown) => {
    if (typeof method !== 'string') throw new Error('rpc needs a method name')
    return call(method, Array.isArray(args) ? args : [])
  })

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

  // `openPath` resolves to a reason rather than rejecting, so it is awaited and
  // logged here; a renderer that only opens a folder has nothing to do with it.
  ipcMain.handle('open:mount', async () => {
    const path = platform.mountPath()
    if (path) await openPath(path)
  })
  ipcMain.handle('open:logs', () => openPath(daemonLogPath()))

  ipcMain.handle('app:quit', () => {
    beginQuit()
    app.quit()
  })
}

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
import { showMoreMenu } from './menu'
import type { PlatformIntegration } from './platform'
import { call } from './rpc'
import { beginQuit, hideMainWindow, openExternally, resizeToContent } from './windows'

async function openPath(path: string): Promise<void> {
  const reason = await shell.openPath(path)
  if (reason) log.error('shell', 'open_failed', { path, reason })
}

export function registerBridge(platform: PlatformIntegration, signOut: () => void): void {
  // The caller sets the timeout because only it knows how long its call takes.
  // Method and args arrive from the renderer, so neither is taken on trust.
  ipcMain.handle('rpc', (_event, method: unknown, args: unknown, timeoutMs?: number) => {
    if (typeof method !== 'string') throw new Error('rpc needs a method name')
    return call(method, Array.isArray(args) ? args : [], timeoutMs)
  })

  ipcMain.handle('open:url', (_event, url: string) => {
    openExternally(url)
  })

  // The popover sizes to its content the way a menu does, so a section that
  // only appears mid-transfer does not leave dead space when it is gone.
  ipcMain.on('window:height', (event, height: number) => {
    if (typeof height === 'number' && height > 0) resizeToContent(event.sender, height)
  })

  // Asked, not inferred from a library read that keeps its last answer. Not a
  // facade method either: `connect` is the daemon's own, like ping and shutdown.
  ipcMain.handle('daemon:connect', () => call('connect', [], 60_000))

  ipcMain.handle('shell:daemon', () => Daemon.isReachable())
  // The daemon's own channel: how far the OS shell has got through writing the
  // library out, which it infers from what the shell has asked it for.
  ipcMain.handle('shell:materializing', () => call('materializing'))
  ipcMain.handle('shell:status', () => platform.status())
  ipcMain.handle('shell:mountPath', () => platform.mountPath())

  // `openPath` resolves to a reason rather than rejecting, so it is awaited and
  // logged here; a renderer that only opens a folder has nothing to do with it.
  ipcMain.handle('open:mount', async () => {
    const path = platform.mountPath()
    if (path) await openPath(path)
  })
  ipcMain.handle('menu:more', () => {
    showMoreMenu(signOut)
  })

  ipcMain.handle('window:close', () => {
    hideMainWindow()
  })

  ipcMain.handle('app:quit', () => {
    beginQuit()
    app.quit()
  })
}

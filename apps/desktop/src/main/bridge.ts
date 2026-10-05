/*
 * The renderer's route to the daemon, and the few things it cannot do itself.
 *
 * `rpc` forwards to the daemon's reflected facade unchanged, so the renderer
 * reaches the same `app.*` surface the CLI does over the same unix socket. The
 * other handlers are explicit verbs for calls that need Electron APIs.
 */

import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { desktopConfig } from './config'
import { Daemon } from './daemon'
import { log } from './log'
import { showMoreMenu } from './menu'
import type { PlatformIntegration } from './platform'
import { call } from './rpc'
import { isMockNetworkPage } from './testMode'
import {
  beginQuit,
  hideMainWindow,
  hidePopover,
  layoutMainWindow,
  openWebUrl,
  resizeToContent,
  showMainWindow,
} from './windows'

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

  ipcMain.handle('open:url', async (_event, url: string) => {
    // A test build's sign-in is approved by the test driving it, so its
    // approval page on the mock network is never opened.
    if (isMockNetworkPage(url, process.env.SIA_MOCK_NETWORK_URL)) {
      log.info('shell', 'open_skipped', { reason: 'mock_network' })
      return
    }
    // Awaited, and a refused URL rejects too: resolving here tells sign-in
    // the approval page is open, and it would wait on one that never appeared.
    const opened = openWebUrl(url)
    if (opened === null) throw new Error('Not an openable web URL')
    await opened
  })

  // The popover sizes to its content the way a menu does, so a section that
  // only appears mid-transfer does not leave dead space when it is gone.
  ipcMain.on('window:height', (event, height: number) => {
    if (typeof height === 'number' && height > 0) resizeToContent(event.sender, height)
  })
  ipcMain.on('window:layout', (event, layout: unknown) => layoutMainWindow(event.sender, layout))

  // Asked, not inferred from a library read that keeps its last answer. Not a
  // facade method either: `connect` is the daemon's own, like ping and shutdown.
  ipcMain.handle('daemon:connect', () => call('connect', [], 60_000))

  ipcMain.handle('shell:daemon', () => Daemon.isReachable())
  // The daemon's own channel: how far the OS shell has got through writing the
  // library out, which it infers from what the shell has asked it for.
  // The reachability probe answers in three seconds; the transport default
  // would hold the popover's whole settled read for fifteen after the daemon
  // stops answering.
  ipcMain.handle('shell:materializing', () => call('materializing', [], 3_000))
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

  // What the page cannot tell for itself: its own visibility also reads hidden
  // while another window covers it.
  ipcMain.handle(
    'window:visible',
    (event) => BrowserWindow.fromWebContents(event.sender)?.isVisible() ?? false,
  )

  ipcMain.handle('window:open', () => {
    hidePopover()
    showMainWindow()
  })

  ipcMain.handle('app:info', () => ({
    finderName: desktopConfig().displayName,
    version: app.getVersion(),
  }))

  ipcMain.handle('app:quit', () => {
    beginQuit()
    app.quit()
  })
}

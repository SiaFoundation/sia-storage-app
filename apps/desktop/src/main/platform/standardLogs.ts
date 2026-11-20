/*
 * Opening the logs on Windows and Linux: the app's and the daemon's, each in
 * the system's default app for a .log file, which is Notepad on Windows. There
 * is no extension and so no third log. A log nothing has written yet is left
 * out rather than created, since an empty file says nothing.
 */

import { existsSync } from 'node:fs'
import { shell } from 'electron'
import { log } from '../log'
import { daemonLogPath, desktopLogPath } from '../paths'

export async function openLogs(): Promise<void> {
  for (const path of [desktopLogPath(), daemonLogPath()].filter((p) => existsSync(p))) {
    // `openPath` resolves to the reason it failed rather than rejecting.
    const reason = await shell.openPath(path)
    if (reason) log.error('logs', 'open_failed', { reason, file: path })
  }
}

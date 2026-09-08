/*
 * Opening the logs.
 *
 * Both of them, in Console, which follows a file as it grows. The daemon and
 * this process each write their own, and which one holds the answer depends on
 * what went wrong: a mount that will not register is in this process's, a sync
 * that stalls is in the daemon's.
 */

import { execFile } from 'node:child_process'
import { log } from './log'
import { daemonLogPath, desktopLogPath } from './paths'

export function openLogs(): void {
  const files = [desktopLogPath(), daemonLogPath()]
  execFile('open', ['-a', 'Console', ...files], (error) => {
    if (error) log.error('logs', 'open_failed', { error, files: files.join(' ') })
  })
}

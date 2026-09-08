/*
 * Main-process logging, through the same logger the daemon uses.
 *
 * A tray app has nowhere to show a startup failure: no window yet, an icon that
 * looks the same either way, and no terminal once packaged. So the log is a
 * file next to the daemon's. The appender is here rather than from the node
 * adapters because those carry database bindings this process has no use for.
 */

import { addAppender, formatPlainLog, logger, type LogEntry } from '@siastorage/logger'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { desktopLogPath } from './paths'

const LOG_PATH = desktopLogPath()

let ready = false

function write(entry: LogEntry): void {
  const line = `${formatPlainLog(entry)}\n`
  try {
    if (!ready) {
      // 0700: this directory also holds the account secrets, the socket and
      // the database, and the node adapters create it with that mode.
      mkdirSync(dirname(LOG_PATH), { recursive: true, mode: 0o700 })
      ready = true
    }
    appendFileSync(LOG_PATH, line)
    // Inside the same guard: a packaged app can have no usable stdout, and a
    // throw here would defeat the point of catching the file write.
    process.stdout.write(line)
  } catch {
    // Logging must never be the reason startup fails.
  }
}

addAppender({ write })

export const logPath = LOG_PATH
export { logger as log }

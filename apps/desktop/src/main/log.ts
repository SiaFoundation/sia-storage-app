/*
 * Main-process logging.
 *
 * A tray app has nowhere to show a startup failure: there is no window yet and
 * the tray icon looks the same whether everything worked or nothing did. It
 * also has no terminal once packaged, and Electron's main process does not
 * reliably reach stdout on macOS even when started from one, so the log is a
 * file next to the daemon's.
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { desktopLogPath } from './paths'

const LOG_PATH = desktopLogPath()

let ready = false

function write(level: string, message: string): void {
  const line = `${new Date().toISOString()} ${level} [main] ${message}\n`
  try {
    if (!ready) {
      mkdirSync(dirname(LOG_PATH), { recursive: true })
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

export const logPath = LOG_PATH

export const log = {
  info(message: string): void {
    write('INFO ', message)
  },
  error(message: string): void {
    write('ERROR', message)
  },
}

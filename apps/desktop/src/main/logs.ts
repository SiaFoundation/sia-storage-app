/*
 * Opening the logs, all three of them.
 *
 * Which one holds the answer depends on what went wrong: a mount that will not
 * register is in this process's, a stalled sync in the daemon's, a folder that
 * lists wrong in the extension's. The extension is sandboxed and logs through
 * the system, so its entries are copied into a file here to be read beside the
 * others. Console rather than an editor, because it follows a file as it grows.
 */

import { execFile, spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { appendFile, mkdir } from 'node:fs/promises'
import { promisify } from 'node:util'
import { log } from './log'
import { dataDir, daemonLogPath, desktopLogPath, extensionLogPath } from './paths'

const run = promisify(execFile)

/** Matches `fpLog` in the extension. */
const SUBSYSTEM = 'sia.storage.fileprovider'
/** Far enough back to cover the session someone is asking about. */
const WINDOW = '1d'
export async function openLogs(): Promise<void> {
  await collectExtensionLog()
  const paths = [desktopLogPath(), daemonLogPath(), extensionLogPath()]
  try {
    // `open` refuses the whole call when one argument is missing, so a log
    // nothing has written yet would hide the ones that exist.
    await Promise.all(paths.map((path) => appendFile(path, '')))
    await run('open', ['-a', 'Console', ...paths])
  } catch (e) {
    log.error('logs', 'open_failed', { error: e as Error, files: paths.join(' ') })
  }
}

/**
 * Copies what the system kept from the extension into a file beside the others.
 *
 * Only `notice` and `error` survive there. The extension's per-operation lines
 * are `debug`, which means catching them live with `log stream --debug` while
 * reproducing the problem rather than reading them back afterwards.
 */
async function collectExtensionLog(): Promise<void> {
  try {
    // Owner-only: the directory also holds the database and account secrets,
    // and this can be the first code path that creates it.
    await mkdir(dataDir(), { recursive: true, mode: 0o700 })
    // Streamed to the file rather than buffered: a long outage persists a
    // failure line per reconnect second, and passing a buffer cap would fail
    // collection and leave a stale file opening as if it were current.
    await new Promise<void>((resolve, reject) => {
      const child = spawn('log', [
        'show',
        '--last',
        WINDOW,
        '--style',
        'compact',
        '--predicate',
        `subsystem == "${SUBSYSTEM}"`,
      ])
      const out = createWriteStream(extensionLogPath())
      child.stdout.pipe(out)
      child.on('error', reject)
      out.on('error', reject)
      child.on('close', (code) => {
        out.end()
        if (code === 0) resolve()
        else reject(new Error(`log show exited with ${code}`))
      })
    })
  } catch (e) {
    log.error('logs', 'collect_failed', { error: e as Error })
  }
}

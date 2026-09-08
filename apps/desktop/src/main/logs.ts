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
import { mkdir, open, rename, rm } from 'node:fs/promises'
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
    // nothing has written yet would hide the ones that exist. Opened with 'a'
    // and closed unwritten, so an existing log keeps its mtime rather than
    // reading as freshly written the way appendFile('') would leave it.
    await Promise.all(paths.map((path) => open(path, 'a').then((fh) => fh.close())))
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
      const child = spawn(
        'log',
        [
          'show',
          '--last',
          WINDOW,
          '--style',
          'compact',
          '--predicate',
          `subsystem == "${SUBSYSTEM}"`,
        ],
        // stderr discarded: unread it can fill its pipe and wedge the child,
        // and this promise with it, so Logs would silently stop working.
        { stdio: ['ignore', 'pipe', 'ignore'] },
      )
      // Collected into a sibling temp file and renamed in only on success, so
      // a failed `log show` leaves the last good log in place rather than
      // truncating it to nothing.
      const finalPath = extensionLogPath()
      const tmpPath = `${finalPath}.tmp`
      const out = createWriteStream(tmpPath)
      const fail = (e: Error) => {
        void rm(tmpPath, { force: true }).finally(() => reject(e))
      }
      // `end: false`: pipe's auto-end can fire `finish` before `close` has
      // checked the exit code, reporting a failed collection as success. The
      // close handler ends the stream only on exit 0.
      child.stdout.pipe(out, { end: false })
      // Each failure path closes the other half: a reject alone leaves the
      // file open or the child running until the process exits.
      child.on('error', (e) => {
        out.destroy()
        fail(e)
      })
      out.on('error', (e) => {
        child.kill()
        fail(e)
      })
      // Renamed on the write stream's finish, not the child's close: close only
      // says stdout ended, and a rename mid-flush would publish a partial file.
      out.on('finish', () => {
        rename(tmpPath, finalPath).then(resolve, fail)
      })
      child.on('close', (code) => {
        if (code === 0) out.end()
        else {
          out.destroy()
          fail(new Error(`log show exited with ${code}`))
        }
      })
    })
  } catch (e) {
    log.error('logs', 'collect_failed', { error: e as Error })
  }
}

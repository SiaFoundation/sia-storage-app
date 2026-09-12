/*
 * Opening the logs, all three of them.
 *
 * Which one holds the answer depends on what went wrong: a mount that will not
 * register is in this process's, a stalled sync in the daemon's, a folder that
 * lists wrong in the extension's. The extension is sandboxed and logs through
 * the system, so its entries are copied into a file here to be read beside the
 * others. Console rather than an editor, because it follows a file as it grows.
 */

import { execFile } from 'node:child_process'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { log } from './log'
import { dataDir, daemonLogPath, desktopLogPath, extensionLogPath } from './paths'

const run = promisify(execFile)

/** Matches `fpLog` in the extension. */
const SUBSYSTEM = 'sia.storage.fileprovider'
/** Far enough back to cover the session someone is asking about. */
const WINDOW = '1d'
/** `execFile` truncates at 1MB by default, which a day of entries overruns. */
const MAX_OUTPUT = 16 * 1024 * 1024

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
    await mkdir(dataDir(), { recursive: true })
    const { stdout } = await run(
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
      { maxBuffer: MAX_OUTPUT },
    )
    await writeFile(extensionLogPath(), stdout)
  } catch (e) {
    log.error('logs', 'collect_failed', { error: e as Error })
  }
}

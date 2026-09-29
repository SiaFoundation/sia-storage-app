/**
 * A lock file shared across `sim` processes. It holds the pid of the process
 * that took it, so a lock left by a killed process is taken over as soon as
 * that pid is gone, and a slow holder that is still alive keeps it however
 * long it works.
 */
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'
import { isAlive } from './process'
import { waitFor } from './wait'

function tryTake(path: string): boolean {
  try {
    const fd = openSync(path, 'wx')
    writeSync(fd, String(process.pid))
    closeSync(fd)
    return true
  } catch {
    const text = readFileSync(path, 'utf8')
    const holder = Number(text.trim())
    // An empty file is a holder between its create and its write, unless it
    // is old enough that the holder died in between.
    const stale = holder > 0 ? !isAlive(holder) : Date.now() - statSync(path).mtimeMs > 5_000
    // Removing and retrying, rather than overwriting, keeps the create the only
    // way to take the lock. The second read skips the remove when another
    // waiter has already replaced the stale lock, which leaves only the time
    // between that read and the remove for two processes to both win.
    if (stale && readFileSync(path, 'utf8') === text) {
      rmSync(path, { force: true })
    }
    return false
  }
}

export async function withFileLock<T>(
  path: string,
  fn: () => Promise<T>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  mkdirSync(dirname(path), { recursive: true })
  await waitFor(`the lock ${path}`, () => tryTake(path), {
    timeoutMs: opts.timeoutMs ?? 15 * 60_000,
    intervalMs: 250,
  })
  try {
    return await fn()
  } finally {
    rmSync(path, { force: true })
  }
}

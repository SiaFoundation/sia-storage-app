import * as fs from 'fs'

export type LockHandle = {
  fd: number
  release: () => void
}

/**
 * Claims the daemon's single-instance lock, or returns null if another process
 * holds it.
 *
 * `wx` is what does the excluding: it fails when the file exists, and the
 * kernel decides which of two racing callers creates it. A plain `w` would
 * succeed for both and let two daemons write one database.
 *
 * A lock whose owner is gone is taken over rather than honoured, because a
 * killed daemon leaves the file behind and nothing else would ever remove it.
 */
export function acquireLock(lockPath: string, pidPath: string): LockHandle | null {
  let fd = openExclusive(lockPath)
  if (fd === null && clearStaleLock(lockPath)) fd = openExclusive(lockPath)
  if (fd === null) return null

  try {
    fs.writeSync(fd, String(process.pid))
    fs.fsyncSync(fd)
    // Creating the file and writing the pid cannot be one step, so for an
    // instant the lock reads as empty, which is what a crashed claim also looks
    // like. A caller racing us in that instant clears it and takes its own; the
    // read-back is how the loser finds out rather than both running.
    if (readDaemonPid(lockPath) !== process.pid) {
      fs.closeSync(fd)
      return null
    }
    fs.writeFileSync(pidPath, String(process.pid))
  } catch {
    fs.closeSync(fd)
    return null
  }

  return {
    fd,
    release() {
      try {
        fs.closeSync(fd)
      } catch {
        // fd may already be closed
      }
      try {
        fs.unlinkSync(lockPath)
      } catch {
        // file may already be removed
      }
      try {
        fs.unlinkSync(pidPath)
      } catch {
        // file may already be removed
      }
    },
  }
}

function openExclusive(lockPath: string): number | null {
  try {
    return fs.openSync(lockPath, 'wx')
  } catch {
    return null
  }
}

/**
 * Removes a lock file whose owner is no longer running. An unreadable or empty
 * one counts as stale: it is what a process that died between creating the file
 * and writing its pid leaves behind.
 */
function clearStaleLock(lockPath: string): boolean {
  const owner = readDaemonPid(lockPath)
  if (owner !== null && isPidAlive(owner)) return false
  try {
    fs.unlinkSync(lockPath)
    return true
  } catch {
    return false
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function isDaemonRunning(pidPath: string): boolean {
  const pid = readDaemonPid(pidPath)
  return pid !== null && isPidAlive(pid)
}

export function readDaemonPid(pidPath: string): number | null {
  try {
    const raw = fs.readFileSync(pidPath, 'utf-8').trim()
    const pid = parseInt(raw, 10)
    return Number.isNaN(pid) ? null : pid
  } catch {
    return null
  }
}

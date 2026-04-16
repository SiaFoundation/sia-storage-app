import * as fs from 'fs'

export type LockHandle = {
  fd: number
  release: () => void
}

export function acquireLock(lockPath: string, pidPath: string): LockHandle | null {
  try {
    const fd = fs.openSync(lockPath, 'w')

    try {
      fs.ftruncateSync(fd)
      fs.writeSync(fd, String(process.pid))
      fs.fsyncSync(fd)

      fs.writeFileSync(pidPath, String(process.pid))

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
    } catch {
      fs.closeSync(fd)
      return null
    }
  } catch {
    return null
  }
}

export function isDaemonRunning(pidPath: string): boolean {
  const pid = readDaemonPid(pidPath)
  if (pid === null) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
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

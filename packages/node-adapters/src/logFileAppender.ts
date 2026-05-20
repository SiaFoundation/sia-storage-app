import { type Appender, formatPlainLog, type LogEntry } from '@siastorage/logger'
import * as fs from 'fs'
import * as path from 'path'

/** Cast to reach Node's `.unref()` so the timer doesn't hold a short-lived CLI open. */
function unref(t: ReturnType<typeof setTimeout>): void {
  ;(t as unknown as { unref?: () => void }).unref?.()
}

/**
 * Appends formatted log lines to a file. `batchMs = 0` (default) writes
 * synchronously; a positive value coalesces writes on a single unref'd
 * timer. `flush`/`stop` drain.
 */
export function createNodeFileLogAppender(
  filePath: string,
  opts: { batchMs?: number } = {},
): Appender {
  const queue: LogEntry[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let directoryEnsured = false

  function ensureDirectory(): void {
    if (directoryEnsured) return
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    directoryEnsured = true
  }

  function drain(): void {
    if (queue.length === 0) return
    ensureDirectory()
    const lines = queue.splice(0).map(formatPlainLog).join('\n') + '\n'
    fs.appendFileSync(filePath, lines)
  }

  function clearTimer(): void {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  return {
    write(entry) {
      if (!opts.batchMs) {
        queue.push(entry)
        drain()
        return
      }
      queue.push(entry)
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        drain()
      }, opts.batchMs)
      unref(timer)
    },
    flush() {
      clearTimer()
      drain()
    },
    stop() {
      clearTimer()
      drain()
    },
  }
}

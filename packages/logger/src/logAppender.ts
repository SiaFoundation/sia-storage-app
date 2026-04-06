import type { LogEntry } from './logger'

type LogAppender = (entries: LogEntry[]) => Promise<void> | void

let appender: LogAppender | null = null
const buffer: LogEntry[] = []
let flushTimer: ReturnType<typeof setInterval> | null = null

const FLUSH_INTERVAL = 2000

/** Append a log entry to the buffer. */
export function appendLog(entry: LogEntry): void {
  buffer.push(entry)
}

function flush(): void {
  if (buffer.length === 0 || !appender) return
  const entries = buffer.splice(0)
  appender(entries)
}

/** Register the log appender function, flush buffered entries, and start the flush interval. */
export function setLogAppender(fn: LogAppender): void {
  appender = fn
  flush()
  if (!flushTimer) {
    flushTimer = setInterval(flush, FLUSH_INTERVAL)
  }
}

/** Flush any buffered entries immediately. */
export function flushLogs(): void {
  flush()
}

/**
 * Gracefully stop the log appender: stop the flush interval, flush remaining
 * entries to the appender, then clear the appender. After this call no more
 * entries will be written.
 */
export async function stopLogAppender(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer)
    flushTimer = null
  }
  if (buffer.length > 0 && appender) {
    const entries = buffer.splice(0)
    await appender(entries)
  }
  appender = null
}

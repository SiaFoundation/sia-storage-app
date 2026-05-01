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
 * Stop the log appender: clear the flush interval and detach the appender.
 * Does NOT flush buffered entries — they remain in the buffer and flush on
 * the next setLogAppender call. Awaiting a DB flush here held iOS suspend
 * past beginBackgroundTask's budget by queuing behind in-flight service
 * queries on the expo-sqlite mutex (0xdead10cc).
 */
export function stopLogAppender(): void {
  if (flushTimer) {
    clearInterval(flushTimer)
    flushTimer = null
  }
  appender = null
}

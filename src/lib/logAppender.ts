import type { LogEntry } from './logger'

type LogAppender = (entry: LogEntry) => void

let appender: LogAppender | null = null

/** Append a log entry. No-op if no appender is registered. */
export function appendLog(entry: LogEntry): void {
  appender?.(entry)
}

/** Register the log appender function. */
export function setLogAppender(fn: LogAppender): void {
  appender = fn
}

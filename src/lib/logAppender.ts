import type { LogEntry } from './logger'

type LogAppender = (entry: LogEntry) => void

let appender: LogAppender | null = null
const queue: LogEntry[] = []

/** Append a log entry. Queues if no appender is registered yet. */
export function appendLog(entry: LogEntry): void {
  if (!appender) {
    queue.push(entry)
    return
  }
  appender(entry)
}

/** Register the log appender function and flush any queued entries. */
export function setLogAppender(fn: LogAppender): void {
  appender = fn
  for (const entry of queue) {
    fn(entry)
  }
  queue.length = 0
}

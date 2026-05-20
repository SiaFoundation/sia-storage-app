import {
  addAppender,
  type Appender,
  type LogEntry,
  removeAppender,
  serializeData,
} from '@siastorage/logger'
import type { AppService } from '../app/service'

const DRAIN_INTERVAL_MS = 2_000

/**
 * Persists log entries to the local `logs` table. `write` queues into
 * RAM; a 2s timer drains the batch into SQLite.
 */
class DbLogAppender implements Appender {
  private queue: LogEntry[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private paused = false
  private stopped = false

  constructor(private readonly app: AppService) {}

  write(entry: LogEntry): void {
    if (this.stopped) return
    this.queue.push(entry)
  }

  async flush(): Promise<void> {
    await this.drain()
  }

  /** Fire one in-flight write before the iOS suspend gate closes. Sync. */
  flushBeforeSuspend(): void {
    if (this.stopped || this.queue.length === 0) return
    void this.append(this.queue.splice(0)).catch(() => {})
  }

  start(): void {
    this.stopped = false
    this.paused = false
    if (this.timer) return
    this.timer = setInterval(() => void this.drain(), DRAIN_INTERVAL_MS)
    void this.drain()
  }

  pause(): void {
    this.paused = true
    this.clearTimer()
  }

  resume(): void {
    if (this.stopped) return
    this.start()
  }

  stop(): void {
    this.stopped = true
    this.clearTimer()
  }

  private clearTimer(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async drain(): Promise<void> {
    if (this.paused || this.stopped || this.queue.length === 0) return
    const batch = this.queue.splice(0)
    try {
      await this.append(batch)
    } catch {
      this.queue.unshift(...batch)
    }
  }

  private async append(entries: LogEntry[]): Promise<void> {
    await this.app.logs.appendMany(
      entries.map((e) => ({
        timestamp: e.timestamp,
        level: e.level,
        scope: e.scope,
        message: e.message,
        data: serializeData(e.data),
      })),
    )
  }
}

let instance: DbLogAppender | null = null

export async function initDbLogAppender(app: AppService): Promise<void> {
  if (instance) {
    instance.stop()
    removeAppender(instance)
  }
  instance = new DbLogAppender(app)
  addAppender(instance)
  instance.start()
}

export function flushDbLogAppenderBeforeSuspend(): void {
  instance?.flushBeforeSuspend()
}

export function pauseDbLogAppender(): void {
  instance?.pause()
}

export function resumeDbLogAppender(): void {
  instance?.resume()
}

export function shutdownDbLogAppender(): void {
  if (!instance) return
  instance.stop()
  removeAppender(instance)
  instance = null
}

export { DbLogAppender }

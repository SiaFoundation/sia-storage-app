import { minutesInMs } from './time'

const BASE_MS = minutesInMs(5)
const MAX_MS = minutesInMs(60)

type Entry = { attempts: number; retryAfter: number; reason?: string }

export type BackoffEntry = { id: string; attempts: number; retryAfter: number; reason?: string }

/**
 * In-memory backoff tracker for temporarily-failing items.
 *
 * Tracks IDs with exponential backoff (5 min → 15 min → 60 min cap).
 * Entries auto-expire when their retryAfter timestamp passes.
 * Resets on app restart, giving every item a clean retry.
 */
export class BackoffTracker {
  private entries = new Map<string, Entry>()

  /** True if the ID is in backoff and the retry window hasn't passed. */
  shouldSkip(id: string): boolean {
    const entry = this.entries.get(id)
    if (!entry) return false
    return Date.now() < entry.retryAfter
  }

  /** Record a skip, incrementing attempts and setting the next retry time. */
  recordSkip(id: string, reason?: string): void {
    const existing = this.entries.get(id)
    const attempts = (existing?.attempts ?? 0) + 1
    const delay = Math.min(BASE_MS * Math.pow(3, attempts - 1), MAX_MS)
    this.entries.set(id, { attempts, retryAfter: Date.now() + delay, reason })
  }

  /** All IDs currently in backoff (not yet expired). */
  getExcludeIds(): string[] {
    const now = Date.now()
    const ids: string[] = []
    for (const [id, entry] of this.entries) {
      if (now < entry.retryAfter) {
        ids.push(id)
      }
    }
    return ids
  }

  /** Remove an ID from tracking (item succeeded). */
  clear(id: string): void {
    this.entries.delete(id)
  }

  /** All entries with metadata (both active and expired). */
  getEntries(): BackoffEntry[] {
    const result: BackoffEntry[] = []
    for (const [id, entry] of this.entries) {
      result.push({ id, ...entry })
    }
    return result
  }

  /** Clear all entries (shutdown/reset). */
  reset(): void {
    this.entries.clear()
  }
}

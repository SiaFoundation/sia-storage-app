import { AbortError } from './errors'

type WaitEntry = {
  priority: number
  grant: () => void
  evict?: () => void
}

/**
 * A counting semaphore-style pool that limits the number of concurrent operations.
 * Use `withSlot` to run an async task while reserving one slot. Defaults to 5 slots.
 */
export class SlotPool {
  private maxSlots: number
  private inUseCount: number
  private waitQueue: WaitEntry[]

  constructor(maxSlots: number) {
    this.maxSlots = Math.max(1, Math.floor(maxSlots))
    this.inUseCount = 0
    this.waitQueue = []
  }

  /** Returns the current maximum number of concurrent slots. */
  getMaxSlots(): number {
    return this.maxSlots
  }

  /** Returns the number of slots currently in use. */
  getInUseCount(): number {
    return this.inUseCount
  }

  /** Returns the number of queued waiters. */
  getQueueSize(): number {
    return this.waitQueue.length
  }

  /** Updates the maximum number of slots. Minimum is 1. */
  setMaxSlots(nextMax: number): void {
    const newMax = Math.max(1, Math.floor(Number.isFinite(nextMax) ? nextMax : 1))
    this.maxSlots = newMax
    this.drain()
  }

  /**
   * Acquire a slot. Resolves with a release function to free the slot.
   * If an AbortSignal is provided and fires before a slot is granted, the
   * waiter is removed from the queue and the promise rejects with an
   * AbortError. Once a slot has been granted the signal is ignored — the
   * caller must release the slot normally.
   */
  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      throw new AbortError()
    }

    if (this.inUseCount < this.maxSlots) {
      this.inUseCount += 1
      return this.makeRelease()
    }

    return await new Promise<() => void>((resolve, reject) => {
      let settled = false

      const entry: WaitEntry = {
        priority: 0,
        grant: () => {
          if (settled) return
          settled = true
          if (signal) signal.removeEventListener('abort', onAbort)
          this.inUseCount += 1
          resolve(this.makeRelease())
        },
      }

      const onAbort = () => {
        if (settled) return
        settled = true
        const idx = this.waitQueue.indexOf(entry)
        if (idx !== -1) this.waitQueue.splice(idx, 1)
        reject(new AbortError())
      }

      this.waitQueue.push(entry)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  /**
   * Run an async function while holding one slot. Always releases.
   * If an AbortSignal is provided, it aborts the slot wait only (not the
   * task itself); the task receives no signal from this method.
   */
  async withSlot<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(signal)
    try {
      return await task()
    } finally {
      release()
    }
  }

  private makeRelease(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      this.inUseCount -= 1
      this.drain()
    }
  }

  private drain(): void {
    while (this.inUseCount < this.maxSlots && this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()
      if (next) next.grant()
    }
  }
}

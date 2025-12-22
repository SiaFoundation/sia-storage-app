import { logger } from '../lib/logger'

/**
 * A counting semaphore-style pool that limits the number of concurrent operations.
 * Use `withSlot` to run an async task while reserving one slot. Defaults to 5 slots.
 */
export class SlotPool {
  private maxSlots: number
  private inUseCount: number
  private waitQueue: Array<() => void>

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
    const newMax = Math.max(
      1,
      Math.floor(Number.isFinite(nextMax) ? nextMax : 1)
    )
    this.maxSlots = newMax
    this.drain()
  }

  /** Acquire a slot. Resolves with a release function to free the slot. */
  async acquire(): Promise<() => void> {
    if (this.inUseCount < this.maxSlots) {
      logger.debug(
        'slotPool',
        `acquired: inUse=${this.inUseCount + 1}/${
          this.maxSlots
        } queued=${Math.max(0, this.waitQueue.length - 1)}`
      )
      // Immediate acquisition.
      this.inUseCount += 1
      let released = false
      return () => {
        if (released) return
        released = true
        this.inUseCount -= 1
        this.drain()
      }
    }

    // Wait for a slot to free up.
    logger.debug(
      'slotPool',
      `waiting: inUse=${this.inUseCount}/${this.maxSlots} queued=${this.waitQueue.length}`
    )
    return await new Promise<() => void>((resolve) => {
      const grant = () => {
        logger.debug(
          'slotPool',
          `acquired: inUse=${this.inUseCount + 1}/${
            this.maxSlots
          } queued=${Math.max(0, this.waitQueue.length - 1)}`
        )
        this.inUseCount += 1
        let released = false
        const release = () => {
          if (released) return
          released = true
          this.inUseCount -= 1
          logger.debug(
            'slotPool',
            `released: inUse=${this.inUseCount}/${this.maxSlots} queued=${this.waitQueue.length}`
          )
          this.drain()
        }
        resolve(release)
      }
      this.waitQueue.push(grant)
    })
  }

  /** Run an async function while holding one slot. Always releases. */
  async withSlot<T>(task: () => Promise<T>): Promise<T> {
    const release = await this.acquire()
    try {
      return await task()
    } finally {
      release()
    }
  }

  private drain(): void {
    while (this.inUseCount < this.maxSlots && this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()
      if (next) next()
    }
  }
}

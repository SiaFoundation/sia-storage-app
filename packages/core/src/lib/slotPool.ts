import { AbortError } from './errors'

type WaitEntry = {
  priority: number
  weight: number
  key?: string
  grant: () => void
  evict: () => void
}

type AcquireOptions = {
  /** Lower numbers are served first. Same-priority waiters are LIFO. Default 0. */
  priority?: number
  /** When set, on insert the oldest entries of this priority beyond the limit are evicted with AbortError. */
  maxQueueDepth?: number
  /** Names the waiter, so promote() can move it while it waits. */
  key?: string
  /**
   * How much of the pool's capacity the holder uses while it runs, in
   * whatever unit the pool's capacity is given in. Default 0.
   */
  weight?: number
}

/**
 * A counting semaphore-style pool that limits the number of concurrent operations.
 * Use `withSlot` to run an async task while reserving one slot.
 *
 * A pool given a `capacity` also limits the total `weight` of what runs at
 * once, so many light operations can run together where heavy ones take
 * turns. One operation is always let in when nothing is running, however
 * heavy, so a weight above the capacity waits its turn rather than forever.
 *
 * The first waiter in serving order that does not fit holds back what it
 * needs, and waiters behind it run beside the current holders only in the
 * room left after that. Otherwise a stream of light operations queued behind
 * a heavy one would keep it waiting for as long as they kept arriving.
 */
export class SlotPool {
  private maxSlots: number
  private inUseCount: number
  private capacity: number
  private inUseWeight: number
  private waitQueue: WaitEntry[]

  constructor(maxSlots: number, opts?: { capacity?: number }) {
    this.maxSlots = Math.max(1, Math.floor(maxSlots))
    this.inUseCount = 0
    this.capacity = opts?.capacity ?? Number.POSITIVE_INFINITY
    this.inUseWeight = 0
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

  /** Returns the total weight of what is running. */
  getInUseWeight(): number {
    return this.inUseWeight
  }

  /** Updates the total weight that may run at once. Holders over it keep running. */
  setCapacity(capacity: number): void {
    this.capacity = Math.max(0, capacity)
    this.drain()
  }

  /**
   * Acquire a slot. Resolves with a release function to free the slot.
   *
   * If an AbortSignal is provided and fires before a slot is granted, the
   * waiter is removed from the queue and the promise rejects with an
   * AbortError. Once a slot has been granted the signal is ignored — the
   * caller must release the slot normally.
   *
   * `opts.priority` (default 0) orders waiters — lower numbers are served
   * first; within the same priority newer waiters go first (LIFO). When
   * `opts.maxQueueDepth` is set, inserting past that many same-priority
   * waiters evicts the oldest of that priority with AbortError.
   */
  async acquire(signal?: AbortSignal, opts?: AcquireOptions): Promise<() => void> {
    if (signal?.aborted) {
      throw new AbortError()
    }

    const weight = Math.max(0, opts?.weight ?? 0)
    if (this.waitQueue.length === 0 && this.fits(weight, 0, 0)) {
      return this.take(weight)
    }

    const priority = opts?.priority ?? 0
    const maxQueueDepth = opts?.maxQueueDepth

    return await new Promise<() => void>((resolve, reject) => {
      let settled = false

      const entry: WaitEntry = {
        priority,
        weight,
        key: opts?.key,
        grant: () => {
          if (settled) return
          settled = true
          if (signal) signal.removeEventListener('abort', onAbort)
          resolve(this.take(weight))
        },
        evict: () => {
          if (settled) return
          settled = true
          if (signal) signal.removeEventListener('abort', onAbort)
          const idx = this.waitQueue.indexOf(entry)
          if (idx !== -1) this.waitQueue.splice(idx, 1)
          reject(new AbortError())
        },
      }

      // A waiter that does not fit holds back its weight from those behind
      // it, so taking it out can let them run now.
      const onAbort = () => {
        entry.evict()
        this.drain()
      }

      this.insert(entry)
      signal?.addEventListener('abort', onAbort, { once: true })
      // A waiter queued behind one that does not fit may still fit beside it.
      this.drain()

      // Evict oldest same-priority entries beyond the depth cap.
      if (maxQueueDepth !== undefined) {
        const toEvict: WaitEntry[] = []
        let count = 0
        for (const e of this.waitQueue) {
          if (e.priority === priority) {
            count++
            if (count > maxQueueDepth) toEvict.push(e)
          }
        }
        for (const e of toEvict) e.evict()
      }
    })
  }

  /**
   * Moves the waiter named `key` up to `priority`, ahead of every waiter
   * below it. Nothing happens when no such waiter is queued or it already
   * waits at that priority or higher. A promoted waiter no longer counts
   * toward its old priority's queue depth, so that depth cannot evict it.
   */
  promote(key: string, priority: number): void {
    const at = this.waitQueue.findIndex((e) => e.key === key)
    if (at === -1 || this.waitQueue[at].priority <= priority) return
    const [entry] = this.waitQueue.splice(at, 1)
    entry.priority = priority
    this.insert(entry)
    this.drain()
  }

  /**
   * Inserts before the first entry with a strictly higher priority number,
   * which puts same-priority waiters at the front (LIFO within a priority).
   */
  private insert(entry: WaitEntry): void {
    let at = 0
    while (at < this.waitQueue.length && this.waitQueue[at].priority < entry.priority) at++
    this.waitQueue.splice(at, 0, entry)
  }

  /**
   * Run an async function while holding one slot. Always releases.
   * If an AbortSignal is provided, it aborts the slot wait only (not the
   * task itself); the task receives no signal from this method.
   */
  async withSlot<T>(
    task: () => Promise<T>,
    signal?: AbortSignal,
    opts?: AcquireOptions,
  ): Promise<T> {
    const release = await this.acquire(signal, opts)
    try {
      return await task()
    } finally {
      release()
    }
  }

  /**
   * Whether `weight` can start now, with `heldSlots` and `heldWeight` set
   * aside for an earlier waiter that does not fit yet.
   */
  private fits(weight: number, heldSlots: number, heldWeight: number): boolean {
    if (this.inUseCount + heldSlots >= this.maxSlots) return false
    if (this.inUseCount === 0 && heldSlots === 0) return true
    return this.inUseWeight + heldWeight + weight <= this.capacity
  }

  private take(weight: number): () => void {
    this.inUseCount += 1
    this.inUseWeight += weight
    let released = false
    return () => {
      if (released) return
      released = true
      this.inUseCount -= 1
      this.inUseWeight -= weight
      this.drain()
    }
  }

  private drain(): void {
    let heldSlots = 0
    let heldWeight = 0
    for (const entry of [...this.waitQueue]) {
      if (this.fits(entry.weight, heldSlots, heldWeight)) {
        this.waitQueue.splice(this.waitQueue.indexOf(entry), 1)
        entry.grant()
      } else if (heldSlots === 0) {
        heldSlots = 1
        heldWeight = entry.weight
      }
    }
  }
}

export class Mutex {
  private tail: Promise<void> = Promise.resolve()
  // Holders plus waiters. The lock is free only at zero: a released lock with
  // a waiter not yet resumed still counts that waiter.
  private claims = 0

  private claim(): () => void {
    this.claims++
    let resolve!: () => void
    this.tail = new Promise<void>((r) => {
      resolve = r
    })
    let released = false
    return () => {
      if (released) return
      released = true
      this.claims--
      resolve()
    }
  }

  /** Acquire the mutex; returns a release function to be called when done. */
  async acquire(): Promise<() => void> {
    const previous = this.tail
    const release = this.claim()
    await previous
    return release
  }

  /**
   * Takes the mutex in the calling tick when nobody holds or waits for it, and
   * returns null otherwise. acquire() always resolves a microtask later, even
   * when the mutex is free.
   */
  tryAcquire(): (() => void) | null {
    if (this.claims > 0) return null
    return this.claim()
  }

  /** Run a function exclusively under the mutex. */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire()
    try {
      return await fn()
    } finally {
      release()
    }
  }
}

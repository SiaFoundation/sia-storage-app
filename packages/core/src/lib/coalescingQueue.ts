/**
 * A queue that collapses redundant operations.
 *
 * Only the most recently enqueued operation is kept pending. If
 * multiple operations are enqueued while one is running, only the
 * last one executes after the current one completes. Earlier
 * pending operations are discarded.
 *
 * This is useful for state machines driven by external events
 * (e.g., AppState changes) where rapid toggling should not queue
 * up a long chain of transitions — only the latest intent matters.
 */
export class CoalescingQueue {
  private running: Promise<void> | null = null
  private pending: (() => Promise<void>) | null = null
  private pendingResolvers: Array<() => void> = []

  /**
   * Enqueue an operation. If an operation is already running, this
   * replaces any previously pending operation (collapsing the queue).
   * Returns a promise that resolves when this specific operation
   * completes or is discarded.
   */
  enqueue(fn: () => Promise<void>): Promise<void> {
    if (!this.running) {
      return this.run(fn)
    }

    // Resolve any previously pending operation that we're replacing
    for (const resolve of this.pendingResolvers) {
      resolve()
    }
    this.pendingResolvers = []

    return new Promise<void>((resolve) => {
      this.pending = fn
      this.pendingResolvers.push(resolve)
    })
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    this.running = (async () => {
      try {
        await fn()
      } finally {
        this.running = null
        if (this.pending) {
          const next = this.pending
          const resolvers = this.pendingResolvers
          this.pending = null
          this.pendingResolvers = []
          await this.run(next)
          for (const resolve of resolvers) {
            resolve()
          }
        }
      }
    })()
    return this.running
  }
}

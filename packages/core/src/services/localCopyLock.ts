/**
 * One lock per file id over a file's local copy, held while something writes
 * the copy or reads it out, so cache eviction never removes it partway.
 *
 * A download holds it from its first byte until its `fs` row is written, and a
 * Finder fetch holds it while it exports the copy. Eviction only ever tries the
 * lock and skips a file that is held: a download can hold it for as long as the
 * transfer takes, and an eviction pass waiting on it would stall every file
 * after it. Other removals, such as a delete, do not take it.
 */
export class LocalCopyLock {
  private readonly tails = new Map<string, Promise<void>>()

  /** Whether anything holds or is waiting for `fileId`'s lock. */
  isHeld(fileId: string): boolean {
    return this.tails.has(fileId)
  }

  /** Runs `fn` holding `fileId`'s lock, after every earlier holder has finished. */
  async run<T>(fileId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(fileId)
    let release!: () => void
    const done = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = (previous ?? Promise.resolve()).then(() => done)
    this.tails.set(fileId, tail)
    try {
      if (previous) await previous
      return await fn()
    } finally {
      release()
      // A later caller has queued behind this one when the tail moved on.
      if (this.tails.get(fileId) === tail) this.tails.delete(fileId)
    }
  }

  /** Runs `fn` holding the lock if nothing holds it now, otherwise skips it. */
  async tryRun<T>(
    fileId: string,
    fn: () => Promise<T>,
  ): Promise<{ ran: true; value: T } | { ran: false }> {
    if (this.isHeld(fileId)) return { ran: false }
    return { ran: true, value: await this.run(fileId, fn) }
  }
}

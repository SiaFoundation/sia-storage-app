export class Mutex {
  private tail: Promise<void> = Promise.resolve()

  /** Acquire the mutex; returns a release function to be called when done. */
  async acquire(): Promise<() => void> {
    const previous = this.tail
    let release!: () => void
    this.tail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    return release
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

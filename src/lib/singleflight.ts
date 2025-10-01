/**
 * Coalesces concurrent calls for the same key into a single
 * in-flight promise. Subsequent callers await the same result;
 * the entry is cleared once resolved/rejected.
 */
export class SingleFlight<K> {
  private inflight: Map<K, Promise<any>>

  constructor() {
    this.inflight = new Map()
  }

  do<T>(key: K, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key) as Promise<T> | undefined
    if (existing) return existing
    const p = fn()
      .then((val) => {
        this.inflight.delete(key)
        return val
      })
      .catch((err) => {
        this.inflight.delete(key)
        throw err
      })
    this.inflight.set(key, p)
    return p
  }
}

/** Convenience for single global key use-cases. */
export class SingleInit {
  private sf = new SingleFlight<string>()
  run<T>(fn: () => Promise<T>): Promise<T> {
    return this.sf.do('init', fn)
  }
}

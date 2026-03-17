/**
 * Batches high-frequency progress updates to reduce state churn.
 *
 * Collects updates and flushes them in a single batch using the provided
 * scheduler. Mobile passes `requestAnimationFrame`, Node passes
 * `(cb) => setTimeout(cb, 0)`.
 */
export function createProgressThrottle(
  update: (id: string, progress: number) => void,
  schedule: (callback: () => void) => void = (cb) => setTimeout(cb, 0),
): {
  set(id: string, progress: number): void
  flush(): void
} {
  const pending = new Map<string, number>()
  let scheduled = false

  function flush() {
    if (pending.size === 0) return
    for (const [id, progress] of pending) {
      update(id, progress)
    }
    pending.clear()
    scheduled = false
  }

  return {
    set(id: string, progress: number) {
      pending.set(id, progress)
      if (!scheduled) {
        scheduled = true
        schedule(flush)
      }
    },
    flush,
  }
}

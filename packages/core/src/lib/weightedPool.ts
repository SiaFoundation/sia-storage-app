/**
 * Cost-weighted concurrency limiter. A plain slot cap schedules badly when
 * item sizes span orders of magnitude: ten tiny photos can safely copy at
 * once, while ten 2 GB videos would thrash disk and memory. The pool admits
 * work while both the in-flight cost budget and the slot cap have room, so
 * small items run together and one huge file fills the budget and runs mostly
 * alone.
 *
 * An item is always admitted when the pool is idle, so an oversized item runs
 * instead of deadlocking. Cost is a scheduling hint: a
 * wrong cost skews scheduling, never correctness. Admission is opportunistic,
 * not FIFO; an over-budget item waits until the pool drains, and an unbounded
 * stream of small items would starve it, so callers submit bounded batches.
 */
export function createWeightedPool(opts: {
  budget: number
  maxConcurrent: number
  /** Cost for items with no known size; an unknown is never treated as free. */
  defaultCost: number
}) {
  let inFlightCost = 0
  let inFlightCount = 0
  const waiters: Array<() => void> = []

  function admissible(cost: number): boolean {
    if (inFlightCount === 0) return true
    return inFlightCount < opts.maxConcurrent && inFlightCost + cost <= opts.budget
  }

  function release(cost: number): void {
    inFlightCost -= cost
    inFlightCount--
    // Wake every waiter: admission depends on each waiter's own cost, so a
    // single wake could strand a small item behind an inadmissible big one.
    const woken = waiters.splice(0)
    for (const w of woken) w()
  }

  return {
    async run<T>(cost: number, fn: () => Promise<T>): Promise<T> {
      const c = cost > 0 ? cost : opts.defaultCost
      while (!admissible(c)) {
        await new Promise<void>((resolve) => waiters.push(resolve))
      }
      inFlightCost += c
      inFlightCount++
      try {
        return await fn()
      } finally {
        release(c)
      }
    },
  }
}

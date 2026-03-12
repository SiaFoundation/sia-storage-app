/**
 * Creates a debounced action that coalesces multiple trigger() calls
 * within a time window into a single fn() execution.
 *
 * Used for: cache invalidation, progress flush, and other scenarios
 * where rapid-fire calls should be batched into one.
 */
export function createDebouncedAction(fn: () => void, delayMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    trigger() {
      if (!timer) {
        timer = setTimeout(() => {
          timer = null
          fn()
        }, delayMs)
      }
    },
    flush() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      fn()
    },
  }
}

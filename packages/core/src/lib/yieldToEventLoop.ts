// Capture the real setTimeout before test frameworks (jest.useFakeTimers)
// can replace it. This ensures yields always resolve immediately even
// when fake timers are active.
const realSetTimeout = globalThis.setTimeout

/**
 * Yields control back to the JS event loop, allowing pending UI events
 * (touch, scroll, animations) to process before resuming work.
 * Use in loops that perform heavy or repeated async work on the JS thread.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => realSetTimeout(resolve, 0))
}

/**
 * Async polling utilities for core tests.
 */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface WaitForOptions {
  timeout?: number
  interval?: number
  message?: string
}

/**
 * Polls a condition function until it returns true or times out.
 */
export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  options: WaitForOptions = {},
): Promise<void> {
  const { timeout = 10_000, interval = 100, message = 'Condition' } = options
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    const result = await Promise.resolve(condition())
    if (result) {
      return
    }
    await sleep(interval)
  }

  throw new Error(`${message} not met within ${timeout}ms`)
}

/**
 * Waits for a value-returning function to return a truthy value.
 * Returns the value once available.
 */
export async function waitFor<T>(
  getter: () => T | Promise<T>,
  options: WaitForOptions = {},
): Promise<NonNullable<T>> {
  const { timeout = 10_000, interval = 100, message = 'Value' } = options
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    const result = await Promise.resolve(getter())
    if (result != null) {
      return result as NonNullable<T>
    }
    await sleep(interval)
  }

  throw new Error(`${message} not available within ${timeout}ms`)
}

/**
 * Waits for an array to reach a specific length.
 */
export async function waitForCount<T>(
  getter: () => T[] | Promise<T[]>,
  count: number,
  options: WaitForOptions = {},
): Promise<T[]> {
  const { timeout = 10_000, interval = 100, message = 'Count' } = options
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    const result = await Promise.resolve(getter())
    if (result.length >= count) {
      return result
    }
    await sleep(interval)
  }

  const finalResult = await Promise.resolve(getter())
  throw new Error(
    `${message} expected ${count} but got ${finalResult.length} within ${timeout}ms`,
  )
}

/**
 * Waits until no more changes occur in the value for a given duration.
 * Useful for waiting for "settling" after a series of operations.
 */
export async function waitForStable<T>(
  getter: () => T | Promise<T>,
  options: WaitForOptions & { stableTime?: number } = {},
): Promise<T> {
  const {
    timeout = 10_000,
    interval = 100,
    stableTime = 500,
    message = 'Value',
  } = options
  const startTime = Date.now()
  let lastValue = await Promise.resolve(getter())
  let lastChangeTime = Date.now()

  while (Date.now() - startTime < timeout) {
    await sleep(interval)
    const currentValue = await Promise.resolve(getter())
    const currentJson = JSON.stringify(currentValue)
    const lastJson = JSON.stringify(lastValue)

    if (currentJson !== lastJson) {
      lastValue = currentValue
      lastChangeTime = Date.now()
    }

    if (Date.now() - lastChangeTime >= stableTime) {
      return lastValue
    }
  }

  throw new Error(`${message} did not stabilize within ${timeout}ms`)
}

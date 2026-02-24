jest.mock('@siastorage/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), error: jest.fn() },
}))

import {
  createServiceInterval,
  shutdownAllServiceIntervals,
} from './serviceInterval'

beforeEach(async () => {
  jest.useFakeTimers()
  await shutdownAllServiceIntervals()
})

afterEach(() => {
  jest.useRealTimers()
})

test('shutdown waits for in-flight worker with abort signal loop', async () => {
  const iterations: number[] = []
  let resolveWork: (() => void) | null = null

  const { init } = createServiceInterval({
    name: 'loopService',
    worker: async (signal) => {
      let i = 0
      while (!signal.aborted) {
        i++
        iterations.push(i)
        await new Promise<void>((r) => {
          resolveWork = r
        })
      }
    },
    getState: async () => true,
    interval: 1000,
  })

  init()

  // Let the first tick fire.
  await jest.advanceTimersByTimeAsync(1000)

  // Worker is now in its loop, iteration 1 is waiting on resolveWork.
  expect(iterations).toEqual([1])

  // Complete iteration 1, worker loops and starts iteration 2.
  resolveWork!()
  await jest.advanceTimersByTimeAsync(0)
  expect(iterations).toEqual([1, 2])

  // Start shutdown while worker is mid-loop (iteration 2 waiting on resolveWork).
  const shutdownPromise = shutdownAllServiceIntervals()

  // Shutdown has aborted the signal but the worker is still awaiting resolveWork.
  let shutdownDone = false
  shutdownPromise.then(() => {
    shutdownDone = true
  })
  await jest.advanceTimersByTimeAsync(0)
  expect(shutdownDone).toBe(false)

  // Resolve the pending work — worker sees signal.aborted and exits.
  resolveWork!()
  await jest.advanceTimersByTimeAsync(0)

  // Shutdown should now be complete.
  await shutdownPromise
  expect(shutdownDone).toBe(true)

  // Worker exited after seeing abort, no iteration 3.
  expect(iterations).toEqual([1, 2])
})

test('shutdown waits for multiple services concurrently', async () => {
  let fastDone = false
  let slowResolve: (() => void) | null = null

  const fast = createServiceInterval({
    name: 'fast',
    worker: async () => {
      fastDone = true
    },
    getState: async () => true,
    interval: 100,
  })

  const slow = createServiceInterval({
    name: 'slow',
    worker: async () => {
      await new Promise<void>((r) => {
        slowResolve = r
      })
    },
    getState: async () => true,
    interval: 100,
  })

  fast.init()
  slow.init()

  // Let both fire.
  await jest.advanceTimersByTimeAsync(100)
  expect(fastDone).toBe(true)

  // Fast is done, slow is blocked.
  const shutdownPromise = shutdownAllServiceIntervals()

  let shutdownDone = false
  shutdownPromise.then(() => {
    shutdownDone = true
  })
  await jest.advanceTimersByTimeAsync(0)
  expect(shutdownDone).toBe(false)

  // Unblock slow worker.
  slowResolve!()
  await jest.advanceTimersByTimeAsync(0)

  await shutdownPromise
  expect(shutdownDone).toBe(true)
})

test('triggerNow is a noop while worker is running', async () => {
  let callCount = 0
  let resolveWork: (() => void) | null = null

  const { init, triggerNow } = createServiceInterval({
    name: 'triggerTest',
    worker: async () => {
      callCount++
      await new Promise<void>((r) => {
        resolveWork = r
      })
    },
    getState: async () => true,
    interval: 5000,
  })

  init()
  await jest.advanceTimersByTimeAsync(5000)
  expect(callCount).toBe(1)

  // Worker is in-flight. triggerNow should noop.
  triggerNow()
  await jest.advanceTimersByTimeAsync(0)
  expect(callCount).toBe(1)

  // Complete the worker.
  resolveWork!()
  await jest.advanceTimersByTimeAsync(0)

  // Now triggerNow should work.
  triggerNow()
  await jest.advanceTimersByTimeAsync(0)
  expect(callCount).toBe(2)
})

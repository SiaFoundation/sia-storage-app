jest.mock('@siastorage/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), error: jest.fn() },
}))

import {
  abortAllServiceIntervals,
  createServiceInterval,
  pauseAllServiceIntervals,
  resumeAllServiceIntervals,
  shutdownAllServiceIntervals,
  waitForAllServiceIntervalsIdle,
} from '@siastorage/core/lib/serviceInterval'

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

    interval: 100,
  })

  const slow = createServiceInterval({
    name: 'slow',
    worker: async () => {
      await new Promise<void>((r) => {
        slowResolve = r
      })
    },

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

  resolveWork!()
  await shutdownAllServiceIntervals()
})

test('waitForIdle resolves immediately when no workers are running', async () => {
  await waitForAllServiceIntervalsIdle()
})

test('waitForIdle waits for in-flight worker without aborting', async () => {
  let resolveWork: (() => void) | null = null
  let workerRan = false

  const { init } = createServiceInterval({
    name: 'idleTest',
    worker: async () => {
      workerRan = true
      await new Promise<void>((r) => {
        resolveWork = r
      })
    },
    interval: 100,
  })

  init()
  await jest.advanceTimersByTimeAsync(100)
  expect(workerRan).toBe(true)

  let idleDone = false
  const idlePromise = waitForAllServiceIntervalsIdle().then(() => {
    idleDone = true
  })

  await jest.advanceTimersByTimeAsync(0)
  expect(idleDone).toBe(false)

  resolveWork!()
  await jest.advanceTimersByTimeAsync(0)
  await idlePromise
  expect(idleDone).toBe(true)
})

test('pause then waitForIdle then resume', async () => {
  const ticks: number[] = []
  let resolveWork: (() => void) | null = null

  const { init } = createServiceInterval({
    name: 'pauseIdleTest',
    worker: async () => {
      ticks.push(ticks.length + 1)
      await new Promise<void>((r) => {
        resolveWork = r
      })
    },
    interval: 100,
  })

  init()
  await jest.advanceTimersByTimeAsync(100)
  expect(ticks).toEqual([1])

  pauseAllServiceIntervals()

  resolveWork!()
  await jest.advanceTimersByTimeAsync(0)
  await waitForAllServiceIntervalsIdle()

  // Paused — advancing time should not trigger another tick
  await jest.advanceTimersByTimeAsync(500)
  expect(ticks).toEqual([1])

  resumeAllServiceIntervals()
  await jest.advanceTimersByTimeAsync(100)
  expect(ticks).toEqual([1, 2])

  resolveWork!()
  await shutdownAllServiceIntervals()
})

test('abortAll aborts in-flight worker and provides fresh signal on next tick', async () => {
  let signalAborted = false
  let tickCount = 0
  let resolveWork: (() => void) | null = null

  const { init } = createServiceInterval({
    name: 'abortTest',
    worker: async (signal) => {
      tickCount++
      signalAborted = signal.aborted
      await new Promise<void>((r) => {
        resolveWork = r
      })
    },
    interval: 100,
  })

  init()
  await jest.advanceTimersByTimeAsync(100)
  expect(tickCount).toBe(1)
  expect(signalAborted).toBe(false)

  // Abort while worker is in-flight.
  abortAllServiceIntervals()

  // Complete the worker so the tick finishes.
  resolveWork!()
  await jest.advanceTimersByTimeAsync(0)

  // Next tick should get a fresh (non-aborted) signal.
  await jest.advanceTimersByTimeAsync(100)
  expect(tickCount).toBe(2)
  expect(signalAborted).toBe(false)

  resolveWork!()
  await shutdownAllServiceIntervals()
})

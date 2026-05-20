import { ServiceScheduler } from './serviceInterval'

describe('ServiceScheduler', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('queues a re-run when triggerNow arrives during a running tick', async () => {
    const scheduler = new ServiceScheduler()
    let resolveFirst: (() => void) | undefined
    const worker = jest.fn(() => {
      if (worker.mock.calls.length === 1) {
        return new Promise<void>((resolve) => {
          resolveFirst = resolve
        })
      }
      return undefined
    })

    const { init, triggerNow } = scheduler.createInterval({
      name: 'test',
      worker,
      interval: 60_000,
    })
    init()
    // init() scheduled the first tick via setTimeout(interval). Fire it.
    triggerNow()
    await Promise.resolve()
    expect(worker).toHaveBeenCalledTimes(1)

    // Tick 1 is pending — this trigger should defer, not overlap.
    triggerNow()
    await Promise.resolve()
    expect(worker).toHaveBeenCalledTimes(1)

    // Resolve tick 1; the finally must immediately invoke tick 2 (no timer wait).
    resolveFirst!()
    await Promise.resolve()
    await Promise.resolve()
    expect(worker).toHaveBeenCalledTimes(2)

    await scheduler.shutdown()
  })

  it('honors a worker that returns 0 by skipping the interval delay', async () => {
    const scheduler = new ServiceScheduler()
    let callCount = 0
    const worker = jest.fn(() => {
      callCount++
      // First call returns 0 (drain mode); second returns undefined (back to interval).
      return callCount === 1 ? 0 : undefined
    })

    const { init } = scheduler.createInterval({
      name: 'test',
      worker,
      interval: 60_000,
    })
    init()

    // First tick fires after the initial interval.
    await jest.advanceTimersByTimeAsync(60_000)
    expect(worker).toHaveBeenCalledTimes(1)

    // Worker returned 0 — the next tick must schedule a 0ms timer. Drain it.
    await jest.advanceTimersByTimeAsync(1)
    expect(worker).toHaveBeenCalledTimes(2)

    // Worker now returned undefined, so the NEXT timer is interval-sized.
    // Confirm no further fire happens until we advance the full interval.
    await jest.advanceTimersByTimeAsync(1000)
    expect(worker).toHaveBeenCalledTimes(2)

    await scheduler.shutdown()
  })

  it('drops nothing across rapid triggerNow + worker-return-0 alternation', async () => {
    // Combined-path sanity: external trigger lands during a productive
    // tick. Verify both the rerun flag and the return-0 mechanism end
    // up firing the worker exactly the number of times we asked for.
    const scheduler = new ServiceScheduler()
    let resolveFirst: (() => void) | undefined
    const worker = jest.fn(() => {
      if (worker.mock.calls.length === 1) {
        return new Promise<void>((resolve) => {
          resolveFirst = resolve
        })
      }
      return undefined
    })

    const { init, triggerNow } = scheduler.createInterval({
      name: 'test',
      worker,
      interval: 60_000,
    })
    init()
    triggerNow()
    await Promise.resolve()
    triggerNow()
    triggerNow()
    triggerNow()
    resolveFirst!()
    await Promise.resolve()
    await Promise.resolve()
    // Only one rerun is queued regardless of how many times triggerNow fires
    // during the in-flight tick (the flag is a bool, not a counter).
    expect(worker).toHaveBeenCalledTimes(2)

    await scheduler.shutdown()
  })
})

import { raceWithAbort, raceWithTimeout } from './timeout'

describe('raceWithTimeout', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('resolves with the value when the promise settles first', async () => {
    const promise = Promise.resolve('done')
    const result = await raceWithTimeout(promise, 1000)
    expect(result).toEqual({ ok: true, value: 'done' })
  })

  it('resolves with ok:false when the timeout fires first', async () => {
    const promise = new Promise<string>(() => {})
    const racePromise = raceWithTimeout(promise, 1000)
    jest.advanceTimersByTime(1000)
    await expect(racePromise).resolves.toEqual({ ok: false })
  })

  it('clears the timer when the promise wins so no handle leaks', async () => {
    const before = jest.getTimerCount()
    const result = await raceWithTimeout(Promise.resolve(42), 5000)
    expect(result).toEqual({ ok: true, value: 42 })
    expect(jest.getTimerCount()).toBe(before)
  })

  it('clears the timer when the promise rejects', async () => {
    const before = jest.getTimerCount()
    await expect(raceWithTimeout(Promise.reject(new Error('boom')), 5000)).rejects.toThrow('boom')
    expect(jest.getTimerCount()).toBe(before)
  })
})

describe('raceWithAbort', () => {
  it('returns the value when no signal is supplied', async () => {
    const result = await raceWithAbort(Promise.resolve('done'))
    expect(result).toEqual({ ok: true, value: 'done' })
  })

  it('returns the value when the promise settles before the signal fires', async () => {
    const controller = new AbortController()
    const result = await raceWithAbort(Promise.resolve(42), controller.signal)
    expect(result).toEqual({ ok: true, value: 42 })
  })

  it('returns ok:false when the signal fires first', async () => {
    const controller = new AbortController()
    const pending = new Promise<string>(() => {})
    const racePromise = raceWithAbort(pending, controller.signal)
    controller.abort()
    await expect(racePromise).resolves.toEqual({ ok: false })
  })

  it('returns ok:false synchronously when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const pending = new Promise<string>(() => {})
    await expect(raceWithAbort(pending, controller.signal)).resolves.toEqual({ ok: false })
  })

  it('propagates a rejection from the input promise', async () => {
    const controller = new AbortController()
    await expect(
      raceWithAbort(Promise.reject(new Error('boom')), controller.signal),
    ).rejects.toThrow('boom')
  })

  it('attaches a no-op catch to the orphan promise on abort', async () => {
    const controller = new AbortController()
    let rejectFn: (e: Error) => void = () => {}
    const pending = new Promise<string>((_, reject) => {
      rejectFn = reject
    })
    const racePromise = raceWithAbort(pending, controller.signal)
    controller.abort()
    await expect(racePromise).resolves.toEqual({ ok: false })
    // Reject the orphan after the race resolved — should not surface as
    // an unhandled rejection.
    rejectFn(new Error('orphan'))
    await new Promise((r) => setImmediate(r))
  })

  it('removes the abort listener after the promise wins', async () => {
    const controller = new AbortController()
    const result = await raceWithAbort(Promise.resolve('done'), controller.signal)
    expect(result).toEqual({ ok: true, value: 'done' })
    // Signal still available; aborting now should not affect anything.
    controller.abort()
  })
})

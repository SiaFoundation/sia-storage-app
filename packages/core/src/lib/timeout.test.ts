import { raceWithTimeout } from './timeout'

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

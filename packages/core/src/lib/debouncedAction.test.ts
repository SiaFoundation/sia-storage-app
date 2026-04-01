import { createDebouncedAction } from './debouncedAction'

describe('createDebouncedAction', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('coalesces rapid triggers into a single call', () => {
    const fn = jest.fn()
    const d = createDebouncedAction(fn, 1000)
    d.trigger()
    d.trigger()
    d.trigger()
    expect(fn).not.toHaveBeenCalled()
    jest.advanceTimersByTime(999)
    expect(fn).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('allows a subsequent trigger after the window elapses', () => {
    const fn = jest.fn()
    const d = createDebouncedAction(fn, 1000)
    d.trigger()
    jest.advanceTimersByTime(1000)
    d.trigger()
    jest.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('flush cancels the pending timer and invokes fn immediately', () => {
    const fn = jest.fn()
    const d = createDebouncedAction(fn, 1000)
    d.trigger()
    d.flush()
    expect(fn).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('flush invokes fn even when no trigger is pending', () => {
    const fn = jest.fn()
    const d = createDebouncedAction(fn, 1000)
    d.flush()
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

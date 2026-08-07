import { createCoalescer } from './coalescer'

describe('createCoalescer', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('runs at once on the first call in a quiet stretch', () => {
    const fn = jest.fn()
    const c = createCoalescer(fn, 1000)
    c.trigger()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('collapses a burst into the leading run and one trailing run', () => {
    const fn = jest.fn()
    const c = createCoalescer(fn, 1000)
    c.trigger()
    c.trigger()
    c.trigger()
    expect(fn).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(999)
    expect(fn).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('keeps running once per window through a sustained stream', () => {
    const fn = jest.fn()
    const c = createCoalescer(fn, 1000)
    // Five seconds of triggers, one window wide: the leading run plus one each.
    for (let i = 0; i < 50; i++) {
      c.trigger()
      jest.advanceTimersByTime(100)
    }
    expect(fn).toHaveBeenCalledTimes(6)
  })

  it('runs at once again after a window closes quiet', () => {
    const fn = jest.fn()
    const c = createCoalescer(fn, 1000)
    c.trigger()
    jest.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(1)
    c.trigger()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('flush runs the marked run now and nothing fires later', () => {
    const fn = jest.fn()
    const c = createCoalescer(fn, 1000)
    c.trigger()
    c.trigger()
    c.flush()
    expect(fn).toHaveBeenCalledTimes(2)
    jest.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('flush runs even when nothing is marked', () => {
    const fn = jest.fn()
    const c = createCoalescer(fn, 1000)
    c.flush()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('cancel drops the marked run', () => {
    const fn = jest.fn()
    const c = createCoalescer(fn, 1000)
    c.trigger()
    c.trigger()
    c.cancel()
    jest.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

import { BackoffTracker } from './backoffTracker'

describe('BackoffTracker', () => {
  let tracker: BackoffTracker

  beforeEach(() => {
    jest.useFakeTimers()
    tracker = new BackoffTracker()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('shouldSkip returns false for unknown IDs', () => {
    expect(tracker.shouldSkip('unknown')).toBe(false)
  })

  it('shouldSkip returns true after recordSkip', () => {
    tracker.recordSkip('a')
    expect(tracker.shouldSkip('a')).toBe(true)
  })

  it('expires after first backoff interval (5 min)', () => {
    tracker.recordSkip('a')
    jest.advanceTimersByTime(5 * 60 * 1000)
    expect(tracker.shouldSkip('a')).toBe(false)
  })

  it('does not expire before backoff interval', () => {
    tracker.recordSkip('a')
    jest.advanceTimersByTime(5 * 60 * 1000 - 1)
    expect(tracker.shouldSkip('a')).toBe(true)
  })

  it('escalates backoff: 5 min → 15 min → 60 min', () => {
    // First skip: 5 min
    tracker.recordSkip('a')
    jest.advanceTimersByTime(5 * 60 * 1000)
    expect(tracker.shouldSkip('a')).toBe(false)

    // Second skip: 15 min
    tracker.recordSkip('a')
    jest.advanceTimersByTime(15 * 60 * 1000 - 1)
    expect(tracker.shouldSkip('a')).toBe(true)
    jest.advanceTimersByTime(1)
    expect(tracker.shouldSkip('a')).toBe(false)

    // Third skip: 45 min (5 * 3^2)
    tracker.recordSkip('a')
    jest.advanceTimersByTime(45 * 60 * 1000 - 1)
    expect(tracker.shouldSkip('a')).toBe(true)
    jest.advanceTimersByTime(1)
    expect(tracker.shouldSkip('a')).toBe(false)

    // Fourth skip: capped at 60 min (5 * 3^3 = 135, capped to 60)
    tracker.recordSkip('a')
    jest.advanceTimersByTime(60 * 60 * 1000 - 1)
    expect(tracker.shouldSkip('a')).toBe(true)
    jest.advanceTimersByTime(1)
    expect(tracker.shouldSkip('a')).toBe(false)
  })

  it('cap never exceeds 60 min even after many attempts', () => {
    for (let i = 0; i < 10; i++) {
      tracker.recordSkip('a')
      jest.advanceTimersByTime(60 * 60 * 1000)
    }
    tracker.recordSkip('a')
    jest.advanceTimersByTime(60 * 60 * 1000 - 1)
    expect(tracker.shouldSkip('a')).toBe(true)
    jest.advanceTimersByTime(1)
    expect(tracker.shouldSkip('a')).toBe(false)
  })

  it('getExcludeIds returns all active backoff IDs', () => {
    tracker.recordSkip('a')
    tracker.recordSkip('b')
    tracker.recordSkip('c')
    expect(tracker.getExcludeIds().sort()).toEqual(['a', 'b', 'c'])
  })

  it('getExcludeIds excludes expired entries', () => {
    tracker.recordSkip('a')
    tracker.recordSkip('b')
    jest.advanceTimersByTime(5 * 60 * 1000)
    expect(tracker.getExcludeIds()).toEqual([])
  })

  it('clear removes a specific ID', () => {
    tracker.recordSkip('a')
    tracker.recordSkip('b')
    tracker.clear('a')
    expect(tracker.shouldSkip('a')).toBe(false)
    expect(tracker.shouldSkip('b')).toBe(true)
  })

  it('reset clears all entries', () => {
    tracker.recordSkip('a')
    tracker.recordSkip('b')
    tracker.reset()
    expect(tracker.shouldSkip('a')).toBe(false)
    expect(tracker.shouldSkip('b')).toBe(false)
    expect(tracker.getExcludeIds()).toEqual([])
  })

  it('tracks independent backoff per ID', () => {
    tracker.recordSkip('a')
    jest.advanceTimersByTime(3 * 60 * 1000)
    tracker.recordSkip('b')
    jest.advanceTimersByTime(2 * 60 * 1000)

    // a: 5 min elapsed, should be expired
    expect(tracker.shouldSkip('a')).toBe(false)
    // b: 2 min elapsed, still in backoff
    expect(tracker.shouldSkip('b')).toBe(true)
  })
})

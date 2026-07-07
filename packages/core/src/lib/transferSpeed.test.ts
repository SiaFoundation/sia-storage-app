import { TransferSpeedTracker } from './transferSpeed'

describe('TransferSpeedTracker', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('returns null with no samples', () => {
    const tracker = new TransferSpeedTracker()
    expect(tracker.bytesPerSecond()).toBeNull()
  })

  it('returns null under minActiveMs of measured transfer time', () => {
    const tracker = new TransferSpeedTracker(2_000, 1)
    tracker.addSample(1_000_000, 1_500)
    expect(tracker.bytesPerSecond()).toBeNull()
  })

  it('returns null under minSamples transfers', () => {
    const tracker = new TransferSpeedTracker(1_000, 3)
    tracker.addSample(1_000_000, 1_000)
    jest.advanceTimersByTime(1_000)
    tracker.addSample(1_000_000, 1_000)
    expect(tracker.bytesPerSecond()).toBeNull()
    jest.advanceTimersByTime(1_000)
    tracker.addSample(1_000_000, 1_000)
    expect(tracker.bytesPerSecond()).not.toBeNull()
  })

  it('divides by in-flight time, excluding gaps between transfers', () => {
    const tracker = new TransferSpeedTracker(2_000, 4)
    // Four 1 MB transfers, each 500ms in flight, arriving 1s apart: 2s of
    // transfer time spread over 4s of wall clock.
    for (let i = 0; i < 4; i++) {
      jest.advanceTimersByTime(1_000)
      tracker.addSample(1_000_000, 500)
    }
    expect(tracker.bytesPerSecond()).toBe(2_000_000)
  })

  it('merges overlapping parallel transfers instead of double-counting time', () => {
    const tracker = new TransferSpeedTracker(2_000, 3)
    jest.advanceTimersByTime(5_000)
    // Three transfers spanning the same 2s: 3 MB over 2s, not over 6s.
    tracker.addSample(1_000_000, 2_000)
    tracker.addSample(1_000_000, 2_000)
    tracker.addSample(1_000_000, 2_000)
    expect(tracker.bytesPerSecond()).toBe(1_500_000)
  })

  it('has no window: idle changes nothing and old transfers still count', () => {
    const tracker = new TransferSpeedTracker(1_000, 1)
    tracker.addSample(1_000_000, 1_000)
    jest.advanceTimersByTime(10 * 60 * 1000)
    expect(tracker.bytesPerSecond()).toBe(1_000_000)
    tracker.addSample(3_000_000, 1_000)
    // 4 MB over 2s of transfer time; the idle ten minutes contribute nothing.
    expect(tracker.bytesPerSecond()).toBe(2_000_000)
  })

  it('counts a transfer reaching past the frontier only from the frontier', () => {
    const tracker = new TransferSpeedTracker(1_000, 1)
    jest.advanceTimersByTime(10_000)
    tracker.addSample(1_000_000, 1_000)
    jest.advanceTimersByTime(500)
    // Started 1.5s before the previous transfer's end but only the 500ms
    // past the frontier counts; the overlap is already covered.
    tracker.addSample(1_000_000, 2_000)
    expect(tracker.bytesPerSecond()).toBeCloseTo((2_000_000 / 1_500) * 1_000, 5)
  })

  it('seed merges persisted totals so the reading is available immediately', () => {
    const tracker = new TransferSpeedTracker(1_000, 10)
    tracker.seed({ totalBytes: 10_000_000, activeMs: 10_000, sampleCount: 10 })
    expect(tracker.bytesPerSecond()).toBe(1_000_000)
  })

  it('caps history weight so new data can still move the average', () => {
    const tracker = new TransferSpeedTracker(1_000, 1, 10_000)
    tracker.seed({ totalBytes: 20_000_000, activeMs: 16_000, sampleCount: 10 })
    // Capped to 10s of history at the same 1.25 MB/s average.
    expect(tracker.bytesPerSecond()).toBe(1_250_000)
    jest.advanceTimersByTime(1_000)
    tracker.addSample(10_000_000, 1_000)
    // 12.5 MB of capped history plus 10 MB new, over 11s of transfer time.
    expect(tracker.bytesPerSecond()).toBeCloseTo(((12_500_000 + 10_000_000) / 11_000) * 1_000, 5)
  })

  it('reset drops history without breaking later tracking', () => {
    const tracker = new TransferSpeedTracker(2_000, 1)
    tracker.addSample(100_000_000, 2_000)
    tracker.reset()
    expect(tracker.bytesPerSecond()).toBeNull()
    tracker.addSample(1_000_000, 4_000)
    expect(tracker.bytesPerSecond()).toBe(250_000)
  })
})

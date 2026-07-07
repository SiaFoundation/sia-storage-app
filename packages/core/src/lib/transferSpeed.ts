const DEFAULT_MIN_ACTIVE_MS = 5_000
const DEFAULT_MIN_SAMPLES = 10
const DEFAULT_MAX_ACTIVE_MS = 30 * 60_000

/** Compact running totals, suitable for persisting across app sessions. */
export type TransferSpeedSnapshot = {
  totalBytes: number
  activeMs: number
  sampleCount: number
}

/**
 * Running-average throughput: total bytes over total in-flight time.
 * Each sample is a completed transfer with its measured duration, forming
 * the interval [arrival - elapsedMs, arrival]. Only the union of those
 * intervals counts as time, so queue/packing gaps and idle contribute
 * nothing and parallel transfers aren't double-counted. No recency window:
 * a windowed reading jumps as bursts and slow-host stragglers enter and
 * leave it, and this feeds a display labeled as an average.
 *
 * History weight is capped at maxActiveMs of transfer time: when the total
 * exceeds it, both totals scale down proportionally, preserving the
 * average while letting new data keep moving it. Without the cap, weeks of
 * accumulated history would make the reading immovable.
 *
 * Sample arrivals are monotonic, so the union is maintained online with a
 * single coveredUntil frontier. A transfer reaching back past the frontier
 * into an uncovered hole undercounts that hole's time, which is accepted:
 * holes are pauses, so the error is a slightly high reading.
 */
export class TransferSpeedTracker {
  private totalBytes = 0
  private activeMs = 0
  private coveredUntil = 0
  private sampleCount = 0

  constructor(
    private minActiveMs = DEFAULT_MIN_ACTIVE_MS,
    private minSamples = DEFAULT_MIN_SAMPLES,
    private maxActiveMs = DEFAULT_MAX_ACTIVE_MS,
  ) {}

  /** Record a completed transfer of `bytes` that took `elapsedMs`. */
  addSample(bytes: number, elapsedMs: number): void {
    const end = Date.now()
    const from = Math.max(end - elapsedMs, this.coveredUntil)
    if (end > from) this.activeMs += end - from
    this.coveredUntil = Math.max(this.coveredUntil, end)
    this.totalBytes += bytes
    this.sampleCount += 1
    this.capHistory()
  }

  /**
   * Bytes/sec over accumulated in-flight time. Returns null until
   * minSamples transfers and minActiveMs of measured transfer time exist:
   * the first transfers run during connection warm-up, so an early reading
   * is both noisy and biased low.
   */
  bytesPerSecond(): number | null {
    if (this.sampleCount < this.minSamples || this.activeMs < this.minActiveMs) return null
    return (this.totalBytes / this.activeMs) * 1000
  }

  /** Current totals for persistence. */
  snapshot(): TransferSpeedSnapshot {
    return {
      totalBytes: this.totalBytes,
      activeMs: this.activeMs,
      sampleCount: this.sampleCount,
    }
  }

  /**
   * Merge persisted totals into the current ones. Merging (not replacing)
   * makes seeding safe even after live samples have already arrived.
   */
  seed(snapshot: TransferSpeedSnapshot): void {
    this.totalBytes += snapshot.totalBytes
    this.activeMs += snapshot.activeMs
    this.sampleCount += snapshot.sampleCount
    this.capHistory()
  }

  /** Restart measurement from zero. */
  reset(): void {
    this.totalBytes = 0
    this.activeMs = 0
    this.coveredUntil = 0
    this.sampleCount = 0
  }

  private capHistory(): void {
    if (this.activeMs <= this.maxActiveMs) return
    const ratio = this.maxActiveMs / this.activeMs
    this.totalBytes *= ratio
    this.activeMs = this.maxActiveMs
  }
}

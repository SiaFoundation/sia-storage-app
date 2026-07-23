import Foundation

/// Progress-event gate: emit when at least 100ms elapsed or at least 1MB
/// moved since the last emission. The first update always passes. The last
/// throttled event may under-report; completion is signaled by the copy's
/// result, not by a final progress event.
public struct ProgressThrottle {
  public static let minInterval: TimeInterval = 0.1
  public static let minBytes: Int64 = 1_048_576

  private var lastBytes: Int64 = -1
  private var lastTime: TimeInterval = -1

  public init() {}

  public mutating func shouldEmit(bytes: Int64, now: TimeInterval) -> Bool {
    if lastTime < 0 || now - lastTime >= Self.minInterval || bytes - lastBytes >= Self.minBytes {
      lastBytes = bytes
      lastTime = now
      return true
    }
    return false
  }
}

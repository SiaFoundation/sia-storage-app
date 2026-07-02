import Foundation

/// Process-wide cancellation registry shared by both module classes, so one
/// copyId namespace covers `copyToPath` and `copyAsset`. Completion and cancel
/// race to exactly one outcome: a copy that already finished ignores a late
/// cancel; a cancelled copy must never deliver a result (the copier checks
/// `isCancelled` between chunks and `finish` reports whether cancel won).
public final class CopyRegistry {
  public static let shared = CopyRegistry()

  private struct Entry {
    var cancelled = false
    var onCancel: (() -> Void)?
  }

  private let lock = NSLock()
  private var entries: [String: Entry] = [:]

  public init() {}

  public func register(_ copyId: String, onCancel: (() -> Void)? = nil) {
    lock.lock()
    defer { lock.unlock() }
    entries[copyId] = Entry(cancelled: false, onCancel: onCancel)
  }

  /// Unknown ids no-op. Fires the entry's cancel action at most once.
  public func cancel(_ copyId: String) {
    lock.lock()
    guard var entry = entries[copyId], !entry.cancelled else {
      lock.unlock()
      return
    }
    entry.cancelled = true
    let action = entry.onCancel
    entry.onCancel = nil
    entries[copyId] = entry
    lock.unlock()
    action?()
  }

  public func isCancelled(_ copyId: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return entries[copyId]?.cancelled ?? false
  }

  /// Removes the entry; returns whether cancel won the race (caller must then
  /// suppress its result).
  @discardableResult
  public func finish(_ copyId: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    let wasCancelled = entries[copyId]?.cancelled ?? false
    entries[copyId] = nil
    return wasCancelled
  }
}

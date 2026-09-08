import Foundation

/// A value behind a lock. Provider callbacks, the change stream's callbacks
/// and the sync-anchor request arrive on arbitrary queues, so state shared
/// between them cannot be a bare stored property.
final class LockedBox<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value
    init(_ value: Value) { self.value = value }
    func get() -> Value { lock.withLock { value } }
    func set(_ new: Value) { lock.withLock { value = new } }
    /// Read-modify-write under the one lock, so a bump can't race a concurrent get/set.
    func mutate(_ transform: (inout Value) -> Void) { lock.withLock { transform(&value) } }
}

import Foundation

/// Ref-keyed, idempotent security-scope bookkeeping. iOS scopes must be
/// balanced exactly: double-open holds one scope, close without open and
/// double-close are no-ops. Open/close effects are injected closures so the
/// semantics are host-testable without real scoped URLs. The registry is
/// process-lifetime; after a restart nothing is open and callers re-open
/// lazily.
public final class ScopeRegistry {
  public static let shared = ScopeRegistry()

  private let lock = NSLock()
  private var open: Set<String> = []

  public init() {}

  /// Returns whether the scope is open after the call. `openFn` runs only when
  /// the key is not already open; a false return (URL not actually scoped, e.g.
  /// a tmp-Inbox copy) is not recorded so there is never an unbalanced stop.
  @discardableResult
  public func open(key: String, using openFn: () -> Bool) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    if open.contains(key) { return true }
    if openFn() {
      open.insert(key)
      return true
    }
    return false
  }

  /// Runs `closeFn` only if this registry opened the key; forgets the key.
  public func close(key: String, using closeFn: () -> Void) {
    lock.lock()
    defer { lock.unlock() }
    if open.remove(key) != nil {
      closeFn()
    }
  }

}

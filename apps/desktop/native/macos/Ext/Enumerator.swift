// Feeds one folder's contents to fileproviderd, and reports what changed
// since it last asked.

import FileProvider
import Foundation
import SiaShared

public final class SiaEnumerator: NSObject, NSFileProviderEnumerator {
    private let rpc: Rpc
    private let containerId: String?
    /// The version handshake. The daemon checks it only on the handshake itself,
    /// so a stale extension is stopped here or not at all.
    private let ready: @Sendable () async throws -> Void
    /// The anchor the last finished enumeration ended at, reported as the
    /// current sync anchor so the first delta starts where the listing
    /// stopped instead of replaying from zero with no folder fingerprint.
    /// Locked: enumeration and the anchor request arrive on different queues.
    private let finalAnchor = LockedBox<String?>(nil)

    public init(
        rpc: Rpc, containerId: String?, ready: @escaping @Sendable () async throws -> Void
    ) {
        self.rpc = rpc
        self.containerId = containerId
        self.ready = ready
    }

    public func invalidate() {}

    public func enumerateItems(
        for observer: NSFileProviderEnumerationObserver, startingAt page: NSFileProviderPage
    ) {
        Task {
            do {
                try await ready()
                let cursor = Self.cursor(from: page)
                let args: [Any] = cursor.map { [containerArg, $0] } ?? [containerArg]
                let result = try await rpc.callDecoding(ProviderPage.self, Channel.list, args)

                fpLog.debug("enumerated \(result.items.count, privacy: .public) item(s)")
                observer.didEnumerate(result.items.map { SiaItem($0) })
                if let next = result.cursor {
                    observer.finishEnumerating(upTo: NSFileProviderPage(Data(next.utf8)))
                } else {
                    if let anchor = result.anchor { finalAnchor.set(anchor) }
                    observer.finishEnumerating(upTo: nil)
                }
            } catch {
                fpLog.failure("enumerate failed", error)
                observer.finishEnumeratingWithError(mapError(error))
            }
        }
    }

    public func enumerateChanges(
        for observer: NSFileProviderChangeObserver, from anchor: NSFileProviderSyncAnchor
    ) {
        Task {
            do {
                try await ready()
                let from = String(data: anchor.rawValue, encoding: .utf8) ?? "0"
                let result = try await rpc.callDecoding(
                    ProviderChanges.self, Channel.changes, [containerArg, from])

                // A deletion is reported by naming what went, and a deleted
                // folder leaves nothing to name, so the anchor expires instead.
                if result.expired {
                    fpLog.notice("anchor expired; relisting")
                    observer.finishEnumeratingWithError(
                        fpError(.syncAnchorExpired, "The folder list changed"))
                    return
                }

                if !result.items.isEmpty {
                    observer.didUpdate(result.items.map { SiaItem($0) })
                }
                if !result.deletedIds.isEmpty {
                    observer.didDeleteItems(
                        withIdentifiers: result.deletedIds.map {
                            NSFileProviderItemIdentifier($0)
                        })
                }
                // Reporting no more on a cut-short page would strand the rest
                // until a signal the OS is never owed for a change it knows.
                observer.finishEnumeratingChanges(
                    upTo: NSFileProviderSyncAnchor(Data(result.anchor.utf8)),
                    moreComing: result.hasMore)
            } catch {
                observer.finishEnumeratingWithError(mapError(error))
            }
        }
    }

    public func currentSyncAnchor(
        completionHandler: @escaping (NSFileProviderSyncAnchor?) -> Void
    ) {
        // Zero until an enumeration has finished: a fresh anchor would tell
        // the OS it is up to date with changes it has never seen. After one,
        // the anchor its final page reported.
        completionHandler(NSFileProviderSyncAnchor(Data((finalAnchor.get() ?? "0").utf8)))
    }

    private var containerArg: Any { containerId ?? NSNull() }

    /// The OS passes its own sentinel pages for the initial request; only a page
    /// we minted carries a cursor.
    static func cursor(from page: NSFileProviderPage) -> String? {
        if page.rawValue == NSFileProviderPage.initialPageSortedByName as Data { return nil }
        if page.rawValue == NSFileProviderPage.initialPageSortedByDate as Data { return nil }
        return String(data: page.rawValue, encoding: .utf8)
    }
}

/// A value behind a lock. Enumeration and the sync-anchor request arrive on
/// arbitrary queues, so shared state here cannot be a bare stored property.
final class LockedBox<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value
    init(_ value: Value) { self.value = value }
    func get() -> Value { lock.withLock { value } }
    func set(_ new: Value) { lock.withLock { value = new } }
}

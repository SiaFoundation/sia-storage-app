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

                fpLog.info("enumerated \(result.items.count, privacy: .public) item(s)")
                observer.didEnumerate(result.items.map { SiaItem($0) })
                if let next = result.cursor {
                    observer.finishEnumerating(upTo: NSFileProviderPage(Data(next.utf8)))
                } else {
                    observer.finishEnumerating(upTo: nil)
                }
            } catch {
                fpLog.error("enumerate failed: \(error.localizedDescription, privacy: .public)")
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

                // A deleted folder leaves nothing behind to name, and a deletion
                // is reported by naming what went. The daemon answers that the
                // anchor is too old instead, which sends the system back to
                // enumerateItems, and a listing says what exists rather than
                // what changed.
                if result.expired {
                    fpLog.info("anchor expired; relisting")
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
                // Reporting no more when a page was cut short would leave the
                // rest unread until the next signal, and a signal is not owed
                // for a change the OS has already been told about.
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
        // Zero rather than the current clock: a fresh anchor would tell the OS
        // it is already up to date with changes it has never seen.
        completionHandler(NSFileProviderSyncAnchor(Data("0".utf8)))
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

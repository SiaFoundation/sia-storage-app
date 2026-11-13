// Reading which files Finder holds, for the daemon's eviction pass.
//
// The system drops Finder's copy of a file on its own, from Remove Download
// or under low disk, and tells the extension only that the set changed
// (`materializedItemsDidChange`), not which files. The daemon learns which
// here, to keep its record of what Finder holds. The daemon runs this program with
// `materialized <domainId> <out> [anchor]`. With no anchor it lists the whole
// materialized set. With one it reads only what changed since, which costs
// little however large the set is. Either way it writes the anchor to pass
// next time.
//
// The set holds only items whose contents are fully on disk, folders
// included. A partial download is not in it. The daemon tracks those from
// the ranges it serves.

import FileProvider
import Foundation

/// The materialized set of one domain, behind a protocol so a test can answer
/// for the system.
public protocol MaterializedSet {
    /// Every item in the set, and the anchor that reads changes after it.
    func all(domainId: String) async throws -> (ids: [String], anchor: Data)
    /// What changed since `anchor`. Throws `MaterializedError.expired` when
    /// the system will not read changes from that anchor, whatever its reason.
    func changes(domainId: String, since anchor: Data) async throws -> (
        updated: [String], deleted: [String], anchor: Data
    )
}

public enum MaterializedError: Error, Equatable {
    case expired
    /// The system gave no anchor to read changes from after a full walk.
    case noAnchor
}

public enum Materialized {
    /// The written result, as JSON. `full` is set after a full walk, `added`
    /// and `removed` after a change read. A change read the system refused
    /// answers with a full walk.
    public struct Result: Equatable, Encodable {
        public var anchor: String
        public var full: [String]?
        public var added: [String]?
        public var removed: [String]?
    }

    public static func run(domainId: String, anchor: String?, set: MaterializedSet) async throws
        -> Result
    {
        // An anchor the system will not read from, expired or not, falls back to
        // a full walk here. Failing instead would have the daemon keep the
        // anchor and fail on every pass, and stop following removals for good.
        if let anchor, let data = Data(base64Encoded: anchor) {
            do {
                let read = try await set.changes(domainId: domainId, since: data)
                return Result(
                    anchor: read.anchor.base64EncodedString(), added: files(read.updated),
                    removed: files(read.deleted))
            } catch MaterializedError.expired {}
        }
        let walk = try await set.all(domainId: domainId)
        return Result(anchor: walk.anchor.base64EncodedString(), full: files(walk.ids))
    }

    /// File ids only. The set also holds every materialized folder, named
    /// `dir:<id>` by the daemon, and the system's own root and trash.
    static func files(_ ids: [String]) -> [String] {
        let system: Set<String> = [
            NSFileProviderItemIdentifier.rootContainer.rawValue,
            NSFileProviderItemIdentifier.trashContainer.rawValue,
            NSFileProviderItemIdentifier.workingSet.rawValue,
        ]
        return ids.filter { !$0.hasPrefix("dir:") && !system.contains($0) }
    }
}

/// The real system.
public struct SystemMaterializedSet: MaterializedSet {
    public init() {}

    public func all(domainId: String) async throws -> (ids: [String], anchor: Data) {
        let enumerator = try await materializedEnumerator(domainId)
        defer { enumerator.invalidate() }
        // Taken before the walk, so a change made during it is read again
        // next time rather than missed.
        guard let anchor = await currentAnchor(enumerator) else {
            throw MaterializedError.noAnchor
        }
        var ids: [String] = []
        // An empty page, as the header for this enumerator asks. The sorted
        // initial pages other enumerators take have no effect here.
        var page = NSFileProviderPage(Data())
        while true {
            let observer = ItemObserver()
            await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
                observer.done = { done.resume() }
                enumerator.enumerateItems(for: observer, startingAt: page)
            }
            // An error on any page fails the whole walk, so a partial list is
            // never read as the full set.
            if let error = observer.error { throw error }
            ids += observer.ids
            guard let next = observer.next else { break }
            page = next
        }
        return (ids, anchor.rawValue)
    }

    public func changes(domainId: String, since anchor: Data) async throws -> (
        updated: [String], deleted: [String], anchor: Data
    ) {
        let enumerator = try await materializedEnumerator(domainId)
        defer { enumerator.invalidate() }
        // Optional in the protocol. Called through `?` when absent, the
        // continuation below would never resume and the agent would hang
        // until the daemon's timeout.
        guard let enumerateChanges = enumerator.enumerateChanges else {
            throw MaterializedError.expired
        }
        var current = NSFileProviderSyncAnchor(anchor)
        // Whether each item named is in the set, by the last word on it.
        var state: [String: Bool] = [:]
        while true {
            let observer = ChangeObserver()
            await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
                observer.done = { done.resume() }
                enumerateChanges(observer, current)
            }
            // Expired is the documented answer, but any error here is the
            // system refusing this anchor, and a full walk recovers from both.
            if observer.error != nil { throw MaterializedError.expired }
            for (id, held) in observer.events { state[id] = held }
            if let next = observer.anchor { current = next }
            if !observer.moreComing { break }
        }
        return (
            state.filter(\.value).map(\.key), state.filter { !$0.value }.map(\.key),
            current.rawValue
        )
    }

    private func materializedEnumerator(_ domainId: String) async throws
        -> NSFileProviderEnumerator
    {
        let domains = try await NSFileProviderManager.domains()
        guard let domain = domains.first(where: { $0.identifier.rawValue == domainId }),
            let manager = NSFileProviderManager(for: domain)
        else { throw AgentError.noSuchDomain(domainId) }
        return manager.enumeratorForMaterializedItems()
    }

    private func currentAnchor(_ enumerator: NSFileProviderEnumerator) async
        -> NSFileProviderSyncAnchor?
    {
        await withCheckedContinuation { done in
            guard let read = enumerator.currentSyncAnchor else {
                done.resume(returning: nil)
                return
            }
            read { done.resume(returning: $0) }
        }
    }
}

private final class ItemObserver: NSObject, NSFileProviderEnumerationObserver {
    var ids: [String] = []
    var next: NSFileProviderPage?
    var error: Error?
    var done: (() -> Void)?

    func didEnumerate(_ items: [NSFileProviderItemProtocol]) {
        ids += items.map(\.itemIdentifier.rawValue)
    }
    func finishEnumerating(upTo nextPage: NSFileProviderPage?) {
        next = nextPage
        done?()
    }
    func finishEnumeratingWithError(_ error: Error) {
        self.error = error
        done?()
    }
}

private final class ChangeObserver: NSObject, NSFileProviderChangeObserver {
    /// Each item named, in the order the system named it, with whether it is
    /// in the set. An item dropped and written again is named both ways.
    var events: [(String, Bool)] = []
    var anchor: NSFileProviderSyncAnchor?
    var moreComing = false
    var error: Error?
    var done: (() -> Void)?

    func didUpdate(_ items: [NSFileProviderItemProtocol]) {
        events += items.map { ($0.itemIdentifier.rawValue, true) }
    }
    func didDeleteItems(withIdentifiers identifiers: [NSFileProviderItemIdentifier]) {
        events += identifiers.map { ($0.rawValue, false) }
    }
    func finishEnumeratingChanges(upTo anchor: NSFileProviderSyncAnchor, moreComing: Bool) {
        self.anchor = anchor
        self.moreComing = moreComing
        done?()
    }
    func finishEnumeratingWithError(_ error: Error) {
        self.error = error
        done?()
    }
}

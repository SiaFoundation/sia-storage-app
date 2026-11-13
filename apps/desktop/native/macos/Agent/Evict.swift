// Removing Finder's copies of files, for the daemon's eviction pass.
//
// Finder keeps its own copy of each file opened or saved in its folder, and
// only the system can remove one. The daemon, which keeps no copy of an
// uploaded file Finder holds, runs this program with
// `evict <domainId> <out> <id>...` when its cache limit needs the space, and
// stops counting each item reported `evicted`.

import Darwin
import FileProvider
import Foundation

/// The agent's answer for one item, written to the results file. The daemon
/// parses these names, so each is part of its contract.
public enum EvictResult: String {
    case evicted, refused, busy, linked, unsynced, failed

    public init(_ error: Error?) {
        guard let error else {
            self = .evicted
            return
        }
        let ns = error as NSError
        switch (ns.domain, ns.code) {
        case (NSFileProviderErrorDomain, NSFileProviderError.noSuchItem.rawValue):
            self = .evicted
        case (NSFileProviderErrorDomain, NSFileProviderError.nonEvictable.rawValue):
            self = .refused
        case (NSFileProviderErrorDomain, NSFileProviderError.unsyncedEdits.rawValue):
            self = .unsynced
        case (NSPOSIXErrorDomain, Int(EBUSY)):
            self = .busy
        case (NSPOSIXErrorDomain, Int(EMLINK)):
            self = .linked
        default:
            self = .failed
        }
    }
}

public enum Evict {
    /// Items evicted at once. Evicting a downloaded file waits a fixed time
    /// in fileproviderd however large the file is, and fileproviderd waits on
    /// many at once, so throughput grows with the calls in flight until
    /// fileproviderd's own limit. Past that, more calls only delay each
    /// answer and Finder's own requests, which share the same queue. A file
    /// with no downloaded copy answers at once. Each answer starts the next
    /// item, so fileproviderd stays at this limit until the last items.
    static let concurrency = 128

    /// Evicts every item and returns one result per id, in no set order.
    public static func run(domainId: String, itemIds: [String], copies: FinderCopies) async throws
        -> [(id: String, result: EvictResult)]
    {
        let domain = try await copies.open(domainId: domainId)
        var results: [(id: String, result: EvictResult)] = []
        await withTaskGroup(of: (String, EvictResult).self) { group in
            var pending = itemIds.makeIterator()
            func startNext() {
                guard let id = pending.next() else { return }
                group.addTask { (id, EvictResult(await domain.evict(itemId: id))) }
            }
            for _ in 0..<concurrency { startNext() }
            for await (id, result) in group {
                results.append((id: id, result: result))
                startNext()
            }
        }
        return results
    }

    /// `{"results":[{"id":...,"result":...}]}`, the file the daemon reads back.
    public static func json(_ results: [(id: String, result: EvictResult)]) throws -> Data {
        let entries = results.map { ["id": $0.id, "result": $0.result.rawValue] }
        return try JSONSerialization.data(withJSONObject: ["results": entries])
    }
}

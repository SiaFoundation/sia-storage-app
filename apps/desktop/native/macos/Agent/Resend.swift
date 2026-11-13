// Having Finder hand a file's bytes back to the daemon.
//
// The daemon keeps no copy of an uploaded file Finder holds. "Uploaded" means
// on the indexer the account uses now, so after that indexer is changed a
// file can need uploading again with its bytes only in Finder, where the
// uploader never reads. The daemon runs this program with
// `resend <domainId> <out> <id>...`, and for each item the system agrees to,
// it later calls the extension's `modifyItem` with the file's contents, which
// reach the daemon as an ordinary save. The daemon recognises the bytes by
// their hash and keeps them as the copy to upload from.
//
// The call only schedules that work. Nothing here says when the contents
// arrive, so the daemon asks again for an item whose bytes never came.

import FileProvider
import Foundation

/// The agent's answer for one item, written to the results file. The daemon
/// parses these names, so each is part of its contract.
public enum ResendResult: String {
    /// The system took the request.
    case asked
    /// Finder does not hold the item's contents, or does not know the item.
    case notHydrated = "not-hydrated"
    case failed

    public init(_ error: Error?) {
        guard let error else {
            self = .asked
            return
        }
        let ns = error as NSError
        switch (ns.domain, ns.code) {
        case (NSCocoaErrorDomain, NSUbiquitousFileUnavailableError),
            (NSFileProviderErrorDomain, NSFileProviderError.noSuchItem.rawValue):
            self = .notHydrated
        default:
            self = .failed
        }
    }
}

public enum Resend {
    /// Asks for every item and returns one result per id. Each call only
    /// records a request with the system, so they go one after another.
    public static func run(domainId: String, itemIds: [String], copies: FinderCopies) async throws
        -> [(id: String, result: ResendResult)]
    {
        let domain = try await copies.open(domainId: domainId)
        var results: [(id: String, result: ResendResult)] = []
        for id in itemIds {
            results.append((id: id, result: ResendResult(await domain.resend(itemId: id))))
        }
        return results
    }

    /// `{"results":[{"id":...,"result":...}]}`, the file the daemon reads back.
    public static func json(_ results: [(id: String, result: ResendResult)]) throws -> Data {
        let entries = results.map { ["id": $0.id, "result": $0.result.rawValue] }
        return try JSONSerialization.data(withJSONObject: ["results": entries])
    }
}

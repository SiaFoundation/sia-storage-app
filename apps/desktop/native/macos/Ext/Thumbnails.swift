// Finder's thumbnails for files that are not on this Mac.
//
// The system asks the extension for a thumbnail only for an item whose bytes
// are not on disk, and makes its own from a downloaded file. The answer is the
// 512px thumbnail the library already keeps, which the daemon reads, and
// downloads first when only another device has it.
//
// What the system does with each kind of answer decides which one to give.
// Data with no error is drawn and kept until the item's content version
// changes. nil data with no error means the item has no thumbnail, and is
// also kept until the content version changes, so it is only for a file that
// can never have one, such as a text file. An error is not kept by the
// system, but Finder shows the plain icon and asks again only once the item's
// modification date changes. A new metadata version alone does not do it.
// The daemon moves a cloud-only item's date by a second once its thumbnail is on
// the Mac, so a thumbnail that is not available yet is answered with an error,
// after the daemon has waited a few seconds for a recently changed file's.

import FileProvider
import Foundation
import SiaShared

/// One item's answer from `ds:provider:thumbnail`.
public enum ThumbnailAnswer: Equatable {
    case image(Data)
    /// The file can never have a thumbnail.
    case none
}

/// Reads the daemon's reply: `{"kind":"image","mimeType":…,"data":<base64>}`
/// or `{"kind":"none"}`.
func decodeThumbnail(_ raw: Any?) throws -> ThumbnailAnswer {
    guard let reply = raw as? [String: Any], let kind = reply["kind"] as? String else {
        throw RpcError.decoding("thumbnail reply was not an object with a kind")
    }
    switch kind {
    case "none":
        return .none
    case "image":
        guard let encoded = reply["data"] as? String, let data = Data(base64Encoded: encoded),
            !data.isEmpty
        else {
            throw RpcError.decoding("thumbnail reply had no image data")
        }
        return .image(data)
    default:
        throw RpcError.decoding("thumbnail reply had an unknown kind")
    }
}

/// One `fetchThumbnails` call: every item fetched at once, each answered as
/// it arrives, then one completion.
///
/// The system calls `cancel` on the returned progress after every batch,
/// including one that already completed, so a cancel after completion is
/// ignored. A cancel before it completes the batch with
/// `NSUserCancelledError`, and later answers are dropped, because the system
/// must not hear about the batch again once it has its completion. Finder asks
/// again for the items it still shows.
final class ThumbnailBatch: @unchecked Sendable {
    typealias Fetch = @Sendable (String) async throws -> ThumbnailAnswer

    private let ids: [String]
    private let fetch: Fetch
    private let perItem: (String, Data?, Error?) -> Void
    private let done: (Error?) -> Void
    private let progress: Progress
    /// Every answer, the completion and the cancel run here, one at a time,
    /// so an answer can never reach the system after the completion. Work is
    /// only ever added with `async`: a system handler may cancel the progress
    /// on this queue, and its cancel then waits its turn instead of
    /// deadlocking.
    private let queue = DispatchQueue(label: "sia.fileprovider.thumbnails")
    // Touched only on `queue`.
    private var finished = false
    private var remaining: Int
    private var tasks: [Task<Void, Never>] = []
    private var served = 0
    private var none = 0
    private var failed = 0

    init(
        ids: [String], fetch: @escaping Fetch,
        perItem: @escaping (String, Data?, Error?) -> Void,
        done: @escaping (Error?) -> Void
    ) {
        self.ids = ids
        self.fetch = fetch
        self.perItem = perItem
        self.done = done
        self.remaining = ids.count
        self.progress = Progress(totalUnitCount: Int64(ids.count))
    }

    func start() -> Progress {
        progress.cancellationHandler = { [weak self] in self?.cancel() }
        if ids.isEmpty {
            queue.async { self.settleBatch() }
            return progress
        }
        let started = ids.map { id in
            Task { [self] in
                let result: Result<ThumbnailAnswer, Error>
                do { result = .success(try await fetch(id)) } catch { result = .failure(error) }
                queue.async { self.settle(id, result) }
            }
        }
        queue.async {
            if self.finished { started.forEach { $0.cancel() } } else { self.tasks = started }
        }
        return progress
    }

    private func settle(_ id: String, _ result: Result<ThumbnailAnswer, Error>) {
        guard !finished else { return }
        switch result {
        case .success(.image(let data)):
            served += 1
            fpLog.debug("thumbnail served \(id, privacy: .public) \(data.count, privacy: .public) bytes")
            perItem(id, data, nil)
        case .success(.none):
            none += 1
            perItem(id, nil, nil)
        case .failure(let error):
            failed += 1
            fpLog.attemptFailed("thumbnail unavailable", id, error)
            perItem(id, nil, mapError(error))
        }
        // The handler above may have cancelled the batch.
        guard !finished else { return }
        progress.completedUnitCount += 1
        remaining -= 1
        if remaining == 0 { settleBatch() }
    }

    private func settleBatch() {
        guard !finished else { return }
        finished = true
        fpLog.notice(
            "thumbnails asked \(self.ids.count, privacy: .public) served \(self.served, privacy: .public) none \(self.none, privacy: .public) failed \(self.failed, privacy: .public)"
        )
        done(nil)
    }

    private func cancel() {
        queue.async {
            guard !self.finished else { return }
            self.finished = true
            self.tasks.forEach { $0.cancel() }
            fpLog.notice("thumbnails cancelled by the system")
            self.done(NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError))
        }
    }
}

extension FileProviderExtension: NSFileProviderThumbnailing {
    public func fetchThumbnails(
        for itemIdentifiers: [NSFileProviderItemIdentifier], requestedSize _: CGSize,
        perThumbnailCompletionHandler: @escaping (NSFileProviderItemIdentifier, Data?, Error?) ->
            Void,
        completionHandler: @escaping (Error?) -> Void
    ) -> Progress {
        // The requested size is ignored: the system asks for one large size from
        // every Finder view and from Quick Look, and the library keeps no
        // thumbnail larger than 512px. Finder scales what it gets.
        let rpc = self.rpc
        let batch = ThumbnailBatch(
            ids: itemIdentifiers.map(\.rawValue),
            fetch: { [weak self] id in
                guard let self else { throw HandshakeError.notEstablished }
                if Self.isContainer(id) { return .none }
                try await self.ready()
                return try decodeThumbnail(
                    try await rpc.call(
                        Channel.thumbnail, [id], receiveTimeout: Rpc.thumbnailTimeout))
            },
            perItem: { id, data, error in
                perThumbnailCompletionHandler(NSFileProviderItemIdentifier(id), data, error)
            },
            done: completionHandler)
        return batch.start()
    }

    private static func isContainer(_ id: String) -> Bool {
        id == NSFileProviderItemIdentifier.rootContainer.rawValue
            || id == NSFileProviderItemIdentifier.trashContainer.rawValue
            || id == NSFileProviderItemIdentifier.workingSet.rawValue
    }
}

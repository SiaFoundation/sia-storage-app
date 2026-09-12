// Materializing the library's folders before anyone opens them.
//
// The system writes out a folder's children the first time something traverses
// it, and opening that folder waits on the write. Doing it up front spends the
// wait while nobody is looking. It runs here rather than in the app because a
// walk from there calls back into this extension, which the system refuses to
// the app the provider belongs to, denying it at the root.

import FileProvider
import Foundation
import SiaShared

/// Attempts, including the first. The domain is registered around the same time
/// this extension is started, and until that has settled every request is
/// refused with "no valid file provider found". One pass warms nothing at all
/// on exactly the fresh domain that needs warming most.
private let attempts = 4
private let retryDelay = Duration.seconds(5)

/// Asks the system to write out every folder in the library.
///
/// The requests are only queued, not waited on: a request's completion means
/// the system accepted it, not that the folder is on disk. There is nothing to
/// pace here, and the system schedules the work against whatever else it is
/// doing.
public func warmFolders(rpc: Rpc, manager: NSFileProviderManager) async {
    guard let folders = await libraryFolders(rpc) else { return }
    let total = folders.count
    var pending = folders

    for attempt in 0..<attempts {
        if attempt > 0 { try? await Task.sleep(for: retryDelay) }
        var failed: [String] = []
        for id in pending where await !request(manager, id) {
            failed.append(id)
        }
        pending = failed
        if pending.isEmpty { break }
    }

    if pending.isEmpty {
        fpLog.notice("warm: asked for \(total, privacy: .public) folder(s)")
    } else {
        fpLog.error(
            "warm: \(pending.count, privacy: .public) of \(total, privacy: .public) folder(s) never accepted"
        )
    }
}

/// Every folder in the library, or nil when the daemon could not be read.
///
/// The working set lists all of its folders before any file, a page at a time,
/// so this reads pages until one comes back with no folders in it. Stopping on
/// that rather than on the shape of the cursor keeps the format of the cursor
/// the daemon's business.
private func libraryFolders(_ rpc: Rpc) async -> [String]? {
    var folders: [String] = []
    var cursor: String?
    repeat {
        let page: ProviderPage
        do {
            let args: [Any] = cursor.map { [Container.workingSet, $0] } ?? [Container.workingSet]
            page = try await rpc.callDecoding(ProviderPage.self, Channel.list, args)
        } catch {
            fpLog.failure("warm: listing folders failed", error)
            return nil
        }
        let ids = page.items.filter { $0.isDirectory }.map { $0.id }
        folders.append(contentsOf: ids)
        cursor = ids.isEmpty ? nil : page.cursor
    } while cursor != nil
    return folders
}

/// True when the system accepted the request. On a folder this materializes one
/// level down and fetches no content, despite the name.
private func request(_ manager: NSFileProviderManager, _ id: String) async -> Bool {
    await withCheckedContinuation { continuation in
        manager.requestDownloadForItem(
            withIdentifier: NSFileProviderItemIdentifier(id), requestedRange: nil
        ) { error in
            if let error { fpLog.attemptFailed("warm: refused", id, error) }
            continuation.resume(returning: error == nil)
        }
    }
}

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

/// What a pass did, which is what decides whether the caller runs another.
public enum WarmOutcome {
    case warmed
    /// No folders to warm, so a later library change is worth another pass.
    /// Covers an empty library and a listing that never came back.
    case nothingToWarm
    /// A replacement pass or teardown took over and owns the reporting from
    /// here, so this one must not report and its result must not be stored.
    case cancelled
}

/// Asks the system to write out every folder in the library, and reports when
/// it has finished doing so.
///
/// A request's completion means the system accepted the work, so the pass
/// ends by waiting for the writes to go quiet. There is nothing to pace
/// here, because the system schedules the work against whatever else it
/// is doing.
@discardableResult
public func warmFolders(rpc: Rpc, manager: NSFileProviderManager) async -> WarmOutcome {
    // This task runs only when the provider stream connects, so a listing
    // that failed once would leave every folder cold until the next connect.
    // Retried here for the same reason the folder requests below are.
    var listed: [String]?
    for attempt in 0..<attempts {
        if attempt > 0 { try? await Task.sleep(for: retryDelay) }
        if Task.isCancelled { return .cancelled }
        listed = await libraryFolders(rpc)
        if listed != nil { break }
    }
    guard let folders = listed, !folders.isEmpty else {
        return Task.isCancelled ? .cancelled : .nothingToWarm
    }

    // Shared and long-lived, so enumerations the system makes while the pass
    // is still submitting count toward the quiet window.
    let settle = SettleWatcher.shared
    await report(rpc, phase: "start")
    await submit(folders, to: manager)
    // A cancelled pass sends no settled: its replacement has already sent
    // start, and a late one from here would mark that pass finished. The
    // socket dropping is what ends a pass nothing replaces.
    if Task.isCancelled { return .cancelled }
    await settle.waitUntilQuiet()
    fpLog.notice("warm: system settled for \(folders.count, privacy: .public) folder(s)")
    await report(rpc, phase: "settled")
    return .warmed
}

/// Queues every folder, retrying the ones the system refused.
private func submit(_ folders: [String], to manager: NSFileProviderManager) async {
    var pending = folders
    for attempt in 0..<attempts {
        if attempt > 0 { try? await Task.sleep(for: retryDelay) }
        if Task.isCancelled { return }
        var failed: [String] = []
        for id in pending {
            // Checked per request, not only per attempt: a cancelled pass
            // must stop submitting, or it overlaps the replacement pass and
            // pollutes the shared progress count.
            if Task.isCancelled { return }
            if await !request(manager, id) { failed.append(id) }
        }
        pending = failed
        if pending.isEmpty { break }
    }

    if pending.isEmpty {
        fpLog.notice("warm: asked for \(folders.count, privacy: .public) folder(s)")
    } else {
        fpLog.error(
            "warm: \(pending.count, privacy: .public) of \(folders.count, privacy: .public) folder(s) never accepted"
        )
    }
}

/// Tells the daemon where the pass begins and ends, so the menu bar can say
/// "finished" only once the folders are on disk rather than served.
private func report(_ rpc: Rpc, phase: String) async {
    do {
        _ = try await rpc.call(Channel.warm, [phase])
    } catch {
        fpLog.attemptFailed("warm: progress report", phase, error)
    }
}

/// Every folder in the library; nil when the daemon could not be read or the pass was cancelled.
///
/// The working set lists all of its folders before any file, a page at a time,
/// so this reads pages until one comes back with no folders in it. Stopping on
/// that rather than on the shape of the cursor keeps the format of the cursor
/// the daemon's business.
private func libraryFolders(_ rpc: Rpc) async -> [String]? {
    var folders: [String] = []
    var cursor: String?
    repeat {
        // Per page, not only before the listing: a multi-page walk would
        // otherwise keep opening RPCs against a domain teardown just removed.
        if Task.isCancelled { return nil }
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

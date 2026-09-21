// Waiting for the system to stop writing the library out to its own copy.
//
// Accepting a folder request says the system took the work, not that the
// folder is on disk, and there is no per-item answer to ask for: membership
// comes only from the materialized set enumerator, which returns every
// materialized item and so costs a walk of the whole library.
// NSFileProviderMaterializedSetDidChange is the obvious alternative and
// does not work here. The framework posts it only after a client has called
// getDomainsWithCompletionHandler, which an extension never does, so an
// observer registered here would never fire.
// The system asks for a folder's contents as it writes that folder out, so
// enumerations stand in for the writes and quiet stands in for done.

import Foundation

/// Reports when writes to the system's copy have stopped.
///
/// Shared because the enumerator records the writes and the warm pass waits
/// on them, and those are different objects.
final class SettleWatcher: @unchecked Sendable {
    static let shared = SettleWatcher()

    private let lastChange = LockedBox<ContinuousClock.Instant?>(nil)

    /// The system asked for something, so it is still working.
    func noteChange() { lastChange.set(ContinuousClock.now) }

    /// Returns once no write has landed for `quiet`, or after `ceiling`.
    ///
    /// The ceiling bounds a pass the system keeps working at past any
    /// sensible wait, so the menu bar cannot hold "Preparing" forever.
    func waitUntilQuiet(
        quiet: Duration = .seconds(3),
        ceiling: Duration = .seconds(60),
        poll: Duration = .milliseconds(250)
    ) async {
        let start = ContinuousClock.now
        while !Task.isCancelled {
            if ContinuousClock.now - start >= ceiling { return }
            let since = lastChange.get().map { ContinuousClock.now - $0 }
            if let since, since >= quiet { return }
            // Nothing has landed at all: the requests may still be queued, so
            // wait out the same quiet window before calling it settled.
            if since == nil, ContinuousClock.now - start >= quiet { return }
            try? await Task.sleep(for: poll)
        }
    }
}

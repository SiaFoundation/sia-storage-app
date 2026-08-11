// Whether the daemon is there, and what to tell the system about it.
//
// The app hides the mount when the user quits. This covers what it cannot: the
// daemon going away with the app not running to notice, which leaves Finder
// holding a live-looking folder that errors on every operation. Only the
// provider may disconnect its own domain, so the decision is made here.

import Foundation

public enum AvailabilityAction: Equatable {
    case none
    case disconnect
    case reconnect
}

public actor Availability {
    /// How long the daemon must stay away before the mount is disconnected.
    /// Without it, a daemon restart would flash the Finder banner every time.
    private let grace: Double
    private var downSince: Double?
    private var disconnected = false

    public init(grace: Double = 5) {
        self.grace = grace
    }

    /// The daemon went away. Returns true when this is the first report of the
    /// current outage, which is the caller's cue to come back at `settle`.
    public func failed(at now: Double) -> Bool {
        guard downSince == nil else { return false }
        downSince = now
        return true
    }

    /// Called once the grace period is up. Disconnects only if the daemon has
    /// been away for that whole time.
    public func settle(at now: Double) -> AvailabilityAction {
        guard let since = downSince, !disconnected, now - since >= grace else { return .none }
        disconnected = true
        return .disconnect
    }

    /// The daemon answered. Clears the outage, and reconnects if one lasted.
    public func succeeded() -> AvailabilityAction {
        downSince = nil
        guard disconnected else { return .none }
        disconnected = false
        return .reconnect
    }
}

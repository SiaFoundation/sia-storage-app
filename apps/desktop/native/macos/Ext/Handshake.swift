// Version agreement between this extension and the daemon.
//
// The OS starts the extension before the daemon exists and keeps it alive across
// daemon restarts, so only success is cached: a remembered failure would serve
// errors for hours. Failure is rate limited instead, because fileproviderd drives
// several callbacks at once and each would cost a connect against a dead socket.

import Foundation
import SiaShared

public enum HandshakeError: Error, LocalizedError {
    case notEstablished
    /// The daemon answered but is not one this build can talk to. Waiting does
    /// not fix it, which is what separates it from an outage.
    case incompatible(String)

    public var errorDescription: String? {
        switch self {
        case .notEstablished: return "The daemon is not reachable yet"
        case .incompatible(let why): return why
        }
    }
}

public actor Handshake {
    /// Performs one round trip and returns the daemon's reported version.
    private let perform: @Sendable () async throws -> ProviderHello
    /// Monotonic seconds. Injected so a test does not have to wait in real time.
    private let now: @Sendable () -> Double
    private let retryAfter: Double

    private var agreed = false
    private var lastFailureAt: Double?
    /// The library the last agreement was about. A different one means every
    /// item the system has cached for this domain belongs to something else.
    private var library: String?
    /// The attempt in flight, shared by everyone who arrives during it. An actor
    /// is re-entrant across `await`, so without this a burst of callbacks each
    /// start their own connect before the first has finished.
    private var attempt: Task<ProviderHello, Error>?
    /// Bumped by `reset()`. An attempt started before a reset answered for the
    /// daemon that went away, so its result must not commit agreement.
    private var generation = 0

    public init(
        retryAfter: Double = 0.5,
        now: @escaping @Sendable () -> Double = { ProcessInfo.processInfo.systemUptime },
        perform: @escaping @Sendable () async throws -> ProviderHello
    ) {
        self.retryAfter = retryAfter
        self.now = now
        self.perform = perform
    }

    /// True once the daemon has answered. Reading it never triggers an attempt.
    public var isAgreed: Bool { agreed }

    /// Forgets the agreement, so the next callback handshakes again. The daemon
    /// restarts under a live extension, and only a fresh hello says whether it
    /// is still the same build serving the same library.
    public func reset() {
        agreed = false
        attempt = nil
        generation += 1
    }

    /// Returns once agreement holds, otherwise throws and leaves the next caller
    /// free to try again.
    public func ready() async throws {
        if agreed { return }
        if let last = lastFailureAt, now() - last < retryAfter {
            throw HandshakeError.notEstablished
        }
        // Logged inside the task: a burst of callbacks shares one attempt, and
        // logging per caller would report eight handshakes where one happened.
        let running =
            attempt
            ?? Task { [perform] in
                do {
                    let hello = try await perform()
                    fpLog.notice("handshake ok daemon=\(hello.version, privacy: .public)")
                    return hello
                } catch {
                    fpLog.failure("handshake failed", error)
                    throw error
                }
            }
        attempt = running
        let startedIn = generation
        let hello: ProviderHello
        do {
            hello = try await running.value
            if startedIn == generation { attempt = nil }
        } catch {
            // After a reset the slot may hold a newer attempt, and marking a
            // failure would rate limit a handshake that has not been tried.
            if startedIn == generation {
                attempt = nil
                lastFailureAt = now()
            }
            throw error
        }
        guard startedIn == generation else { throw HandshakeError.notEstablished }
        let swapped = library != nil && hello.library != nil && library != hello.library
        library = hello.library ?? library
        agreed = true
        lastFailureAt = nil
        if swapped {
            // Agreement holds for the new library, so this throws once and the
            // next callback goes through. What the system still holds is stale.
            throw HandshakeError.incompatible("The Sia folder is now serving a different library")
        }
    }
}

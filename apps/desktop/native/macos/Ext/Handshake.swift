// Version agreement between this extension and the daemon.
//
// The OS starts the extension before the daemon exists and keeps it alive across
// daemon restarts, so only success is cached: a remembered failure would serve
// errors for hours. Failure is rate limited instead, because fileproviderd drives
// several callbacks at once and each would cost a connect against a dead socket.

import Foundation

public enum HandshakeError: Error, LocalizedError {
    case notEstablished

    public var errorDescription: String? {
        "The daemon is not reachable yet"
    }
}

public actor Handshake {
    /// Performs one round trip and returns the daemon's reported version.
    private let perform: @Sendable () async throws -> String
    /// Monotonic seconds. Injected so a test does not have to wait in real time.
    private let now: @Sendable () -> Double
    private let retryAfter: Double

    private var agreed = false
    private var lastFailureAt: Double?
    /// The attempt in flight, shared by everyone who arrives during it. An actor
    /// is re-entrant across `await`, so without this a burst of callbacks each
    /// start their own connect before the first has finished.
    private var attempt: Task<String, Error>?

    public init(
        retryAfter: Double = 0.5,
        now: @escaping @Sendable () -> Double = { ProcessInfo.processInfo.systemUptime },
        perform: @escaping @Sendable () async throws -> String
    ) {
        self.retryAfter = retryAfter
        self.now = now
        self.perform = perform
    }

    /// True once the daemon has answered. Reading it never triggers an attempt.
    public var isAgreed: Bool { agreed }

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
                    let version = try await perform()
                    fpLog.info("handshake ok daemon=\(version, privacy: .public)")
                    return version
                } catch {
                    fpLog.failure("handshake failed", error)
                    throw error
                }
            }
        attempt = running
        do {
            _ = try await running.value
            attempt = nil
            agreed = true
            lastFailureAt = nil
        } catch {
            attempt = nil
            lastFailureAt = now()
            throw error
        }
    }
}

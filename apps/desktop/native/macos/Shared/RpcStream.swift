// A connection held open to receive change signals from the daemon.
//
// Both the app and the extension subscribe. The extension needs it because the
// OS serves its own cached view until told otherwise, so a change that did not
// originate in Finder (a file arriving from another device, an upload
// finishing) is invisible until something calls signalEnumerator.

import Foundation

public struct ChangeEvent: Decodable, Equatable {
    public let event: String
    public let scope: String
}

/// Safe to share across threads: its mutable state is guarded by a lock and the
/// read loop runs on a private queue.
public final class RpcStream: @unchecked Sendable {
    private let socketPath: String
    private let onEvent: (ChangeEvent) -> Void
    private let queue = DispatchQueue(label: "sia.rpc.stream")
    private var fd: Int32 = -1
    private var stopped = false
    private let lock = NSLock()

    public init(socketPath: String, onEvent: @escaping (ChangeEvent) -> Void) {
        self.socketPath = socketPath
        self.onEvent = onEvent
    }

    /// True while a connection is open. The read loop and `stop()` both release
    /// it, so a stream that has reported a disconnect holds nothing.
    var holdsDescriptor: Bool {
        lock.lock()
        defer { lock.unlock() }
        return fd >= 0
    }

    /// Connects, subscribes, and reads frames until `stop()` or a disconnect.
    ///
    /// Returns immediately, and every callback runs on this object's private
    /// queue. `onConnected` fires once the subscription is on the wire and
    /// `onDisconnect` when it ends, which together are the only signal
    /// either side has that the daemon came or went: the version handshake
    /// caches its success and stops making round trips after the first one.
    public func start(
        onConnected: @escaping () -> Void = {}, onDisconnect: @escaping (Error) -> Void
    ) {
        queue.async { [weak self] in
            guard let self else { return }
            do {
                let fd = try Rpc.openSocket(at: self.socketPath, receiveTimeout: nil)
                self.lock.lock()
                if self.stopped {
                    self.lock.unlock()
                    close(fd)
                    return
                }
                self.fd = fd
                self.lock.unlock()

                let request: [String: Any] = ["id": "subscribe", "method": Channel.subscribe]
                let body = try JSONSerialization.data(withJSONObject: request)
                try Rpc.writeAll(fd: fd, data: Rpc.terminated(body))
                onConnected()

                self.readLoop(fd: fd)
                self.closeCurrent()
                onDisconnect(RpcError.unreachable("change stream closed"))
            } catch {
                // Reached with a connection already open when the subscribe
                // write fails, so the socket is released here too.
                self.closeCurrent()
                onDisconnect(error)
            }
        }
    }

    public func stop() {
        lock.lock()
        stopped = true
        let current = fd
        fd = -1
        lock.unlock()
        guard current >= 0 else { return }
        // close(2) alone does not reliably return a recv already blocked on the
        // descriptor; shutdown(2) does, so the read loop ends now rather than
        // when the daemon next says something.
        shutdown(current, SHUT_RDWR)
        close(current)
    }

    /// Closes the connection if this object still owns it. The caller that ends
    /// the read loop and `stop()` race to do this, and the descriptor number is
    /// reused by the kernel, so whoever takes it under the lock closes it once.
    private func closeCurrent() {
        lock.lock()
        let current = fd
        fd = -1
        lock.unlock()
        if current >= 0 { close(current) }
    }

    private func readLoop(fd: Int32) {
        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 4096)
        while true {
            let n = chunk.withUnsafeMutableBufferPointer { raw -> Int in
                guard let base = raw.baseAddress else { return -1 }
                return recv(fd, base, raw.count, 0)
            }
            if n <= 0 { return }
            buffer.append(contentsOf: chunk[0..<n])

            // A frame can arrive split across reads, and several can arrive in
            // one, so drain whole lines and keep any partial tail.
            while let newline = buffer.firstIndex(of: 0x0A) {
                let line = buffer[buffer.startIndex..<newline]
                buffer = buffer[buffer.index(after: newline)...]
                guard !line.isEmpty else { continue }
                if let event = try? JSONDecoder().decode(ChangeEvent.self, from: Data(line)) {
                    onEvent(event)
                }
                // Anything else on this connection is a reply to a request the
                // stream never sends, so it is ignored rather than treated as
                // an error.
            }
        }
    }
}

// Line-delimited JSON over a UNIX socket, the transport both the app and the
// File Provider extension use to reach the daemon.
//
// Two modes share one framing. A call opens its own short-lived connection,
// writes one request, reads one reply, and closes; concurrent callbacks
// therefore never interleave replies on a shared socket, which matters because
// fileproviderd drives several at once. A stream keeps its connection open and
// hands every unsolicited frame to a callback.
//
// A signal landing mid-syscall surfaces as an unreachable daemon rather than
// being retried, which costs one callback and is corrected by the next.

import Foundation

public enum RpcError: Error, Equatable, LocalizedError {
    /// The socket is absent, or nothing is listening on it.
    case unreachable(String)
    case encoding(String)
    case decoding(String)
    /// The daemon answered with ok=false; the payload is its message.
    case remote(String)

    // Without this, logging or reporting one of these yields "error 3" and the
    // message the daemon actually sent is lost.
    public var errorDescription: String? {
        switch self {
        case .unreachable(let m): return "unreachable: \(m)"
        case .encoding(let m): return "encoding: \(m)"
        case .decoding(let m): return "decoding: \(m)"
        case .remote(let m): return m
        }
    }
}

/// Safe to share across threads: it holds an immutable path and a lock-guarded
/// counter, and every connection is local to the call that opens it.
public final class Rpc: @unchecked Sendable {
    private let socketPath: String
    private let counter = Counter()

    public init(socketPath: String) {
        self.socketPath = socketPath
    }

    /// Issues one call and returns its `result`, or throws.
    public func call(_ method: String, _ args: [Any] = []) async throws -> Any? {
        let request: [String: Any] = [
            "id": "c\(counter.next())",
            "method": method,
            "params": ["args": args],
        ]
        guard let body = try? JSONSerialization.data(withJSONObject: request) else {
            throw RpcError.encoding("could not encode \(method)")
        }
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    continuation.resume(returning: try self.roundTrip(body))
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    /// Decodes a call's result into a `Decodable`, for the typed wire shapes.
    public func callDecoding<T: Decodable>(_ type: T.Type, _ method: String, _ args: [Any] = [])
        async throws -> T
    {
        let raw = try await call(method, args)
        guard let raw else { throw RpcError.decoding("\(method) returned nothing") }
        let data = try JSONSerialization.data(withJSONObject: raw)
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw RpcError.decoding("\(method): \(error.localizedDescription)")
        }
    }

    /// Same as `callDecoding`, but reads a null result as "no such thing" rather
    /// than as a failure. A payload that is present and unreadable still throws:
    /// answering nil there would report a decoding bug as a missing item.
    public func callDecodingOptional<T: Decodable>(
        _ type: T.Type, _ method: String, _ args: [Any] = []
    ) async throws -> T? {
        let raw = try await call(method, args)
        guard let raw, !(raw is NSNull) else { return nil }
        let data = try JSONSerialization.data(withJSONObject: raw)
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw RpcError.decoding("\(method): \(error.localizedDescription)")
        }
    }

    // MARK: - one request, one reply

    private func roundTrip(_ body: Data) throws -> Any? {
        let fd = try Self.openSocket(at: socketPath)
        defer { close(fd) }

        try Self.writeAll(fd: fd, data: Self.terminated(body))

        var response = Data()
        var chunk = [UInt8](repeating: 0, count: 8192)
        while true {
            let n = chunk.withUnsafeMutableBufferPointer { buffer -> Int in
                guard let base = buffer.baseAddress else { return -1 }
                return recv(fd, base, buffer.count, 0)
            }
            if n < 0 {
                // EAGAIN here is SO_RCVTIMEO expiring, not a busy socket: the
                // daemon accepted and then said nothing for the whole window.
                let reason =
                    errno == EAGAIN
                    ? "no reply within \(Self.ioTimeout.tv_sec)s" : "recv() failed: \(errno)"
                throw RpcError.unreachable(reason)
            }
            if n == 0 { break }
            response.append(contentsOf: chunk[0..<n])
            if response.last == 0x0A { break }
        }
        return try Self.decodeReply(response)
    }

    // MARK: - shared plumbing

    static func terminated(_ body: Data) -> Data {
        var out = body
        if out.last != 0x0A { out.append(0x0A) }
        return out
    }

    /// Parses one reply frame, returning its `result` or throwing its `error`.
    static func decodeReply(_ data: Data) throws -> Any? {
        guard
            let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            throw RpcError.decoding("reply was not a JSON object")
        }
        if (parsed["ok"] as? Bool) == true { return parsed["result"] }
        throw RpcError.remote((parsed["error"] as? String) ?? "daemon returned ok=false")
    }

    /// A daemon that accepts and then stalls would otherwise block a Finder
    /// callback until the user force-quits, so every read and write is bounded.
    static let ioTimeout = timeval(tv_sec: 15, tv_usec: 0)

    /// `receiveTimeout: nil` for a connection that waits indefinitely: on a
    /// subscription an expired read is indistinguishable from a hang-up, so a
    /// timeout tears the stream down and reconnects it on a loop.
    static func openSocket(at path: String, receiveTimeout: timeval? = Rpc.ioTimeout) throws
        -> Int32
    {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        if fd < 0 { throw RpcError.unreachable("socket() failed: \(errno)") }

        let timeoutSize = socklen_t(MemoryLayout<timeval>.size)
        if var receive = receiveTimeout {
            setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &receive, timeoutSize)
        }
        // The send side stays bounded either way: writing a request should never
        // block, however long the answer takes.
        var send = Rpc.ioTimeout
        setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &send, timeoutSize)

        // Writing to a socket the daemon has already closed raises SIGPIPE,
        // whose default disposition kills the process. A daemon that exits
        // between connect and send would take the extension down with it, so
        // ask for the error at the send instead of the signal.
        var noSignal: Int32 = 1
        setsockopt(
            fd, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout<Int32>.size))

        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8)
        // sun_path is fixed-size; a longer path would be silently truncated and
        // connect somewhere unintended.
        guard bytes.count < MemoryLayout.size(ofValue: address.sun_path) else {
            close(fd)
            throw RpcError.unreachable("socket path is too long: \(path)")
        }
        withUnsafeMutableBytes(of: &address.sun_path) { raw in
            let buffer = raw.bindMemory(to: CChar.self)
            for (i, byte) in bytes.enumerated() { buffer[i] = CChar(bitPattern: byte) }
            buffer[bytes.count] = 0
        }
        let result = withUnsafePointer(to: &address) { pointer -> Int32 in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { addr in
                connect(fd, addr, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        if result < 0 {
            close(fd)
            // The path is the same for the life of the process and is logged once
            // at startup, so repeating it here only carries it into every error
            // that quotes this message, including the ones Finder shows.
            throw RpcError.unreachable("connect() failed: \(errno)")
        }
        return fd
    }

    /// send(2) may accept fewer bytes than offered, so a single call can leave a
    /// half-written request the daemon will never be able to parse.
    static func writeAll(fd: Int32, data: Data) throws {
        var sent = 0
        try data.withUnsafeBytes { raw in
            guard let base = raw.baseAddress else { throw RpcError.encoding("empty request") }
            while sent < raw.count {
                let n = send(fd, base.advanced(by: sent), raw.count - sent, 0)
                if n <= 0 { throw RpcError.unreachable("send() failed: \(errno)") }
                sent += n
            }
        }
    }
}

/// Monotonic request ids. Replies are matched per connection, so the value only
/// has to be unique within one process.
final class Counter: @unchecked Sendable {
    private var value = 0
    private let lock = NSLock()
    func next() -> Int {
        lock.lock()
        defer { lock.unlock() }
        value += 1
        return value
    }
}

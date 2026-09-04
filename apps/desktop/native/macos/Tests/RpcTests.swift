import XCTest

@testable import SiaShared

final class ReplyDecodingTests: XCTestCase {
    func testReturnsResultOnSuccess() throws {
        let data = #"{"id":"c1","ok":true,"result":{"name":"a.txt"}}"#.data(using: .utf8)!

        let result = try Rpc.decodeReply(data) as? [String: Any]

        XCTAssertEqual(result?["name"] as? String, "a.txt")
    }

    func testAllowsANullResult() throws {
        let data = #"{"id":"c1","ok":true,"result":null}"#.data(using: .utf8)!

        let result = try Rpc.decodeReply(data)

        XCTAssertTrue(result == nil || result is NSNull)
    }

    func testThrowsTheDaemonsMessage() {
        let data = #"{"id":"c1","ok":false,"error":"No file with id x"}"#.data(using: .utf8)!

        XCTAssertThrowsError(try Rpc.decodeReply(data)) { error in
            XCTAssertEqual(error as? RpcError, .remote("No file with id x"))
        }
    }

    func testThrowsOnANonObjectReply() {
        let data = "not json".data(using: .utf8)!

        XCTAssertThrowsError(try Rpc.decodeReply(data)) { error in
            guard case .decoding = error as? RpcError else {
                return XCTFail("expected a decoding error, got \(error)")
            }
        }
    }
}

final class FramingTests: XCTestCase {
    func testAppendsANewlineWhenMissing() {
        let framed = Rpc.terminated("{}".data(using: .utf8)!)

        XCTAssertEqual(framed.last, 0x0A)
        XCTAssertEqual(framed.count, 3)
    }

    func testLeavesAnExistingNewlineAlone() {
        let framed = Rpc.terminated("{}\n".data(using: .utf8)!)

        XCTAssertEqual(framed.count, 3)
    }
}

final class SocketPathTests: XCTestCase {
    func testRefusesAPathLongerThanSunPath() {
        let long = "/" + String(repeating: "a", count: 200) + "/provider.sock"

        XCTAssertThrowsError(try Rpc.openSocket(at: long)) { error in
            guard case .unreachable(let message) = error as? RpcError else {
                return XCTFail("expected unreachable, got \(error)")
            }
            XCTAssertTrue(message.contains("too long"))
        }
    }

    func testReportsAnAbsentSocketAsUnreachable() {
        XCTAssertThrowsError(try Rpc.openSocket(at: "/tmp/sia-nothing-here.sock")) { error in
            guard case .unreachable = error as? RpcError else {
                return XCTFail("expected unreachable, got \(error)")
            }
        }
    }
}

final class ChangeEventTests: XCTestCase {
    func testDecodesAPushFrame() throws {
        let data = #"{"event":"change","scope":"library"}"#.data(using: .utf8)!

        let event = try JSONDecoder().decode(ChangeEvent.self, from: data)

        XCTAssertEqual(event, ChangeEvent(event: "change", scope: "library"))
    }

    func testRejectsAReplyFrame() {
        let data = #"{"id":"c1","ok":true,"result":null}"#.data(using: .utf8)!

        XCTAssertThrowsError(try JSONDecoder().decode(ChangeEvent.self, from: data))
    }
}

final class WireTypeTests: XCTestCase {
    private let itemJSON = """
        {"id":"f1","parentId":null,"name":"a.txt","kind":"file","size":12,
         "createdAt":1700000000000,"modifiedAt":1700000001000,
         "contentVersion":"sha256:abc","metadataVersion":"1700000001000:a.txt:12:",
         "uploaded":true,"uploading":false,"downloaded":true,"downloading":false,"progress":0}
        """

    func testDecodesAnItem() throws {
        let item = try JSONDecoder().decode(ProviderItem.self, from: itemJSON.data(using: .utf8)!)

        XCTAssertEqual(item.id, "f1")
        XCTAssertNil(item.parentId)
        XCTAssertFalse(item.isDirectory)
    }

    func testDecodesAPageWithoutACursor() throws {
        let json = "{\"items\":[\(itemJSON)]}"

        let page = try JSONDecoder().decode(ProviderPage.self, from: json.data(using: .utf8)!)

        XCTAssertEqual(page.items.count, 1)
        XCTAssertNil(page.cursor)
    }

    func testDecodesChangesWithDeletions() throws {
        let json =
            "{\"items\":[],\"deletedIds\":[\"f9\"],\"anchor\":\"42:f9:1-x\",\"hasMore\":false,\"expired\":false}"

        let changes = try JSONDecoder().decode(
            ProviderChanges.self, from: json.data(using: .utf8)!)

        XCTAssertEqual(changes.deletedIds, ["f9"])
        XCTAssertEqual(changes.anchor, "42:f9:1-x")
        XCTAssertFalse(changes.hasMore)
        XCTAssertFalse(changes.expired)
    }

    func testDecodesATruncatedChangePage() throws {
        let json =
            "{\"items\":[],\"deletedIds\":[],\"anchor\":\"42:f9:1-x\",\"hasMore\":true,\"expired\":false}"

        let changes = try JSONDecoder().decode(
            ProviderChanges.self, from: json.data(using: .utf8)!)

        XCTAssertTrue(changes.hasMore)
    }

    func testDecodesAnExpiredAnchor() throws {
        let json =
            "{\"items\":[],\"deletedIds\":[],\"anchor\":\"42:f9:2-y\",\"hasMore\":false,\"expired\":true}"

        let changes = try JSONDecoder().decode(
            ProviderChanges.self, from: json.data(using: .utf8)!)

        XCTAssertTrue(changes.expired)
    }

    func testDecodesProgressWithAnUnknownTotal() throws {
        let json = "{\"received\":10,\"total\":null}"

        let progress = try JSONDecoder().decode(
            ProviderProgress.self, from: json.data(using: .utf8)!)

        XCTAssertNil(progress.total)
    }
}

final class PathsTests: XCTestCase {
    func testSocketAndHandoffSitDirectlyInTheSandboxHome() {
        let home = NSHomeDirectory()

        XCTAssertEqual(SiaPaths.providerSocketFromExtension(), "\(home)/provider.sock")
        XCTAssertEqual(SiaPaths.handoffDirFromExtension(), "\(home)/handoff")
    }

    func testSweepRemovesOnlyStaleEntries() throws {
        let dir = NSTemporaryDirectory() + "sia-sweep-\(UUID().uuidString)"
        SiaPaths.ensureDirectory(dir)
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let stale = "\(dir)/stale"
        let fresh = "\(dir)/fresh"
        FileManager.default.createFile(atPath: stale, contents: Data("x".utf8))
        FileManager.default.createFile(atPath: fresh, contents: Data("x".utf8))
        try FileManager.default.setAttributes(
            [.modificationDate: Date(timeIntervalSinceNow: -3600)], ofItemAtPath: stale)

        SiaPaths.sweep(directory: dir, olderThan: 600)

        XCTAssertFalse(FileManager.default.fileExists(atPath: stale))
        XCTAssertTrue(FileManager.default.fileExists(atPath: fresh))
    }

    func testSweepIgnoresAMissingDirectory() {
        SiaPaths.sweep(directory: "/tmp/sia-definitely-not-here", olderThan: 1)
    }
}

/// The extension reconnects by building a new stream and dropping the old one,
/// so a connection the daemon hangs up on has to release its socket without
/// anyone calling `stop()`. The extension outlives many daemon restarts, and one
/// descriptor held per restart eventually exhausts it.
final class StreamLifecycleTests: XCTestCase {
    func testReleasesItsSocketWhenTheDaemonHangsUp() throws {
        let path = NSTemporaryDirectory() + "sia-stream-\(getpid()).sock"
        unlink(path)
        let listener = try Self.listen(at: path)
        defer {
            close(listener)
            unlink(path)
        }

        // Accepts and immediately hangs up, which is what a daemon shutting down
        // looks like from here.
        let accepting = DispatchQueue(label: "test.accept")
        accepting.async {
            while true {
                let conn = accept(listener, nil, nil)
                if conn < 0 { return }
                close(conn)
            }
        }

        let ended = expectation(description: "disconnected")
        let stream = RpcStream(socketPath: path) { _ in }
        stream.start(onDisconnect: { _ in ended.fulfill() })
        wait(for: [ended], timeout: 5)

        XCTAssertFalse(stream.holdsDescriptor)
    }

    func testACallGivesUpAfterFifteenSecondsAndASubscriptionWaitsIndefinitely() throws {
        let path = NSTemporaryDirectory() + "sia-timeout-\(getpid()).sock"
        unlink(path)
        let listener = try Self.listen(at: path)
        defer {
            close(listener)
            unlink(path)
        }

        let call = try Rpc.openSocket(at: path)
        let stream = try Rpc.openSocket(at: path, receiveTimeout: nil)
        defer {
            close(call)
            close(stream)
        }

        // A subscription is silent whenever the library is, so a receive timeout
        // on it reads as a hang-up and reconnects the stream on a loop.
        XCTAssertEqual(Self.receiveTimeoutSeconds(call), 15)
        XCTAssertEqual(Self.receiveTimeoutSeconds(stream), 0)
    }

    private static func receiveTimeoutSeconds(_ fd: Int32) -> Int {
        var value = timeval()
        var length = socklen_t(MemoryLayout<timeval>.size)
        getsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &value, &length)
        return Int(value.tv_sec)
    }

    private static func listen(at path: String) throws -> Int32 {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8)
        guard bytes.count < MemoryLayout.size(ofValue: address.sun_path) else {
            close(fd)
            throw RpcError.unreachable("test socket path is too long: \(path)")
        }
        withUnsafeMutableBytes(of: &address.sun_path) { raw in
            let buffer = raw.bindMemory(to: CChar.self)
            for (i, byte) in bytes.enumerated() { buffer[i] = CChar(bitPattern: byte) }
            buffer[bytes.count] = 0
        }
        let bound = withUnsafePointer(to: &address) { pointer -> Int32 in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard bound == 0, Darwin.listen(fd, 8) == 0 else {
            close(fd)
            throw RpcError.unreachable("could not listen at \(path)")
        }
        return fd
    }
}

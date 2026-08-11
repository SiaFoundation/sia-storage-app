import FileProvider
import XCTest

@testable import SiaFileProvider
@testable import SiaShared

private func makeItem(
    id: String = "f1", parentId: String? = nil, name: String = "a.txt", kind: String = "file",
    size: Int64 = 12, contentVersion: String = "sha256:abc", metadataVersion: String = "m1",
    uploaded: Bool = true, uploading: Bool = false, downloaded: Bool = true,
    downloading: Bool = false
) throws -> ProviderItem {
    let json = """
        {"id":"\(id)","parentId":\(parentId.map { "\"\($0)\"" } ?? "null"),"name":"\(name)",
         "kind":"\(kind)","size":\(size),"createdAt":1700000000000,"modifiedAt":1700000001000,
         "contentVersion":"\(contentVersion)","metadataVersion":"\(metadataVersion)",
         "uploaded":\(uploaded),"uploading":\(uploading),"downloaded":\(downloaded),
         "downloading":\(downloading),"progress":0}
        """
    return try JSONDecoder().decode(ProviderItem.self, from: Data(json.utf8))
}

final class ItemVersionTests: XCTestCase {
    func testABlankVersionFromTheDaemonIsReplacedRatherThanPassedOn() throws {
        let item = try makeItem(contentVersion: "", metadataVersion: "")

        let version = SiaItem(item).itemVersion

        // Empty here is what trips fileproviderd's assertion and restarts the
        // extension in a loop, so neither component may reach it blank.
        XCTAssertFalse(version.contentVersion.isEmpty)
        XCTAssertFalse(version.metadataVersion.isEmpty)
    }

    func testBothVersionComponentsAreNonEmpty() throws {
        let version = SiaItem(try makeItem()).itemVersion

        XCTAssertFalse(version.contentVersion.isEmpty)
        XCTAssertFalse(version.metadataVersion.isEmpty)
    }

    func testTheRootStillCarriesAVersion() {
        let version = SiaItem.root.itemVersion

        XCTAssertFalse(version.contentVersion.isEmpty)
        XCTAssertFalse(version.metadataVersion.isEmpty)
    }

    func testContentVersionTracksTheContentHash() throws {
        let a = SiaItem(try makeItem(contentVersion: "sha256:aaa")).itemVersion
        let b = SiaItem(try makeItem(contentVersion: "sha256:bbb")).itemVersion

        XCTAssertNotEqual(a.contentVersion, b.contentVersion)
    }

    func testMetadataVersionMovesIndependentlyOfContent() throws {
        let a = SiaItem(try makeItem(metadataVersion: "m1")).itemVersion
        let b = SiaItem(try makeItem(metadataVersion: "m2")).itemVersion

        XCTAssertEqual(a.contentVersion, b.contentVersion)
        XCTAssertNotEqual(a.metadataVersion, b.metadataVersion)
    }
}

final class ItemShapeTests: XCTestCase {
    func testRootReportsItselfAsTheRootContainer() {
        XCTAssertEqual(SiaItem.root.itemIdentifier, .rootContainer)
        XCTAssertEqual(SiaItem.root.contentType, .folder)
    }

    func testAnItemWithNoParentSitsAtTheRoot() throws {
        XCTAssertEqual(SiaItem(try makeItem(parentId: nil)).parentItemIdentifier, .rootContainer)
    }

    func testAnItemReportsItsFolder() throws {
        let item = SiaItem(try makeItem(parentId: "dir:d1"))

        XCTAssertEqual(item.parentItemIdentifier, NSFileProviderItemIdentifier("dir:d1"))
    }

    func testADirectoryReportsNoSize() throws {
        XCTAssertNil(SiaItem(try makeItem(kind: "dir", size: 0)).documentSize)
    }

    func testBothKindsAllowRenameReparentAndDelete() throws {
        // NSFileProviderItemCapabilities aliases its bits: allowsReading is
        // allowsContentEnumerating, and allowsWriting is allowsAddingSubItems.
        // Kind is carried by contentType, not by capabilities, so only the
        // genuinely distinct bits are worth asserting here.
        for caps in [
            SiaItem(try makeItem(kind: "dir")).capabilities,
            SiaItem(try makeItem()).capabilities,
        ] {
            XCTAssertTrue(caps.contains(.allowsRenaming))
            XCTAssertTrue(caps.contains(.allowsReparenting))
            XCTAssertTrue(caps.contains(.allowsDeleting))
        }
    }

    func testKindIsCarriedByContentType() throws {
        XCTAssertEqual(SiaItem(try makeItem(kind: "dir")).contentType, .folder)
        XCTAssertNotEqual(SiaItem(try makeItem(name: "a.txt")).contentType, .folder)
    }

    func testAFileCanBeReadRenamedAndDeleted() throws {
        let caps = SiaItem(try makeItem()).capabilities

        XCTAssertTrue(caps.contains(.allowsReading))
        XCTAssertTrue(caps.contains(.allowsRenaming))
        XCTAssertTrue(caps.contains(.allowsDeleting))
    }

    func testBadgeFlagsFollowTheItem() throws {
        let item = SiaItem(try makeItem(uploaded: false, downloading: true))

        XCTAssertEqual(item.isUploaded, NSNumber(value: false))
        XCTAssertEqual(item.isDownloading, NSNumber(value: true))
    }

    func testAFolderNeverCarriesABadge() {
        let root = SiaItem.root

        XCTAssertEqual(root.isUploaded, NSNumber(value: true))
        XCTAssertEqual(root.isDownloaded, NSNumber(value: true))
        XCTAssertEqual(root.isUploading, NSNumber(value: false))
        XCTAssertEqual(root.isDownloading, NSNumber(value: false))
    }
}

final class ErrorMappingTests: XCTestCase {
    func testUnreachableBecomesServerUnreachable() {
        let error = mapError(RpcError.unreachable("no socket"))

        XCTAssertEqual(error.domain, NSFileProviderErrorDomain)
        XCTAssertEqual(error.code, NSFileProviderError.serverUnreachable.rawValue)
    }

    func testAMissingItemBecomesNoSuchItem() {
        let error = mapError(RpcError.remote("No file with id f9"))

        XCTAssertEqual(error.code, NSFileProviderError.noSuchItem.rawValue)
    }

    func testTheAlertForAStoppedDaemonDoesNotQuoteTheTransport() {
        let error = mapError(RpcError.unreachable("connect() failed: 2"))

        // Finder shows this verbatim, so it says what to do, not what failed.
        XCTAssertFalse(error.localizedDescription.contains("connect()"))
        XCTAssertTrue(error.localizedDescription.contains("Sia Storage"))
    }

    func testTheAlertForARejectedPathDoesNotNameThePath() {
        let error = mapError(RpcError.remote("Handoff path is outside /Users/someone/x"))

        XCTAssertFalse(error.localizedDescription.contains("/Users/someone"))
    }

    func testARejectedPathBecomesAPermissionError() {
        let error = mapError(RpcError.remote("Handoff path is outside /x"))

        XCTAssertEqual(error.domain, NSCocoaErrorDomain)
        XCTAssertEqual(error.code, NSFileWriteNoPermissionError)
    }

    func testACollisionBecomesFilenameCollision() {
        let error = mapError(RpcError.remote("A file with that name already exists"))

        XCTAssertEqual(error.code, NSFileProviderError.filenameCollision.rawValue)
    }

    func testAFullDiskBecomesInsufficientQuota() {
        let error = mapError(RpcError.remote("ENOSPC: no space left on device"))

        XCTAssertEqual(error.code, NSFileProviderError.insufficientQuota.rawValue)
    }

    func testMalformedDataIsReportedAsCorruptRatherThanOffline() {
        let error = mapError(RpcError.decoding("reply was not a JSON object"))

        XCTAssertEqual(error.domain, NSCocoaErrorDomain)
        XCTAssertEqual(error.code, NSFileReadCorruptFileError)
    }

    func testAnUnrecognisedMessageStillLandsInAHonouredDomain() {
        let error = mapError(RpcError.remote("something new"))

        XCTAssertEqual(error.domain, NSFileProviderErrorDomain)
    }

    func testAnAlreadyMappedErrorPassesThrough() {
        let original = fpError(.noSuchItem, "gone")

        XCTAssertEqual(mapError(original), original)
    }
}

final class EnumeratorPagingTests: XCTestCase {
    func testTheOSInitialPagesCarryNoCursor() {
        let byName = NSFileProviderPage(NSFileProviderPage.initialPageSortedByName as Data)
        let byDate = NSFileProviderPage(NSFileProviderPage.initialPageSortedByDate as Data)

        XCTAssertNil(SiaEnumerator.cursor(from: byName))
        XCTAssertNil(SiaEnumerator.cursor(from: byDate))
    }

    func testOurOwnPageCarriesItsCursor() {
        let page = NSFileProviderPage(Data("500".utf8))

        XCTAssertEqual(SiaEnumerator.cursor(from: page), "500")
    }
}

/// A counter of attempts plus a clock the test moves by hand, so none of these
/// wait in real time.
private final class Attempts: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0
    var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
    func bump() {
        lock.lock()
        defer { lock.unlock() }
        value += 1
    }
}

private struct Unreachable: Error {}

/// Test state the handshake's `@Sendable` closures may read.
private final class Mutable<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: T
    init(_ value: T) { stored = value }
    var value: T {
        get {
            lock.lock()
            defer { lock.unlock() }
            return stored
        }
        set {
            lock.lock()
            defer { lock.unlock() }
            stored = newValue
        }
    }
}

final class HandshakeTests: XCTestCase {
    func testARefusedDaemonIsRetriedByTheNextCallback() async {
        let attempts = Attempts()
        let clock = Mutable(0.0)
        let reachable = Mutable(false)
        let handshake = Handshake(retryAfter: 1, now: { clock.value }) {
            attempts.bump()
            if !reachable.value { throw Unreachable() }
            return "0.0.5"
        }

        // The daemon is not up: this callback fails, as it should.
        do {
            try await handshake.ready()
            XCTFail("expected the first attempt to fail")
        } catch {}

        // The daemon comes up. A later callback must reach it rather than being
        // told the extension already gave up.
        reachable.value = true
        clock.value = 2
        try? await handshake.ready()

        let agreed = await handshake.isAgreed
        XCTAssertTrue(agreed)
        XCTAssertEqual(attempts.count, 2)
    }

    func testAgreementIsReachedOnlyOnce() async throws {
        let attempts = Attempts()
        let handshake = Handshake(retryAfter: 0, now: { 0 }) {
            attempts.bump()
            return "0.0.5"
        }

        try await handshake.ready()
        try await handshake.ready()
        try await handshake.ready()

        XCTAssertEqual(attempts.count, 1)
    }

    func testABurstOfCallbacksCostsOneConnectionAttempt() async {
        let attempts = Attempts()
        let handshake = Handshake(retryAfter: 1, now: { 0 }) {
            attempts.bump()
            throw Unreachable()
        }

        for _ in 0..<5 { try? await handshake.ready() }

        XCTAssertEqual(attempts.count, 1)
    }

    func testABurstOfCallbacksMakesOneConnectAttempt() async throws {
        let attempts = Attempts()
        let handshake = Handshake(retryAfter: 0, now: { 0 }) {
            attempts.bump()
            // Yields, which is where a re-entrant actor would let the next
            // caller start its own attempt.
            try await Task.sleep(nanoseconds: 10_000_000)
            return "0.0.5"
        }

        await withThrowingTaskGroup(of: Void.self) { group in
            for _ in 0..<8 { group.addTask { try await handshake.ready() } }
        }

        XCTAssertEqual(attempts.count, 1)
    }

}

/// The daemon checks the version only on the handshake itself and serves every
/// other channel unconditionally, so enumeration is stopped on this side or not
/// at all. These assert the refusal names the handshake rather than a failed
/// connect, which is what tells them apart.
final class EnumeratorGateTests: XCTestCase {
    private final class EnumerationObserver: NSObject, NSFileProviderEnumerationObserver {
        var error: Error?
        var finished = false
        let done = XCTestExpectation(description: "enumerate returned")

        func didEnumerate(_ updatedItems: [any NSFileProviderItemProtocol]) {}
        func finishEnumerating(upTo nextPage: NSFileProviderPage?) {
            finished = true
            done.fulfill()
        }
        func finishEnumeratingWithError(_ error: any Error) {
            self.error = error
            done.fulfill()
        }
    }

    private final class ChangeObserver: NSObject, NSFileProviderChangeObserver {
        var error: Error?
        let done = XCTestExpectation(description: "changes returned")

        func didUpdate(_ updatedItems: [any NSFileProviderItemProtocol]) {}
        func didDeleteItems(withIdentifiers deletedItemIdentifiers: [NSFileProviderItemIdentifier]) {}
        func finishEnumeratingChanges(upTo anchor: NSFileProviderSyncAnchor, moreComing: Bool) {
            done.fulfill()
        }
        func finishEnumeratingWithError(_ error: any Error) {
            self.error = error
            done.fulfill()
        }
    }

    /// Points somewhere nothing listens, so any call that slipped past the gate
    /// would report a connect failure instead.
    private func gatedEnumerator() -> SiaEnumerator {
        SiaEnumerator(rpc: Rpc(socketPath: "/nonexistent/sia.sock"), containerId: nil) {
            throw HandshakeError.notEstablished
        }
    }

    func testListingStopsBeforeTheDaemonWhenTheVersionIsUnagreed() {
        let observer = EnumerationObserver()
        gatedEnumerator().enumerateItems(
            for: observer, startingAt: NSFileProviderPage.initialPageSortedByName as NSFileProviderPage)
        wait(for: [observer.done], timeout: 5)

        XCTAssertFalse(observer.finished)
        let error = try? XCTUnwrap(observer.error as NSError?)
        XCTAssertEqual(error?.domain, NSFileProviderErrorDomain)
        XCTAssertEqual(error?.code, NSFileProviderError.serverUnreachable.rawValue)
        XCTAssertEqual(error?.localizedDescription, "The daemon is not reachable yet")
    }

    func testChangeFeedStopsBeforeTheDaemonWhenTheVersionIsUnagreed() {
        let observer = ChangeObserver()
        gatedEnumerator().enumerateChanges(
            for: observer, from: NSFileProviderSyncAnchor(Data("0".utf8)))
        wait(for: [observer.done], timeout: 5)

        let error = try? XCTUnwrap(observer.error as NSError?)
        XCTAssertEqual(error?.localizedDescription, "The daemon is not reachable yet")
    }
}
final class HandoffTests: XCTestCase {
    private var root: String!

    override func setUp() {
        root = NSTemporaryDirectory() + "sia-handoff-\(UUID().uuidString)"
        SiaPaths.ensureDirectory(root)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(atPath: root)
    }

    func testPrepareCreatesBothSubdirectories() throws {
        try Handoff(root: root).prepare()

        XCTAssertTrue(FileManager.default.fileExists(atPath: "\(root!)/fetch"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: "\(root!)/stage"))
    }

    func testEachFetchGetsItsOwnDestination() throws {
        let handoff = Handoff(root: root)

        XCTAssertNotEqual(handoff.fetchDestination(), handoff.fetchDestination())
    }

    func testStagingLinksRatherThanCopying() throws {
        let handoff = Handoff(root: root)
        try handoff.prepare()
        let source = "\(root!)/source.bin"
        FileManager.default.createFile(atPath: source, contents: Data("hello".utf8))

        let staged = try handoff.stage(URL(fileURLWithPath: source))

        // link(2) leaves the source in place and shares one inode.
        XCTAssertTrue(FileManager.default.fileExists(atPath: source))
        // Unwrapped: two failed lookups are both nil, and comparing them would
        // pass while proving nothing about the link.
        let a = try XCTUnwrap(
            FileManager.default.attributesOfItem(atPath: source)[.systemFileNumber] as? Int)
        let b = try XCTUnwrap(
            FileManager.default.attributesOfItem(atPath: staged)[.systemFileNumber] as? Int)
        XCTAssertEqual(a, b)
    }

    func testDiscardingRemovesTheStagedEntry() throws {
        let handoff = Handoff(root: root)
        try handoff.prepare()
        let source = "\(root!)/failed.bin"
        FileManager.default.createFile(atPath: source, contents: Data("bytes".utf8))
        let staged = try handoff.stage(URL(fileURLWithPath: source))

        handoff.discard(staged)

        XCTAssertFalse(FileManager.default.fileExists(atPath: staged))
    }

    func testDiscardingSomethingAlreadyGoneIsHarmless() throws {
        let handoff = Handoff(root: root)
        try handoff.prepare()

        handoff.discard("\(root!)/stage/never-existed")
    }

    func testStagedFilesLandInsideTheHandoffRoot() throws {
        let handoff = Handoff(root: root)
        try handoff.prepare()
        let source = "\(root!)/source2.bin"
        FileManager.default.createFile(atPath: source, contents: Data("x".utf8))

        let staged = try handoff.stage(URL(fileURLWithPath: source))

        XCTAssertTrue(staged.hasPrefix("\(root!)/stage/"))
    }

    func testStagingAMissingSourceThrows() throws {
        let handoff = Handoff(root: root)
        try handoff.prepare()

        XCTAssertThrowsError(try handoff.stage(URL(fileURLWithPath: "\(root!)/absent")))
    }

    func testSweepClearsAbandonedEntriesInBothDirectories() throws {
        let handoff = Handoff(root: root)
        try handoff.prepare()
        for sub in ["fetch", "stage"] {
            let orphan = "\(root!)/\(sub)/orphan"
            FileManager.default.createFile(atPath: orphan, contents: Data("x".utf8))
            try FileManager.default.setAttributes(
                [.modificationDate: Date(timeIntervalSinceNow: -3600)], ofItemAtPath: orphan)
        }

        handoff.sweep(olderThan: 600)

        XCTAssertFalse(FileManager.default.fileExists(atPath: "\(root!)/fetch/orphan"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: "\(root!)/stage/orphan"))
    }
}

final class ContainerArgumentTests: XCTestCase {
    func testTheRootIsPassedAsNull() {
        XCTAssertTrue(FileProviderExtension.containerArg(.rootContainer) is NSNull)
    }

    func testAFolderIsPassedById() {
        let arg = FileProviderExtension.containerArg(NSFileProviderItemIdentifier("dir:d1"))

        XCTAssertEqual(arg as? String, "dir:d1")
    }
}


import XCTest

@testable import ImportSourcesCore

final class StreamCopierTests: XCTestCase {
  private var dir: URL!

  override func setUpWithError() throws {
    dir = URL(fileURLWithPath: NSTemporaryDirectory())
      .appendingPathComponent("stream-copier-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  }

  override func tearDownWithError() throws {
    try? FileManager.default.removeItem(at: dir)
  }

  private func write(_ name: String, _ data: Data) throws -> String {
    let url = dir.appendingPathComponent(name)
    try data.write(to: url)
    return url.path
  }

  func testWritesDestPathDirectlyAndReturnsSizeHashMimeFromOneRead() throws {
    // jpeg magic so the first-chunk sniff fires.
    var payload = Data([0xFF, 0xD8, 0xFF, 0xE0])
    payload.append(Data((0..<100_000).map { UInt8($0 % 255) }))
    let source = try write("src.jpg", payload)
    let dest = dir.appendingPathComponent("id.token.tmp").path

    let result = try StreamCopier.copy(sourcePath: source, destPath: dest)

    XCTAssertEqual(result.size, Int64(payload.count))
    XCTAssertEqual(result.mime, "image/jpeg")
    var sink = Sha256Sink()
    sink.update(payload)
    XCTAssertEqual(result.sha256Hex, sink.finalizeHex())
    XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: dest)), payload)

    // destPath is written directly: the only entries in the dir are the
    // source and dest; no sibling native temp ever existed.
    let entries = try FileManager.default.contentsOfDirectory(atPath: dir.path).sorted()
    XCTAssertEqual(entries, ["id.token.tmp", "src.jpg"])
  }

  func testFailureMidStreamDeletesThePartial() throws {
    let source = try write("src.bin", Data(count: 300_000))
    let dest = dir.appendingPathComponent("dest.bin").path

    var written = 0
    XCTAssertThrowsError(
      try StreamCopier.copy(
        sourcePath: source, destPath: dest, chunkSize: 65536,
        writeOverride: { chunk in
          written += chunk.count
          if written > 100_000 {
            throw NSError(
              domain: NSCocoaErrorDomain, code: NSFileWriteOutOfSpaceError, userInfo: nil)
          }
        })
    ) { error in
      XCTAssertEqual((error as? CodedError)?.code, "not-enough-space")
    }
    XCTAssertFalse(FileManager.default.fileExists(atPath: dest))
  }

  func testSourceGoneAtOpenThrowsDeleted() {
    let dest = dir.appendingPathComponent("dest.bin").path
    XCTAssertThrowsError(
      try StreamCopier.copy(sourcePath: dir.appendingPathComponent("missing").path, destPath: dest)
    ) { error in
      XCTAssertEqual((error as? CodedError)?.code, "deleted")
    }
    XCTAssertFalse(FileManager.default.fileExists(atPath: dest))
  }

  func testCancellationMidCopyThrowsCancelledAndDeletesTheDest() throws {
    let source = try write("src.bin", Data(count: 500_000))
    let dest = dir.appendingPathComponent("dest.bin").path
    let registry = CopyRegistry()
    registry.register("c1")

    var chunks = 0
    XCTAssertThrowsError(
      try StreamCopier.copy(
        sourcePath: source, destPath: dest, copyId: "c1", registry: registry, chunkSize: 65536,
        writeOverride: { _ in
          chunks += 1
          if chunks == 2 { registry.cancel("c1") }
        })
    ) { error in
      XCTAssertEqual((error as? CodedError)?.code, "cancelled")
    }
    XCTAssertFalse(FileManager.default.fileExists(atPath: dest))
  }
}

import XCTest

@testable import ImportSourcesCore

final class Sha256SinkTests: XCTestCase {
  // NIST vector.
  func testKnownVector() {
    var sink = Sha256Sink()
    sink.update(Data("abc".utf8))
    XCTAssertEqual(
      sink.finalizeHex(),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  }
  func testChunkBoundariesDoNotChangeTheDigest() {
    let payload = Data((0..<200_000).map { UInt8($0 % 251) })
    var whole = Sha256Sink()
    whole.update(payload)
    let expected = whole.finalizeHex()

    for chunkSize in [1, 7, 65536] {
      var sink = Sha256Sink()
      var offset = 0
      while offset < payload.count {
        let end = min(offset + chunkSize, payload.count)
        sink.update(payload[offset..<end])
        offset = end
      }
      XCTAssertEqual(sink.finalizeHex(), expected, "chunk size \(chunkSize)")
    }
  }
}

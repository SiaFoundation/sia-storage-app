import XCTest

@testable import ImportSourcesCore

final class SourceRefCodecTests: XCTestCase {
  func testBookmarkRefsRoundTripThroughTheIosBmTag() throws {
    let blob = Data([0x01, 0x02, 0xFF, 0x00, 0x7A])
    let ref = SourceRefCodec.encodeBookmark(blob)
    XCTAssertTrue(ref.hasPrefix("ios-bm:"))
    XCTAssertEqual(try SourceRefCodec.decodeBookmark(ref), blob)
  }

  func testForeignTagThrowsIoError() {
    XCTAssertThrowsError(try SourceRefCodec.decodeBookmark("android-uri:content://x")) { error in
      XCTAssertEqual((error as? CodedError)?.code, "io-error")
    }
  }

  func testFileUrisPercentDecode() throws {
    let url = try SourceRefCodec.fileURL(fromPercentEncoded: "file:///a%20b/c%23d")
    XCTAssertEqual(url.path, "/a b/c#d")
    XCTAssertEqual(SourceRefCodec.path(fromFileUriOrPath: "file:///a%20b/c%23d"), "/a b/c#d")
    XCTAssertEqual(SourceRefCodec.path(fromFileUriOrPath: "/plain/path"), "/plain/path")
  }

  func testNonFileUriThrows() {
    XCTAssertThrowsError(try SourceRefCodec.fileURL(fromPercentEncoded: "content://media/1")) {
      XCTAssertEqual(($0 as? CodedError)?.code, "io-error")
    }
  }
}

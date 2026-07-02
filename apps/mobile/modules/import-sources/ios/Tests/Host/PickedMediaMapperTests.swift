import XCTest

@testable import ImportSourcesCore

final class PickedMediaMapperTests: XCTestCase {
  func testPreservesPickOrderRegardlessOfFetchOrder() {
    let meta: [String: [String: Any]] = [
      "a": ["mediaAssetId": "a", "accessible": true, "name": "a.jpg"],
      "b": ["mediaAssetId": "b", "accessible": true, "name": "b.jpg"],
    ]
    let out = PickedMediaMapper.entries(pickedIds: ["b", "a"], metaById: meta)
    XCTAssertEqual(out.map { $0["mediaAssetId"] as? String }, ["b", "a"])
    XCTAssertEqual(out[0]["name"] as? String, "b.jpg")
  }

  func testMissingIdBecomesInaccessibleEntry() {
    let meta: [String: [String: Any]] = [
      "a": ["mediaAssetId": "a", "accessible": true]
    ]
    let out = PickedMediaMapper.entries(pickedIds: ["a", "outside-selection"], metaById: meta)
    XCTAssertEqual(out[0]["accessible"] as? Bool, true)
    XCTAssertEqual(out[1]["mediaAssetId"] as? String, "outside-selection")
    XCTAssertEqual(out[1]["accessible"] as? Bool, false)
    XCTAssertNil(out[1]["name"])
  }
}

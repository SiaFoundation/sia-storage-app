import XCTest

@testable import ImportSourcesCore

final class ScopeRegistryTests: XCTestCase {
  func testDoubleOpenHoldsOneScope() {
    let registry = ScopeRegistry()
    var opens = 0
    XCTAssertTrue(registry.open(key: "ref") { opens += 1; return true })
    XCTAssertTrue(registry.open(key: "ref") { opens += 1; return true })
    XCTAssertEqual(opens, 1)
  }

  func testStopWithoutStartAndDoubleStopNeverOverRelease() {
    let registry = ScopeRegistry()
    var closes = 0
    registry.close(key: "never-opened") { closes += 1 }
    XCTAssertEqual(closes, 0)

    registry.open(key: "ref") { true }
    registry.close(key: "ref") { closes += 1 }
    registry.close(key: "ref") { closes += 1 }
    XCTAssertEqual(closes, 1)
  }

  func testFailedOpenIsNotRecorded() {
    let registry = ScopeRegistry()
    XCTAssertFalse(registry.open(key: "unscoped") { false })
    var closes = 0
    registry.close(key: "unscoped") { closes += 1 }
    XCTAssertEqual(closes, 0)
  }
}

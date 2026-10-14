import XCTest

@testable import MemoryInfoCore

final class MemoryReadingTests: XCTestCase {
  func testRoomLeftIsSpendableWithNoThreshold() {
    let reading = MemoryReading.from(available: 800_000_000)
    XCTAssertEqual(reading["availableBytes"] as? Int, 800_000_000)
    XCTAssertEqual(reading["thresholdBytes"] as? Int, 0)
    XCTAssertEqual(reading["lowMemory"] as? Bool, false)
  }

  func testZeroLeftOnADeviceIsLowMemory() {
    let reading = MemoryReading.from(available: 0)
    XCTAssertEqual(reading["availableBytes"] as? Int, 0)
    XCTAssertEqual(reading["lowMemory"] as? Bool, true)
  }
}

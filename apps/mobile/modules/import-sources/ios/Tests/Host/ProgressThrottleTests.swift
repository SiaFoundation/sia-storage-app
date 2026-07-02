import XCTest

@testable import ImportSourcesCore

final class ProgressThrottleTests: XCTestCase {
  func testFirstEmissionAlwaysPasses() {
    var throttle = ProgressThrottle()
    XCTAssertTrue(throttle.shouldEmit(bytes: 1, now: 0))
  }

  func testSubThresholdUpdatesAreSuppressed() {
    var throttle = ProgressThrottle()
    _ = throttle.shouldEmit(bytes: 0, now: 0)
    XCTAssertFalse(throttle.shouldEmit(bytes: 1000, now: 0.01))
    XCTAssertFalse(throttle.shouldEmit(bytes: 500_000, now: 0.05))
  }

  func testTimeGateAloneTriggers() {
    var throttle = ProgressThrottle()
    _ = throttle.shouldEmit(bytes: 0, now: 0)
    XCTAssertTrue(throttle.shouldEmit(bytes: 1, now: 0.11))
  }

  func testByteGateAloneTriggers() {
    var throttle = ProgressThrottle()
    _ = throttle.shouldEmit(bytes: 0, now: 0)
    XCTAssertTrue(throttle.shouldEmit(bytes: 1_048_576, now: 0.001))
  }

  func testGatesResetAfterEmission() {
    var throttle = ProgressThrottle()
    _ = throttle.shouldEmit(bytes: 0, now: 0)
    XCTAssertTrue(throttle.shouldEmit(bytes: 2_000_000, now: 0.001))
    XCTAssertFalse(throttle.shouldEmit(bytes: 2_000_001, now: 0.002))
  }
}

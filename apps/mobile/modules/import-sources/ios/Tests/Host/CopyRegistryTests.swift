import XCTest

@testable import ImportSourcesCore

final class CopyRegistryTests: XCTestCase {
  func testCancelThenFinishReportsCancelledOnce() {
    let registry = CopyRegistry()
    var cancels = 0
    registry.register("c1") { cancels += 1 }
    registry.cancel("c1")
    registry.cancel("c1")
    XCTAssertEqual(cancels, 1)
    XCTAssertTrue(registry.finish("c1"))
  }

  func testCancelAfterFinishFiresNothing() {
    let registry = CopyRegistry()
    var cancels = 0
    registry.register("c2") { cancels += 1 }
    XCTAssertFalse(registry.finish("c2"))
    registry.cancel("c2")
    XCTAssertEqual(cancels, 0)
  }

  func testUnknownCopyIdNoOps() {
    let registry = CopyRegistry()
    registry.cancel("nope")
    XCTAssertFalse(registry.isCancelled("nope"))
    XCTAssertFalse(registry.finish("nope"))
  }

  func testConcurrentCancelAndFinishYieldExactlyOneOutcome() {
    for round in 0..<200 {
      let registry = CopyRegistry()
      let id = "race-\(round)"
      var cancelFired = 0
      registry.register(id) { cancelFired += 1 }

      let group = DispatchGroup()
      var finishSawCancel = false
      DispatchQueue.global().async(group: group) { registry.cancel(id) }
      DispatchQueue.global().async(group: group) { finishSawCancel = registry.finish(id) }
      group.wait()

      // Either finish observed the cancel, or the cancel landed after removal
      // and fired nothing; never a delivered-result + fired-cancel pair.
      if !finishSawCancel {
        XCTAssertEqual(cancelFired, 0, "round \(round)")
      }
      XCTAssertLessThanOrEqual(cancelFired, 1, "round \(round)")
    }
  }
}

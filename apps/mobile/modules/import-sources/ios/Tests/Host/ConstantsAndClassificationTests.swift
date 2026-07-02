import XCTest

@testable import ImportSourcesCore

final class ConstantsAndClassificationTests: XCTestCase {
  func testEmptyFetchUnderLimitedAuthIsPermissionDeniedUnderFullAuthIsDeleted() {
    XCTAssertEqual(AuthClassification.classifyEmptyFetch(isLimitedAuth: true), "permission-denied")
    XCTAssertEqual(AuthClassification.classifyEmptyFetch(isLimitedAuth: false), "deleted")
  }
}

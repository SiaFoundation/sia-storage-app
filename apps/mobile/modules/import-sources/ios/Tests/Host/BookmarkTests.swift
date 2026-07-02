import XCTest

@testable import ImportSourcesCore

// Host bookmarks approximate iOS scope semantics (macOS bookmarks resolve the
// same API surface); the simulator suite is the fidelity gate.
final class BookmarkTests: XCTestCase {
  private var dir: URL!

  override func setUpWithError() throws {
    dir = URL(fileURLWithPath: NSTemporaryDirectory())
      .appendingPathComponent("bookmarks-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  }

  override func tearDownWithError() throws {
    try? FileManager.default.removeItem(at: dir)
  }

  func testCreateAndResolveRoundTrip() throws {
    let file = dir.appendingPathComponent("a.txt")
    try Data("hello".utf8).write(to: file)

    let ref = try BookmarkEngine.create(url: file)
    XCTAssertTrue(ref.hasPrefix("ios-bm:"))
    let resolved = try BookmarkEngine.resolve(ref: ref)
    // Bookmarks resolve tmp through the /private symlink on macOS.
    XCTAssertEqual(
      resolved.url.resolvingSymlinksInPath().path, file.resolvingSymlinksInPath().path)
    XCTAssertFalse(resolved.stale)
  }

  func testNonScopedUrlGetsABookmarkWithoutAnUnbalancedStop() throws {
    let file = dir.appendingPathComponent("b.txt")
    try Data("x".utf8).write(to: file)

    var stops = 0
    // startAccess returns false (host tmp files are not security-scoped, the
    // exact shape of an expo asCopy Inbox url), so stop must never fire.
    let ref = try BookmarkEngine.create(
      url: file, startAccess: { _ in false }, stopAccess: { _ in stops += 1 })
    XCTAssertTrue(ref.hasPrefix("ios-bm:"))
    XCTAssertEqual(stops, 0)
  }

  func testScopedBookmarkCreationBalancesItsOwnScope() throws {
    let file = dir.appendingPathComponent("c.txt")
    try Data("x".utf8).write(to: file)

    var starts = 0
    var stops = 0
    _ = try BookmarkEngine.create(
      url: file, startAccess: { _ in starts += 1; return true }, stopAccess: { _ in stops += 1 })
    XCTAssertEqual(starts, 1)
    XCTAssertEqual(stops, 1)
  }

  func testDeletedFileResolvesAsDeleted() throws {
    let file = dir.appendingPathComponent("d.txt")
    try Data("x".utf8).write(to: file)
    let ref = try BookmarkEngine.create(url: file)
    try FileManager.default.removeItem(at: file)

    XCTAssertThrowsError(try BookmarkEngine.resolve(ref: ref)) { error in
      XCTAssertEqual((error as? CodedError)?.code, "deleted")
    }
  }

  // Host bookmarks cannot reliably be made stale, so staleness itself is
  // asserted in the simulator suite with real security-scoped URLs.
}

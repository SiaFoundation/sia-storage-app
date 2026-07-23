import XCTest

@testable import ImportSourcesCore

// Exercises the exact calls ImportSourceRefsModule's dir bindings make
// (BookmarkEngine + FileManager), host-side. The binding itself only adds the
// Expo plumbing; the sim suite covers real scoped folders.
final class DirChildTests: XCTestCase {
  private var dir: URL!

  override func setUpWithError() throws {
    dir = URL(fileURLWithPath: NSTemporaryDirectory())
      .appendingPathComponent("dir-child-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    for name in ["one.txt", "two.txt", "three.txt"] {
      try Data(name.utf8).write(to: dir.appendingPathComponent(name))
    }
  }

  override func tearDownWithError() throws {
    try? FileManager.default.removeItem(at: dir)
  }

  func testOneDirRefCoversAllChildrenPerKey() throws {
    let dirRef = try BookmarkEngine.create(url: dir)
    let resolved = try BookmarkEngine.resolve(ref: dirRef)

    for key in ["one.txt", "two.txt", "three.txt"] {
      let child = BookmarkEngine.childURL(dir: resolved.url, key: key)
      XCTAssertTrue(FileManager.default.fileExists(atPath: child.path))
      XCTAssertEqual(try String(contentsOf: child, encoding: .utf8), key)
    }
  }

  func testDeletedChildFailsAloneSiblingsStillResolve() throws {
    let dirRef = try BookmarkEngine.create(url: dir)
    let resolved = try BookmarkEngine.resolve(ref: dirRef)
    try FileManager.default.removeItem(at: dir.appendingPathComponent("two.txt"))

    XCTAssertFalse(
      FileManager.default.fileExists(
        atPath: BookmarkEngine.childURL(dir: resolved.url, key: "two.txt").path))
    XCTAssertTrue(
      FileManager.default.fileExists(
        atPath: BookmarkEngine.childURL(dir: resolved.url, key: "one.txt").path))
  }

  func testDeletedDirFailsEveryChild() throws {
    let dirRef = try BookmarkEngine.create(url: dir)
    try FileManager.default.removeItem(at: dir)

    // The dir bookmark itself no longer resolves; every child resolution
    // fails at the dirRef step.
    XCTAssertThrowsError(try BookmarkEngine.resolve(ref: dirRef)) { error in
      XCTAssertEqual((error as? CodedError)?.code, "deleted")
    }
  }

}

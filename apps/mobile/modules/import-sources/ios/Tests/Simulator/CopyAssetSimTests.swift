import Photos
import XCTest

@testable import ImportSources

// Simulator tier: `bun run mobile:test:native:ios:sim`. Reads a real photo
// library, so it needs a booted simulator and cannot run on CI.
//
// Not reachable here, and checked on a device instead: iCloud download progress
// and its cloud-download-failed classification, the not-enough-space path, and
// a native throw observed from JS as error.code.
final class CopyAssetSimTests: XCTestCase {
  private var destDir: URL!

  override func setUpWithError() throws {
    try requirePhotoAccess()
    destDir = URL(fileURLWithPath: NSTemporaryDirectory())
      .appendingPathComponent("copy-asset-sim-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: destDir, withIntermediateDirectories: true)
  }

  /// Blocks until the photo library is authorized. The runner grants access
  /// with `simctl privacy grant` after installing the host (an install resets
  /// the app's TCC entries, so the grant must follow it). This guard covers a
  /// run outside the runner: it requests authorization and skips when denied.
  private func requirePhotoAccess() throws {
    if PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized { return }
    let decided = expectation(description: "photo access decided")
    PHPhotoLibrary.requestAuthorization(for: .readWrite) { _ in decided.fulfill() }
    wait(for: [decided], timeout: 60)
    let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    guard status == .authorized else {
      throw XCTSkip("photo library not authorized (status \(status.rawValue))")
    }
  }

  override func tearDownWithError() throws {
    try? FileManager.default.removeItem(at: destDir)
  }

  private func seedJpeg() throws -> (assetId: String, bytes: Data) {
    var payload = Data([0xFF, 0xD8, 0xFF, 0xE0])
    payload.append(Data((0..<50_000).map { UInt8($0 % 255) }))
    let file = destDir.appendingPathComponent("seed.jpg")
    try payload.write(to: file)

    var localId: String?
    var wrote = false
    var writeError: Error?
    let seeded = expectation(description: "seeded")
    PHPhotoLibrary.shared().performChanges {
      let request = PHAssetCreationRequest.forAsset()
      request.addResource(with: .photo, fileURL: file, options: nil)
      localId = request.placeholderForCreatedAsset?.localIdentifier
    } completionHandler: { success, error in
      wrote = success
      writeError = error
      seeded.fulfill()
    }
    wait(for: [seeded], timeout: 30)

    // Assert the write, then that the asset is fetchable. A silently failed
    // seed leaves a placeholder id that was never committed, and every copy
    // against it classifies as `deleted` - which the deleted-case test would
    // then pass for the wrong reason.
    XCTAssertTrue(wrote, "photo library write failed: \(String(describing: writeError))")
    let id = try XCTUnwrap(localId)
    XCTAssertEqual(
      PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).count, 1,
      "seeded asset is not fetchable (authorization: \(PHPhotoLibrary.authorizationStatus(for: .readWrite).rawValue))"
    )
    return (id, payload)
  }

  func testCopyAssetReturnsSizeHashMimeVariantAndEmitsProgress() throws {
    let (assetId, bytes) = try seedJpeg()
    let dest = destDir.appendingPathComponent("out.jpg").path

    var progressEvents = 0
    let done = expectation(description: "copied")
    var payload: [String: Any]?
    AssetCopier.copy(
      assetId: assetId, destPath: dest, copyId: "sim-1",
      onProgress: { _ in progressEvents += 1 },
      completion: { result in
        if case .success(let p) = result { payload = p }
        done.fulfill()
      })
    wait(for: [done], timeout: 30)

    let result = try XCTUnwrap(payload)
    XCTAssertEqual(result["size"] as? Int64, Int64(bytes.count))
    var sink = Sha256Sink()
    sink.update(bytes)
    XCTAssertEqual(result["sha256"] as? String, sink.finalizeHex())
    XCTAssertEqual(result["mime"] as? String, "image/jpeg")
    XCTAssertEqual(result["variant"] as? String, "original")
    XCTAssertGreaterThan(progressEvents, 0)
  }

  func testDeletedAssetIdClassifiesDeleted() throws {
    let (assetId, _) = try seedJpeg()
    let removed = expectation(description: "removed")
    PHPhotoLibrary.shared().performChanges {
      let fetch = PHAsset.fetchAssets(withLocalIdentifiers: [assetId], options: nil)
      PHAssetChangeRequest.deleteAssets(fetch)
    } completionHandler: { _, _ in removed.fulfill() }
    wait(for: [removed], timeout: 30)

    let done = expectation(description: "failed")
    var code: String?
    AssetCopier.copy(
      assetId: assetId, destPath: destDir.appendingPathComponent("x").path, copyId: "sim-2",
      onProgress: { _ in },
      completion: { result in
        if case .failure(let error) = result { code = error.code }
        done.fulfill()
      })
    wait(for: [done], timeout: 30)
    XCTAssertEqual(code, "deleted")
  }

  func testCancelMidCopyLeavesNoPartialFile() throws {
    let (assetId, _) = try seedJpeg()
    let dest = destDir.appendingPathComponent("cancelled.jpg").path

    let done = expectation(description: "cancelled")
    var outcome: Result<[String: Any], CodedError>?
    AssetCopier.copy(
      assetId: assetId, destPath: dest, copyId: "sim-3",
      onProgress: { _ in },
      completion: { result in
        outcome = result
        done.fulfill()
      })
    CopyRegistry.shared.cancel("sim-3")
    wait(for: [done], timeout: 30)

    switch outcome {
    case .failure(let error):
      XCTAssertEqual(error.code, "cancelled")
      XCTAssertFalse(FileManager.default.fileExists(atPath: dest))
    case .success:
      // A fast copy can legitimately win the race; then the file is whole.
      XCTAssertTrue(FileManager.default.fileExists(atPath: dest))
    case nil:
      XCTFail("no outcome delivered")
    }
  }

  /// Applies an edit to `assetId`, producing the `.fullSizePhoto` resource that
  /// only exists once an asset has adjustments. The rendered bytes differ from
  /// the original so a copy of the wrong resource is visible as a hash, not just
  /// as a label.
  private func applyAdjustment(to assetId: String) throws -> Data {
    let asset = try XCTUnwrap(
      PHAsset.fetchAssets(withLocalIdentifiers: [assetId], options: nil).firstObject)

    var rendered = Data([0xFF, 0xD8, 0xFF, 0xE1])
    rendered.append(Data((0..<30_000).map { UInt8(($0 &* 7) % 251) }))

    let gotInput = expectation(description: "editing input")
    var input: PHContentEditingInput?
    asset.requestContentEditingInput(with: PHContentEditingInputRequestOptions()) { i, _ in
      input = i
      gotInput.fulfill()
    }
    wait(for: [gotInput], timeout: 30)
    let editingInput = try XCTUnwrap(input, "no content editing input")

    let output = PHContentEditingOutput(contentEditingInput: editingInput)
    output.adjustmentData = PHAdjustmentData(
      formatIdentifier: "tech.sia.importsources.test",
      formatVersion: "1",
      data: Data("rotate".utf8))
    try rendered.write(to: output.renderedContentURL)

    var wrote = false
    var writeError: Error?
    let applied = expectation(description: "adjustment applied")
    PHPhotoLibrary.shared().performChanges {
      let request = PHAssetChangeRequest(for: asset)
      request.contentEditingOutput = output
    } completionHandler: { success, error in
      wrote = success
      writeError = error
      applied.fulfill()
    }
    wait(for: [applied], timeout: 30)
    XCTAssertTrue(wrote, "applying the adjustment failed: \(String(describing: writeError))")
    return rendered
  }

  func testAdjustedImageReturnsRenderedVariant() throws {
    let (assetId, original) = try seedJpeg()
    let rendered = try applyAdjustment(to: assetId)

    let dest = destDir.appendingPathComponent("edited.jpg").path
    let done = expectation(description: "copied")
    var payload: [String: Any]?
    AssetCopier.copy(
      assetId: assetId, destPath: dest, copyId: "sim-4",
      onProgress: { _ in },
      completion: { result in
        if case .success(let p) = result { payload = p }
        done.fulfill()
      })
    wait(for: [done], timeout: 30)

    let result = try XCTUnwrap(payload)
    XCTAssertEqual(result["variant"] as? String, "rendered")

    // The decisive assertion: an edited asset must copy the edited bytes, not
    // the capture they were derived from.
    var renderedSink = Sha256Sink()
    renderedSink.update(rendered)
    var originalSink = Sha256Sink()
    originalSink.update(original)
    XCTAssertEqual(result["sha256"] as? String, renderedSink.finalizeHex())
    XCTAssertNotEqual(result["sha256"] as? String, originalSink.finalizeHex())
  }
}

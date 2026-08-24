import Photos
import UIKit
import XCTest

@testable import ImportSources

// Simulator tier: `bun run mobile:test:native:ios:sim`. An edited photo keeps
// its original capture and the rendered result as separate resources, and
// only a real photo library holds both.
final class PickerMetadataSimTests: XCTestCase {
  private var dir: URL!

  override func setUpWithError() throws {
    if PHPhotoLibrary.authorizationStatus(for: .readWrite) != .authorized {
      throw XCTSkip("photo library not authorized")
    }
    dir = URL(fileURLWithPath: NSTemporaryDirectory())
      .appendingPathComponent("picker-metadata-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  }

  override func tearDownWithError() throws {
    if let dir { try? FileManager.default.removeItem(at: dir) }
  }

  /// Seeds an edited photo: an original PNG named `IMG_1234.PNG`, a render, and
  /// the adjustment data that marks the render as an edit. Photos stores every
  /// render as `FullSizeRender.jpeg` typed JPEG, whatever bytes it was given, so
  /// the original is a PNG for the two to differ in type.
  private func image(_ color: UIColor) -> UIImage {
    UIGraphicsImageRenderer(size: CGSize(width: 64, height: 64)).image { ctx in
      color.setFill()
      ctx.fill(CGRect(x: 0, y: 0, width: 64, height: 64))
    }
  }

  private func seedEditedPhoto() throws -> String {
    // Decodable images, since the CI runner's Photos rejects arbitrary bytes
    // behind an image header where a local simulator accepts them.
    let original = dir.appendingPathComponent("original.png")
    try XCTUnwrap(image(.systemTeal).pngData()).write(to: original)
    let render = dir.appendingPathComponent("render.jpg")
    try XCTUnwrap(image(.systemOrange).jpegData(compressionQuality: 0.9)).write(to: render)

    let adjustment = dir.appendingPathComponent("adjustment.plist")
    let plist: [String: Any] = [
      "adjustmentFormatIdentifier": "app.sia.storage.test",
      "adjustmentFormatVersion": "1",
      "adjustmentData": Data([1]),
    ]
    try PropertyListSerialization.data(fromPropertyList: plist, format: .binary, options: 0)
      .write(to: adjustment)

    var localId: String?
    var wrote = false
    var writeError: Error?
    let seeded = expectation(description: "seeded")
    PHPhotoLibrary.shared().performChanges {
      let request = PHAssetCreationRequest.forAsset()
      let named = PHAssetResourceCreationOptions()
      named.originalFilename = "IMG_1234.PNG"
      request.addResource(with: .photo, fileURL: original, options: named)
      request.addResource(with: .fullSizePhoto, fileURL: render, options: nil)
      request.addResource(with: .adjustmentData, fileURL: adjustment, options: nil)
      localId = request.placeholderForCreatedAsset?.localIdentifier
    } completionHandler: { success, error in
      wrote = success
      writeError = error
      seeded.fulfill()
    }
    wait(for: [seeded], timeout: 30)
    XCTAssertTrue(wrote, "photo library write failed: \(String(describing: writeError))")
    return try XCTUnwrap(localId)
  }

  func testEditedPhotoIsNamedAfterItsCaptureAndTypedAsItsRender() throws {
    let id = try seedEditedPhoto()
    let meta = try XCTUnwrap(MediaPickerPresenter.metadata(for: [id])[id])
    XCTAssertEqual(meta["name"] as? String, "IMG_1234.PNG")
    XCTAssertEqual(meta["mimeType"] as? String, "image/jpeg")
  }
}

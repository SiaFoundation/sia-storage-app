import XCTest

@testable import ImportSourcesCore

final class BytesPolicyTests: XCTestCase {
  func testSelectsRenderedWhenPresentOtherwiseOriginal() throws {
    // Each row: mediaKind, hasAdjustments, resources, then the expected
    // selection and variant.
    let table: [(BytesPolicy.MediaKind, Bool, Set<BytesPolicy.ResourceKind>, BytesPolicy.ResourceKind, String)] = [
      (.image, false, [.photo], .photo, "original"),
      (.image, true, [.photo, .fullSizePhoto], .fullSizePhoto, "rendered"),
      (.video, false, [.video], .video, "original"),
      (.video, true, [.video, .fullSizeVideo], .fullSizeVideo, "rendered"),
      // Live photo: the still only; the paired video is never selected.
      (.image, false, [.photo, .pairedVideo], .photo, "original"),
      (.image, true, [.photo, .fullSizePhoto, .pairedVideo], .fullSizePhoto, "rendered"),
      // Unedited slow-mo has no rendered resource: raw high-fps original.
      (.video, false, [.video, .pairedVideo], .video, "original"),
    ]
    for (kind, adjusted, resources, selection, variant) in table {
      let decision = try BytesPolicy.decide(
        mediaKind: kind, hasAdjustments: adjusted, resources: resources)
      XCTAssertEqual(decision, BytesPolicy.Decision(selection: selection, variant: variant))
    }
  }

  func testEmptyResourceSetIsUnsupported() {
    XCTAssertThrowsError(
      try BytesPolicy.decide(mediaKind: .image, hasAdjustments: false, resources: [])
    ) { error in
      XCTAssertEqual((error as? CodedError)?.code, "unsupported")
    }
  }

  func testAdjustedWithoutRenderedResourceFallsBackToOriginal() throws {
    let decision = try BytesPolicy.decide(
      mediaKind: .image, hasAdjustments: true, resources: [.photo])
    XCTAssertEqual(decision, BytesPolicy.Decision(selection: .photo, variant: "original"))
  }
}

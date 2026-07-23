import XCTest

@testable import ImportSourcesCore

final class MimeSnifferTests: XCTestCase {
  private func ftyp(brand: String) -> Data {
    var data = Data([0x00, 0x00, 0x00, 0x18])
    data.append(Data("ftyp".utf8))
    data.append(Data(brand.utf8))
    data.append(Data(count: 8))
    return data
  }

  func testAllMagicTableFormats() {
    let table: [(Data, String?)] = [
      (Data([0xFF, 0xD8, 0xFF, 0xE0, 0x00]), "image/jpeg"),
      (Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A]), "image/png"),
      (Data("GIF89a".utf8), "image/gif"),
      (Data("%PDF-1.7".utf8), "application/pdf"),
      (Data([0x50, 0x4B, 0x03, 0x04, 0x14]), "application/zip"),
      (ftyp(brand: "heic"), "image/heic"),
      (ftyp(brand: "mp42"), "video/mp4"),
      (ftyp(brand: "qt  "), "video/quicktime"),
      (Data("plain text, no magic".utf8), nil),
      (Data(), nil),
    ]
    for (data, expected) in table {
      XCTAssertEqual(MimeSniffer.sniff(data), expected)
    }
  }
}

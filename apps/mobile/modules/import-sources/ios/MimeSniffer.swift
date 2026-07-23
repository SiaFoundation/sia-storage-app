import Foundation

/// Magic-bytes mime detection over a copy's first chunk, only for
/// `copyToPath`, where no metadata authority exists. `copyAsset` never sniffs
/// (PHAssetResource / MediaStore carry the authoritative type).
public enum MimeSniffer {
  public static func sniff(_ data: Data) -> String? {
    if data.starts(with: [0xFF, 0xD8, 0xFF]) { return "image/jpeg" }
    if data.starts(with: [0x89, 0x50, 0x4E, 0x47]) { return "image/png" }
    if data.starts(with: [0x47, 0x49, 0x46]) { return "image/gif" }
    if data.starts(with: [0x25, 0x50, 0x44, 0x46]) { return "application/pdf" }
    if data.starts(with: [0x50, 0x4B, 0x03, 0x04]) { return "application/zip" }
    // ISO base-media formats: bytes 4-7 are "ftyp", brand at 8-11.
    if data.count >= 12, data[4...7].elementsEqual("ftyp".utf8) {
      let brand = String(decoding: data[8...11], as: UTF8.self)
      if ["heic", "heix", "hevc", "mif1", "msf1"].contains(brand) { return "image/heic" }
      if brand.hasPrefix("qt") { return "video/quicktime" }
      if ["mp41", "mp42", "isom", "iso2", "avc1", "mmp4"].contains(brand) { return "video/mp4" }
    }
    return nil
  }
}

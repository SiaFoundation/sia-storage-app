import Foundation

/// Encoding of durable refs (`ios-bm:<base64 bookmark blob>`) and file-URI
/// percent-decoding. Pickers hand percent-encoded `file://` URLs; every
/// filesystem touch must go through the decoded path.
public enum SourceRefCodec {
  public static let bookmarkTag = "ios-bm:"

  public static func encodeBookmark(_ data: Data) -> String {
    bookmarkTag + data.base64EncodedString()
  }

  public static func decodeBookmark(_ ref: String) throws -> Data {
    guard ref.hasPrefix(bookmarkTag),
      let data = Data(base64Encoded: String(ref.dropFirst(bookmarkTag.count)))
    else {
      throw CodedError("io-error", "not an ios-bm ref")
    }
    return data
  }

  public static func fileURL(fromPercentEncoded uri: String) throws -> URL {
    guard let url = URL(string: uri), url.isFileURL else {
      throw CodedError("io-error", "not a file:// uri: \(uri)")
    }
    return url
  }

  /// The decoded filesystem path for a (possibly percent-encoded) file:// uri,
  /// or the input unchanged when it is already a plain path.
  public static func path(fromFileUriOrPath value: String) -> String {
    if value.hasPrefix("file://"), let url = URL(string: value), url.isFileURL {
      return url.path
    }
    return value
  }
}

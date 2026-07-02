import CryptoKit
import Foundation

/// Streaming SHA-256, updated per copy chunk so hashing rides the copy's one
/// read. Emits bare lowercase hex; the TS package index is the only place
/// that prefixes `sha256:`.
public struct Sha256Sink {
  private var hasher = SHA256()

  public init() {}

  public mutating func update(_ data: Data) {
    hasher.update(data: data)
  }

  public func finalizeHex() -> String {
    hasher.finalize().map { String(format: "%02x", $0) }.joined()
  }
}

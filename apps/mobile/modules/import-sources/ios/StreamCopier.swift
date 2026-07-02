import Foundation

/// File copy for `copyToPath`: one read produces the copy, the SHA-256, and
/// a first-chunk mime sniff. Writes `destPath` directly. The caller supplies
/// the claim-scoped temp path and owns atomic publication; a native-internal
/// `.tmp` suffix would corrupt the orphan scanner's filename parsing. On any
/// failure or cancellation the partial dest is deleted before the error
/// propagates.
public enum StreamCopier {
  public struct CopyResult: Equatable {
    public let size: Int64
    public let sha256Hex: String
    public let mime: String?

    public init(size: Int64, sha256Hex: String, mime: String?) {
      self.size = size
      self.sha256Hex = sha256Hex
      self.mime = mime
    }
  }

  public static func copy(
    sourcePath: String,
    destPath: String,
    copyId: String? = nil,
    registry: CopyRegistry = .shared,
    chunkSize: Int = 65536,
    // Injectable for fail-mid-stream tests; production writes the dest handle.
    writeOverride: ((Data) throws -> Void)? = nil,
    onBytes: ((Int64) -> Void)? = nil
  ) throws -> CopyResult {
    let fm = FileManager.default

    guard fm.fileExists(atPath: sourcePath) else {
      throw CodedError("deleted", "source missing: \(sourcePath)")
    }
    let input: FileHandle
    do {
      input = try FileHandle(forReadingFrom: URL(fileURLWithPath: sourcePath))
    } catch {
      throw mapReadOpenError(error)
    }
    defer { try? input.close() }

    fm.createFile(atPath: destPath, contents: nil)
    let output: FileHandle?
    if writeOverride == nil {
      guard let handle = FileHandle(forWritingAtPath: destPath) else {
        try? fm.removeItem(atPath: destPath)
        throw CodedError("io-error", "cannot open dest: \(destPath)")
      }
      output = handle
    } else {
      output = nil
    }

    var sink = Sha256Sink()
    var size: Int64 = 0
    var mime: String?

    func cleanupAndThrow(_ error: Error) throws -> Never {
      try? output?.close()
      try? fm.removeItem(atPath: destPath)
      throw error
    }

    while true {
      if let copyId, registry.isCancelled(copyId) {
        try cleanupAndThrow(CodedError("cancelled", "copy cancelled"))
      }
      let chunk = input.readData(ofLength: chunkSize)
      if chunk.isEmpty { break }
      if size == 0 { mime = MimeSniffer.sniff(chunk) }
      do {
        if let writeOverride {
          try writeOverride(chunk)
        } else {
          try output?.write(contentsOf: chunk)
        }
      } catch {
        try cleanupAndThrow(mapWriteError(error))
      }
      sink.update(chunk)
      size += Int64(chunk.count)
      onBytes?(size)
    }

    if let copyId, registry.isCancelled(copyId) {
      try cleanupAndThrow(CodedError("cancelled", "copy cancelled"))
    }
    try? output?.close()
    return CopyResult(size: size, sha256Hex: sink.finalizeHex(), mime: mime)
  }

  private static func mapReadOpenError(_ error: Error) -> Error {
    if let coded = error as? CodedError { return coded }
    let ns = error as NSError
    if ns.domain == NSCocoaErrorDomain {
      if ns.code == NSFileReadNoSuchFileError { return CodedError("deleted", ns.localizedDescription) }
      if ns.code == NSFileReadNoPermissionError {
        return CodedError("permission-denied", ns.localizedDescription)
      }
    }
    return CodedError("io-error", ns.localizedDescription)
  }

  private static func mapWriteError(_ error: Error) -> Error {
    if let coded = error as? CodedError { return coded }
    let ns = error as NSError
    if ns.domain == NSCocoaErrorDomain, ns.code == NSFileWriteOutOfSpaceError {
      return CodedError("not-enough-space", ns.localizedDescription)
    }
    if ns.domain == NSPOSIXErrorDomain, ns.code == Int(ENOSPC) {
      return CodedError("not-enough-space", ns.localizedDescription)
    }
    return CodedError("io-error", ns.localizedDescription)
  }
}

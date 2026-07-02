import Foundation
import Photos
import UniformTypeIdentifiers

/// MediaAssetReader's iOS engine. PHAssetResourceManager.requestData streams
/// the selected resource's bytes straight into the dest handle while the
/// digest updates per chunk, with no intermediate file. AVAssetExportSession
/// is avoided on purpose: it deterministically throws for slow-mo and edited
/// videos.
enum AssetCopier {
  struct Progress {
    let bytesCopied: Int64
    let totalBytes: Int64?
    let fraction: Double?
  }

  /// Batched size hints for `getSizes`: metadata only, never triggers an
  /// iCloud download. Sizes the same resource BytesPolicy would copy, via the
  /// undocumented-but-industry-standard `fileSize` KVC key (PhotoKit has no
  /// public byte-size API). Anything unreadable (missing asset, empty
  /// resources as in iCloud shared albums, a policy throw, a removed key)
  /// maps to NSNull: callers treat null as unknown, and the copy re-measures
  /// the authoritative size from the streamed bytes.
  static func sizes(assetIds: [String]) -> [String: Any] {
    var out: [String: Any] = [:]
    for id in assetIds { out[id] = NSNull() }
    let fetch = PHAsset.fetchAssets(withLocalIdentifiers: assetIds, options: nil)
    fetch.enumerateObjects { asset, _, _ in
      let resources = PHAssetResource.assetResources(for: asset)
      let kinds = Set(resources.compactMap { resourceKind($0.type) })
      let hasAdjustments = kinds.contains(.fullSizePhoto) || kinds.contains(.fullSizeVideo)
      guard
        let decision = try? BytesPolicy.decide(
          mediaKind: asset.mediaType == .video ? .video : .image,
          hasAdjustments: hasAdjustments,
          resources: kinds),
        let resource = resources.first(where: { resourceKind($0.type) == decision.selection }),
        // KVC on a private key: if an iOS release removes it, valueForKey
        // raises an uncatchable NSUnknownKeyException, so probe first.
        resource.responds(to: Selector(("fileSize"))),
        let size = resource.value(forKey: "fileSize") as? Int64,
        size > 0
      else { return }
      out[asset.localIdentifier] = size
    }
    return out
  }

  static func copy(
    assetId: String,
    destPath: String,
    copyId: String,
    onProgress: @escaping (Progress) -> Void,
    completion: @escaping (Result<[String: Any], CodedError>) -> Void
  ) {
    let fetch = PHAsset.fetchAssets(withLocalIdentifiers: [assetId], options: nil)
    guard let asset = fetch.firstObject else {
      let limited = PHPhotoLibrary.authorizationStatus(for: .readWrite) == .limited
      let code = AuthClassification.classifyEmptyFetch(isLimitedAuth: limited)
      completion(.failure(CodedError(code, "asset fetch returned nothing")))
      return
    }

    let resources = PHAssetResource.assetResources(for: asset)
    let kinds = Set(resources.compactMap { resourceKind($0.type) })
    // Adjusted assets carry a fullSize* resource; unedited ones don't. That
    // presence is the only public has-adjustments signal (PHAsset exposes
    // none).
    let hasAdjustments = kinds.contains(.fullSizePhoto) || kinds.contains(.fullSizeVideo)
    let decision: BytesPolicy.Decision
    do {
      decision = try BytesPolicy.decide(
        mediaKind: asset.mediaType == .video ? .video : .image,
        hasAdjustments: hasAdjustments,
        resources: kinds)
    } catch let error as CodedError {
      completion(.failure(error))
      return
    } catch {
      completion(.failure(CodedError("io-error", "\(error)")))
      return
    }
    guard let resource = resources.first(where: { resourceKind($0.type) == decision.selection })
    else {
      completion(.failure(CodedError("unsupported", "selected resource vanished")))
      return
    }

    let fm = FileManager.default
    fm.createFile(atPath: destPath, contents: nil)
    guard let output = FileHandle(forWritingAtPath: destPath) else {
      completion(.failure(CodedError("io-error", "cannot open dest: \(destPath)")))
      return
    }

    var sink = Sha256Sink()
    var size: Int64 = 0
    var writeError: CodedError?
    let manager = PHAssetResourceManager.default()

    // PhotoKit fires progressHandler and dataReceivedHandler on different
    // queues; one serial queue keeps onProgress (and the module's throttle
    // state behind it) single-threaded.
    let progressQueue = DispatchQueue(label: "importsources.copy.progress")

    let options = PHAssetResourceRequestOptions()
    options.isNetworkAccessAllowed = true
    options.progressHandler = { fraction in
      // The iCloud download phase precedes any data delivery: no bytes yet.
      progressQueue.async { onProgress(Progress(bytesCopied: 0, totalBytes: nil, fraction: fraction)) }
    }

    var requestID: PHAssetResourceDataRequestID = .init()
    // Register BEFORE requestData: a fast local copy can complete (and call
    // finish) before requestData even returns; a late register would insert
    // an entry nothing ever removes. The closure reads `requestID` when cancel
    // fires, after the assignment below.
    CopyRegistry.shared.register(copyId) {
      manager.cancelDataRequest(requestID)
    }
    requestID = manager.requestData(
      for: resource, options: options,
      dataReceivedHandler: { data in
        if writeError != nil { return }
        do {
          try output.write(contentsOf: data)
          sink.update(data)
          size += Int64(data.count)
          let bytes = size
          progressQueue.async { onProgress(Progress(bytesCopied: bytes, totalBytes: nil, fraction: nil)) }
        } catch {
          writeError = mapWriteError(error)
          manager.cancelDataRequest(requestID)
        }
      },
      completionHandler: { error in
        let cancelled = CopyRegistry.shared.finish(copyId)
        try? output.close()

        func fail(_ coded: CodedError) {
          try? fm.removeItem(atPath: destPath)
          completion(.failure(coded))
        }

        if cancelled {
          fail(CodedError("cancelled", "copy cancelled"))
          return
        }
        if let writeError {
          fail(writeError)
          return
        }
        if let error {
          fail(mapCompletionError(error))
          return
        }
        let mime =
          UTType(resource.uniformTypeIdentifier)?.preferredMIMEType
          ?? resource.uniformTypeIdentifier
        completion(
          .success([
            "size": size,
            "sha256": sink.finalizeHex(),
            "mime": mime,
            "variant": decision.variant,
          ]))
      })
  }

  private static func resourceKind(_ type: PHAssetResourceType) -> BytesPolicy.ResourceKind? {
    switch type {
    case .photo: return .photo
    case .fullSizePhoto: return .fullSizePhoto
    case .video: return .video
    case .fullSizeVideo: return .fullSizeVideo
    case .pairedVideo: return .pairedVideo
    default: return nil
    }
  }

  private static func mapWriteError(_ error: Error) -> CodedError {
    let ns = error as NSError
    if ns.domain == NSCocoaErrorDomain, ns.code == NSFileWriteOutOfSpaceError {
      return CodedError("not-enough-space", ns.localizedDescription)
    }
    if ns.domain == NSPOSIXErrorDomain, ns.code == Int(ENOSPC) {
      return CodedError("not-enough-space", ns.localizedDescription)
    }
    return CodedError("io-error", ns.localizedDescription)
  }

  private static func mapCompletionError(_ error: Error) -> CodedError {
    let ns = error as NSError
    if ns.domain == PHPhotosErrorDomain {
      if ns.code == PHPhotosError.userCancelled.rawValue {
        return CodedError("cancelled", ns.localizedDescription)
      }
      // networkAccessRequired / networkError family: the iCloud pull failed.
      return CodedError("cloud-download-failed", ns.localizedDescription)
    }
    if ns.domain == NSURLErrorDomain || ns.domain == "CKErrorDomain" {
      return CodedError("cloud-download-failed", ns.localizedDescription)
    }
    return CodedError("io-error", ns.localizedDescription)
  }
}

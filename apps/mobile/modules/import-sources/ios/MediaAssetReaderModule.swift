import ExpoModulesCore
import Foundation

/// Expo bindings for photo-library reads: stream an asset's bytes to a path
/// with throttled progress events and cancellation, plus batched size hints.
public class MediaAssetReaderModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MediaAssetReader")

    Events("copyProgress")

    AsyncFunction("copyAsset") { (assetId: String, destPath: String, copyId: String, promise: Promise) in
      var throttle = ProgressThrottle()
      AssetCopier.copy(
        assetId: assetId,
        destPath: SourceRefCodec.path(fromFileUriOrPath: destPath),
        copyId: copyId,
        onProgress: { [weak self] progress in
          guard throttle.shouldEmit(bytes: progress.bytesCopied, now: Date().timeIntervalSince1970)
          else { return }
          self?.sendEvent(
            "copyProgress",
            [
              "copyId": copyId,
              "bytesCopied": progress.bytesCopied,
              "totalBytes": progress.totalBytes as Any,
              "fraction": progress.fraction as Any,
            ])
        },
        completion: { result in
          switch result {
          case .success(let payload):
            promise.resolve(payload)
          case .failure(let error):
            promise.reject(ImportSourcesException(error.code, error.message))
          }
        })
    }

    AsyncFunction("cancelCopy") { (copyId: String) in
      CopyRegistry.shared.cancel(copyId)
    }

    AsyncFunction("getSizes") { (assetIds: [String], promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        promise.resolve(AssetCopier.sizes(assetIds: assetIds))
      }
    }
  }
}

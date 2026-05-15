import ExpoModulesCore
import Photos
import UIKit

// Writes a system-cached PHAsset thumbnail to the app cache directory and
// resolves with the resulting file:// path. PHImageManager dispatches the
// work to photolibraryd; with deliveryMode=.fastFormat, resizeMode=.exact,
// and isNetworkAccessAllowed=false the call returns a cached tile sized to
// the request without decoding the full asset and without iCloud network.
// The JPEG encode and write also happen on a global queue — no bytes
// touch the JS thread.
//
// Returns nil for any expected failure (asset deleted, permission revoked,
// cached tile unavailable) — callers fall back to the in-process resize.
public class SiaOsThumbModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SiaOsThumb")

    AsyncFunction("getOsThumbnail") { (localId: String, targetSize: Double, promise: Promise) in
      let identifier = localId.hasPrefix("ph://") ? String(localId.dropFirst(5)) : localId
      let fetch = PHAsset.fetchAssets(withLocalIdentifiers: [identifier], options: nil)
      guard let asset = fetch.firstObject else {
        promise.resolve(nil)
        return
      }

      let opts = PHImageRequestOptions()
      opts.deliveryMode = .fastFormat
      opts.resizeMode = .exact
      opts.isNetworkAccessAllowed = false
      opts.isSynchronous = false

      let pixelSize = CGSize(width: targetSize, height: targetSize)

      PHImageManager.default().requestImage(
        for: asset,
        targetSize: pixelSize,
        contentMode: .aspectFill,
        options: opts
      ) { image, _ in
        DispatchQueue.global(qos: .userInitiated).async {
          guard let image = image,
                let data = image.jpegData(compressionQuality: 0.85)
          else {
            promise.resolve(nil)
            return
          }
          let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("sia-os-thumb", isDirectory: true)
          do {
            try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
          } catch {
            promise.resolve(nil)
            return
          }
          let file = cache.appendingPathComponent("\(identifier)-\(Int(targetSize))-\(UUID().uuidString).jpg")
          do {
            try data.write(to: file, options: .atomic)
          } catch {
            promise.resolve(nil)
            return
          }
          promise.resolve([
            "uri": file.absoluteString,
            "width": Int(image.size.width),
            "height": Int(image.size.height),
            "mimeType": "image/jpeg",
          ])
        }
      }
    }
  }
}

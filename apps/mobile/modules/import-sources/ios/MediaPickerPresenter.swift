import ExpoModulesCore
import Photos
import PhotosUI
import UIKit

/// Identifier-delivery photo picking: the picker hands back PHAsset ids and
/// no byte representation is ever exported, so a pick moves zero bytes and
/// the scanner's media path performs the one and only copy (and hash) later.
/// The out-of-process picker shows the full library regardless of the app's
/// photo authorization; an id outside a limited-access selection fetches
/// empty and comes back `accessible: false` for the app to classify.
final class MediaPickerPresenter: NSObject, PHPickerViewControllerDelegate {
  private static var active: MediaPickerPresenter?

  private let promise: Promise

  private init(promise: Promise) {
    self.promise = promise
  }

  static func present(from viewController: UIViewController, promise: Promise) {
    guard active == nil else {
      promise.reject(ImportSourcesException("io-error", "a pick is already in progress"))
      return
    }
    let presenter = MediaPickerPresenter(promise: promise)
    active = presenter

    var config = PHPickerConfiguration(photoLibrary: .shared())
    config.selectionLimit = 0
    config.preferredAssetRepresentationMode = .current
    let picker = PHPickerViewController(configuration: config)
    picker.delegate = presenter
    viewController.present(picker, animated: true)
  }

  func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    Self.active = nil
    picker.dismiss(animated: true)
    if results.isEmpty {
      promise.reject(ImportSourcesException("cancelled", "user dismissed the picker"))
      return
    }
    // assetIdentifier is always present: the configuration binds the shared
    // photo library.
    let ids = results.compactMap(\.assetIdentifier)
    let promise = promise
    DispatchQueue.global(qos: .userInitiated).async {
      promise.resolve(PickedMediaMapper.entries(pickedIds: ids, metaById: Self.metadata(for: ids)))
    }
  }

  /// Metadata only, never bytes: capture time and filename from the original
  /// capture, MIME type from the resource an import will read. Those two come
  /// from different resources on purpose, so an edited raw keeps the name
  /// `IMG_1234.CR3` while typing as the JPEG its render is. Sizes are absent;
  /// staging batches them through getSizes.
  static func metadata(for ids: [String]) -> [String: [String: Any]] {
    var out: [String: [String: Any]] = [:]
    let fetch = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
    fetch.enumerateObjects { asset, _, _ in
      var meta: [String: Any] = ["mediaAssetId": asset.localIdentifier, "accessible": true]
      if let selection = try? AssetCopier.inspect(asset) {
        meta["name"] = selection.original.originalFilename
        if let mime = AssetCopier.mime(of: selection.resource) {
          meta["mimeType"] = mime
        }
      }
      if let created = asset.creationDate {
        meta["lastModified"] = Int(created.timeIntervalSince1970 * 1000)
      }
      out[asset.localIdentifier] = meta
    }
    return out
  }
}

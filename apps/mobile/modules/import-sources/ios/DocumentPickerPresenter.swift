import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers

/// Open-in-place document picking, the reason this module owns a picker at
/// all: expo-document-picker hardcodes `asCopy: true`, which copies every
/// picked file into purgeable tmp before JS ever runs, defeating deferred
/// copying and making bookmarks worthless. `asCopy: false` returns the
/// user's original security-scoped URLs; bytes move only when the scanner
/// copies.
final class DocumentPickerPresenter: NSObject, UIDocumentPickerDelegate {
  private static var active: DocumentPickerPresenter?

  private let promise: Promise

  private init(promise: Promise) {
    self.promise = promise
  }

  static func present(from viewController: UIViewController, promise: Promise) {
    guard active == nil else {
      promise.reject(ImportSourcesException("io-error", "a pick is already in progress"))
      return
    }
    let presenter = DocumentPickerPresenter(promise: promise)
    active = presenter

    let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: false)
    picker.allowsMultipleSelection = true
    picker.delegate = presenter
    viewController.present(picker, animated: true)
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    Self.active = nil
    // Metadata only, under a momentary scope; never read file bodies here
    // (a 30k pick must return without moving bytes).
    let files: [[String: Any]] = urls.map { url in
      let opened = url.startAccessingSecurityScopedResource()
      defer {
        if opened { url.stopAccessingSecurityScopedResource() }
      }
      var file: [String: Any] = [
        "uri": url.absoluteString,
        "name": url.lastPathComponent,
      ]
      if let values = try? url.resourceValues(forKeys: [
        .fileSizeKey, .contentTypeKey, .contentModificationDateKey,
      ]) {
        if let size = values.fileSize { file["size"] = size }
        if let mime = values.contentType?.preferredMIMEType { file["mimeType"] = mime }
        if let modified = values.contentModificationDate {
          file["lastModified"] = Int(modified.timeIntervalSince1970 * 1000)
        }
      }
      return file
    }
    promise.resolve(files)
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    Self.active = nil
    promise.reject(ImportSourcesException("cancelled", "user dismissed the picker"))
  }
}

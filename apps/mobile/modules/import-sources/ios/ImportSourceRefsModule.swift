import ExpoModulesCore
import Foundation

/// Durable source refs: security-scoped bookmarks, scope bookkeeping, folder
/// enumeration, a copy that also hashes, and the open-in-place picker. Thin
/// bindings over the host-testable units; every failure crosses the bridge
/// with a registry `code`.
public class ImportSourceRefsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ImportSourceRefs")

    // One native call for the whole batch; a per-uri failure lands as
    // {code} in that slot and never rejects the batch.
    AsyncFunction("createFileBookmarks") { (uris: [String]) -> [[String: String]] in
      uris.map { uri in
        do {
          let url = try SourceRefCodec.fileURL(fromPercentEncoded: uri)
          return ["ref": try BookmarkEngine.create(url: url)]
        } catch let error as CodedError {
          return ["code": error.code]
        } catch {
          return ["code": "io-error"]
        }
      }
    }

    AsyncFunction("createDirBookmark") { (uri: String) -> String in
      try rethrowCoded {
        let url = try SourceRefCodec.fileURL(fromPercentEncoded: uri)
        return try BookmarkEngine.create(url: url)
      }
    }

    AsyncFunction("startAccess") { (ref: String) -> [String: Any] in
      try rethrowCoded {
        let resolved = try BookmarkEngine.resolve(ref: ref)
        ScopeRegistry.shared.open(key: ref) {
          resolved.url.startAccessingSecurityScopedResource()
        }
        return ["uri": resolved.url.absoluteString, "stale": resolved.stale]
      }
    }

    AsyncFunction("startAccessChild") { (dirRef: String, key: String) -> [String: Any] in
      try rethrowCoded {
        // The dir scope re-opens lazily; the registry dies with the process.
        let dir = try BookmarkEngine.resolve(ref: dirRef)
        ScopeRegistry.shared.open(key: dirRef) {
          dir.url.startAccessingSecurityScopedResource()
        }
        let child = BookmarkEngine.childURL(dir: dir.url, key: key)
        guard FileManager.default.fileExists(atPath: child.path) else {
          throw CodedError("deleted", "child missing: \(key)")
        }
        return ["uri": child.absoluteString]
      }
    }

    AsyncFunction("stopAccess") { (ref: String) in
      guard let resolved = try? BookmarkEngine.resolve(ref: ref) else {
        return
      }
      ScopeRegistry.shared.close(key: ref) {
        resolved.url.stopAccessingSecurityScopedResource()
      }
    }

    AsyncFunction("stopAccessDir") { (dirRef: String) in
      guard let resolved = try? BookmarkEngine.resolve(ref: dirRef) else {
        return
      }
      ScopeRegistry.shared.close(key: dirRef) {
        resolved.url.stopAccessingSecurityScopedResource()
      }
    }

    AsyncFunction("enumerateDir") { (dirRef: String) -> [[String: Any]] in
      try rethrowCoded {
        let dir = try BookmarkEngine.resolve(ref: dirRef)
        ScopeRegistry.shared.open(key: dirRef) {
          dir.url.startAccessingSecurityScopedResource()
        }
        let urls = try FileManager.default.contentsOfDirectory(
          at: dir.url, includingPropertiesForKeys: [.fileSizeKey, .contentTypeKey],
          options: [.skipsHiddenFiles])
        // Snapshot semantics: entries added after this call are absent until
        // the next enumeration.
        return urls.compactMap { url in
          guard let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentTypeKey]),
            values.isDirectory != true
          else { return nil }
          return [
            "name": url.lastPathComponent,
            "key": url.lastPathComponent,
            "size": values.fileSize ?? 0,
            "type": values.contentType?.preferredMIMEType ?? "",
          ]
        }
      }
    }

    AsyncFunction("copyToPath") { (srcUri: String, destPath: String, copyId: String?) -> [String: Any] in
      try rethrowCoded {
        if let copyId { CopyRegistry.shared.register(copyId) }
        defer {
          if let copyId { CopyRegistry.shared.finish(copyId) }
        }
        let result = try StreamCopier.copy(
          sourcePath: SourceRefCodec.path(fromFileUriOrPath: srcUri),
          destPath: SourceRefCodec.path(fromFileUriOrPath: destPath),
          copyId: copyId)
        var payload: [String: Any] = ["size": result.size, "sha256": result.sha256Hex]
        if let mime = result.mime { payload["mime"] = mime }
        return payload
      }
    }

    AsyncFunction("releaseGrant") { (_: String) in
      // iOS has no grant table; the durable state is the bookmark blob.
    }

    AsyncFunction("grantBudgetRemaining") { () -> Int in
      GrantBudget.iosRemaining
    }

    AsyncFunction("pickFiles") { (promise: Promise) in
      DispatchQueue.main.async { [weak self] in
        guard let viewController = self?.appContext?.utilities?.currentViewController() else {
          promise.reject(ImportSourcesException("io-error", "no view controller to present from"))
          return
        }
        DocumentPickerPresenter.present(from: viewController, promise: promise)
      }
    }
  }
}

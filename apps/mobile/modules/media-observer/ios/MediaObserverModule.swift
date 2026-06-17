import ExpoModulesCore
import Photos

// The photo library's insertion cursor, via PhotoKit change history.
//
// `changesSince` returns the local identifiers inserted since a persisted token,
// so additions made while the app was not running are still reported. A metadata
// bump on an existing photo is an update, not an insert, so it is not reported.
// The app targets iOS 16, where change history is always available.
public class MediaObserverModule: Module {
  private static let version = "v1"
  private static let maxInserts = 10_000

  public func definition() -> ModuleDefinition {
    Name("MediaObserver")

    AsyncFunction("currentCursor") { () -> String in
      Self.encode(PHPhotoLibrary.shared().currentChangeToken)
    }

    AsyncFunction("changesSince") { (cursor: String?) -> [String: Any] in
      self.changesSince(cursor)
    }
  }

  private func changesSince(_ cursor: String?) -> [String: Any] {
    guard let cursor, let token = Self.decode(cursor) else { return anchor() }

    let changes: PHPersistentChangeFetchResult
    do {
      changes = try PHPhotoLibrary.shared().fetchPersistentChanges(since: token)
    } catch {
      // Expired/invalid token: re-anchor and let the archive sync cover the gap.
      return anchor()
    }

    var inserted: [String] = []
    var last = token
    for change in changes {
      let details: PHPersistentObjectChangeDetails?
      do {
        details = try change.changeDetails(for: .asset)
      } catch {
        // History pruned mid-walk — a partial delta can't be trusted.
        return anchor()
      }
      if let details {
        inserted.append(contentsOf: details.insertedLocalIdentifiers)
      }
      last = change.changeToken
      if inserted.count > Self.maxInserts { return anchor() }
    }
    return ["inserted": Self.dedupe(inserted), "cursor": Self.encode(last)]
  }

  private func anchor() -> [String: Any] {
    ["inserted": [String](), "cursor": Self.encode(PHPhotoLibrary.shared().currentChangeToken)]
  }

  private static func dedupe(_ ids: [String]) -> [String] {
    var seen = Set<String>()
    return ids.filter { seen.insert($0).inserted }
  }

  // PHPersistentChangeToken conforms to NSSecureCoding; archive it to base64
  // behind a version prefix so JS can treat the cursor as opaque and persist it.
  // A nil or unarchivable token yields an empty cursor, which re-anchors next read.
  private static func encode(_ token: PHPersistentChangeToken?) -> String {
    guard let token,
      let data = try? NSKeyedArchiver.archivedData(withRootObject: token, requiringSecureCoding: true)
    else { return version + ":" }
    return version + ":" + data.base64EncodedString()
  }

  private static func decode(_ cursor: String) -> PHPersistentChangeToken? {
    let parts = cursor.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
    guard parts.count == 2, parts[0] == version, !parts[1].isEmpty,
      let data = Data(base64Encoded: String(parts[1]))
    else { return nil }
    return try? NSKeyedUnarchiver.unarchivedObject(ofClass: PHPersistentChangeToken.self, from: data)
  }
}

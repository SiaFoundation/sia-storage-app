import Foundation

/// Bookmark creation and resolution with injectable scope open/stop so the
/// flow is host-testable on regular tmp files (host bookmarks approximate
/// iOS scope semantics; the simulator suite is the fidelity gate).
public enum BookmarkEngine {
  public struct Resolved {
    public let url: URL
    /// The bookmark resolved but points at moved/changed state, a signal
    /// only. Refreshing the ref is the JS side's job: while the scope is
    /// open it creates a fresh bookmark and saves it via updateSourceRef,
    /// where the save only lands if the row's claim token still matches.
    /// Native never refreshes a ref silently.
    public let stale: Bool
  }

  /// Create a durable ref. The creation-time scope is balanced within this
  /// call: `defer` stops it only if it actually opened (a non-scoped URL,
  /// e.g. a tmp-Inbox picker copy, returns false from start and must never
  /// get an unbalanced stop).
  public static func create(
    url: URL,
    startAccess: (URL) -> Bool = { $0.startAccessingSecurityScopedResource() },
    stopAccess: (URL) -> Void = { $0.stopAccessingSecurityScopedResource() }
  ) throws -> String {
    let opened = startAccess(url)
    defer {
      if opened { stopAccess(url) }
    }
    do {
      // .withSecurityScope is macOS-only; iOS document bookmarks use empty
      // options and are implicitly scoped when the URL itself is.
      let data = try url.bookmarkData(options: [])
      return SourceRefCodec.encodeBookmark(data)
    } catch {
      throw CodedError("not-persistable", (error as NSError).localizedDescription)
    }
  }

  public static func resolve(ref: String) throws -> Resolved {
    let data = try SourceRefCodec.decodeBookmark(ref)
    var stale = false
    do {
      let url = try URL(
        resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
      return Resolved(url: url, stale: stale)
    } catch {
      throw CodedError("deleted", (error as NSError).localizedDescription)
    }
  }

  public static func childURL(dir: URL, key: String) -> URL {
    dir.appendingPathComponent(key)
  }
}

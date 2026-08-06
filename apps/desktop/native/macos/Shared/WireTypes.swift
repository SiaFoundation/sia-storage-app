// The shapes the daemon returns, mirrored for Swift.
//
// Field names match the wire exactly; a rename on either side is a breaking
// change the version handshake is there to catch.

import Foundation

public struct ProviderItem: Decodable, Equatable {
    public let id: String
    /// nil for an entry directly under the mount root.
    public let parentId: String?
    public let name: String
    /// "file" or "dir". A String rather than an enum so an unknown kind from a
    /// newer daemon decodes instead of failing the whole response.
    public let kind: String
    /// Always 0 for a directory.
    public let size: Int64
    /// Milliseconds since the epoch, not seconds. Divide before making a Date.
    public let createdAt: Double
    /// Milliseconds since the epoch, not seconds. Divide before making a Date.
    public let modifiedAt: Double
    /// Changes when and only when the bytes change. A fixed value makes the OS
    /// serve a stale copy forever.
    public let contentVersion: String
    /// Changes when and only when some other field changes.
    public let metadataVersion: String
    /// An indexer object exists for this file.
    public let uploaded: Bool
    public let uploading: Bool
    /// The bytes are present in managed storage.
    public let downloaded: Bool
    public let downloading: Bool
    /// 0..1, meaningful only while uploading or downloading.
    public let progress: Double

    public var isDirectory: Bool { kind == "dir" }
}

public struct ProviderPage: Decodable {
    public let items: [ProviderItem]
    public let cursor: String?
}

public struct ProviderChanges: Decodable {
    public let items: [ProviderItem]
    public let deletedIds: [String]
    public let anchor: String
    /// More is waiting past `anchor`, so the caller should come straight back
    /// rather than wait to be told about it again.
    public let hasMore: Bool
    /// The anchor is too old to answer from: list the folder again instead.
    public let expired: Bool
}

public struct ProviderProgress: Decodable {
    public let received: Int64
    public let total: Int64?
}

public struct ProviderFetchResult: Decodable {
    public let bytes: Int64
    public let item: ProviderItem
}

public struct ProviderHello: Decodable {
    public let version: String
}

/// The scope spanning every folder. Only this one can report a file leaving one
/// folder for another, because that change belongs to neither folder's contents.
public enum Container {
    public static let workingSet = "workingset"
}

/// Channel names, kept in one place so a typo is a compile error rather than a
/// runtime "unknown method".
public enum Channel {
    public static let hello = "hello"
    public static let subscribe = "subscribe"
    public static let item = "ds:provider:item"
    public static let list = "ds:provider:list"
    public static let changes = "ds:provider:changes"
    public static let fetch = "ds:provider:fetch"
    public static let progress = "ds:provider:progress"
    public static let create = "ds:provider:create"
    public static let write = "ds:provider:write"
    public static let rename = "ds:provider:rename"
    public static let trash = "ds:provider:trash"
}

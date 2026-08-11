// One library entry as NSFileProvider sees it.

import FileProvider
import Foundation
import SiaShared
import UniformTypeIdentifiers

public final class SiaItem: NSObject, NSFileProviderItem {
    /// The root has no row behind it. Modelling that as a case rather than a nil
    /// alongside a flag keeps the two from ever disagreeing.
    private enum Subject {
        case root
        case entry(ProviderItem)
    }

    private let subject: Subject

    public init(_ item: ProviderItem) {
        self.subject = .entry(item)
    }

    /// The mount root, which has no row behind it.
    public static let root = SiaItem()

    private override init() {
        self.subject = .root
        super.init()
    }

    private var item: ProviderItem? {
        if case .entry(let item) = subject { return item }
        return nil
    }

    public var itemIdentifier: NSFileProviderItemIdentifier {
        guard let item else { return .rootContainer }
        return NSFileProviderItemIdentifier(item.id)
    }

    public var parentItemIdentifier: NSFileProviderItemIdentifier {
        guard let parent = item?.parentId else { return .rootContainer }
        return NSFileProviderItemIdentifier(parent)
    }

    public var filename: String { item?.name ?? "Sia" }

    public var contentType: UTType {
        guard let item, !item.isDirectory else { return .folder }
        return UTType(filenameExtension: (item.name as NSString).pathExtension) ?? .data
    }

    public var documentSize: NSNumber? {
        guard let item, !item.isDirectory else { return nil }
        return NSNumber(value: item.size)
    }

    public var creationDate: Date? {
        guard let item else { return nil }
        return Date(timeIntervalSince1970: item.createdAt / 1000)
    }

    public var contentModificationDate: Date? {
        guard let item else { return nil }
        return Date(timeIntervalSince1970: item.modifiedAt / 1000)
    }

    /// Both components must be non-empty: fileproviderd asserts on a missing one
    /// and restarts the extension, which reads as a crash loop with no cause.
    public var itemVersion: NSFileProviderItemVersion {
        guard let item else {
            let seed = Data("root".utf8)
            return NSFileProviderItemVersion(contentVersion: seed, metadataVersion: seed)
        }
        // Falls back rather than trusting the daemon: an empty component trips
        // the assertion described above, and the id is always present.
        let content = item.contentVersion.isEmpty ? item.id : item.contentVersion
        let metadata = item.metadataVersion.isEmpty ? item.id : item.metadataVersion
        return NSFileProviderItemVersion(
            contentVersion: Data(content.utf8), metadataVersion: Data(metadata.utf8))
    }

    public var capabilities: NSFileProviderItemCapabilities {
        guard let item else { return [.allowsAddingSubItems, .allowsContentEnumerating] }
        if item.isDirectory {
            return [
                .allowsAddingSubItems, .allowsContentEnumerating, .allowsRenaming,
                .allowsReparenting, .allowsDeleting,
            ]
        }
        return [.allowsReading, .allowsWriting, .allowsRenaming, .allowsReparenting, .allowsDeleting]
    }

    fileprivate var transfer: ProviderItem? { item }
}

// The four flags Finder composes its cloud badge from. They sit in an extension
// because declaring them on the class body makes the compiler read them as
// near-misses for the protocol's optional requirements; the Objective-C runtime
// resolves them by selector either way. A folder reports fully present, so it
// never carries a badge.
extension SiaItem {
    public var isUploaded: NSNumber? { NSNumber(value: transfer?.uploaded ?? true) }
    public var isUploading: NSNumber? { NSNumber(value: transfer?.uploading ?? false) }
    public var isDownloaded: NSNumber? { NSNumber(value: transfer?.downloaded ?? true) }
    public var isDownloading: NSNumber? { NSNumber(value: transfer?.downloading ?? false) }
}

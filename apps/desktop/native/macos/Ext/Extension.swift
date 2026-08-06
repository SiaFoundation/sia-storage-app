// The File Provider extension: a translation from OS callbacks to RPCs, and
// nothing else.
//
// fileproviderd loads this class by name through NSClassFromString, so @objc
// fixes the Objective-C runtime name rather than leaving it to Swift's mangling,
// and that name must match NSExtensionPrincipalClass in Info.plist.

import FileProvider
import Foundation
import OSLog
import SiaShared

// fileproviderd runs the extension out of reach of a terminal, so os_log is the
// only way to see what it did. Read it with:
//   log show --predicate 'subsystem == "sia.storage.fileprovider"' --last 5m
let fpLog = Logger(subsystem: "sia.storage.fileprovider", category: "extension")

extension Logger {
    /// The one way to log a failure. The event is a `StaticString`, so it can
    /// only ever be a literal, which is why marking it public is safe. The
    /// reason is left at the default, which redacts it off-device: errors
    /// reaching here carry the daemon's text, and that quotes container paths,
    /// which hold the account name.
    func failure(_ event: StaticString, _ error: Error) {
        self.error("\(event, privacy: .public): \(error.localizedDescription)")
    }

    /// The same, for a failure that names the item it happened to. Provider
    /// identifiers are opaque row ids with no path in them.
    func failure(_ event: StaticString, _ id: String, _ error: Error) {
        self.error(
            "\(event, privacy: .public) \(id, privacy: .public): \(error.localizedDescription)")
    }
}

@objc(FileProviderExtension)
public final class FileProviderExtension: NSObject, NSFileProviderReplicatedExtension {
    private let rpc: Rpc
    private let domain: NSFileProviderDomain
    private let handshake: Handshake

    public required init(domain: NSFileProviderDomain) {
        self.domain = domain
        let rpc = Rpc(socketPath: SiaPaths.providerSocketFromExtension())
        // Stamped into Info.plist at build time from the daemon's own version,
        // so the two cannot drift apart within a build.
        let version =
            (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "unknown"
        self.rpc = rpc
        self.handshake = Handshake {
            try await rpc.callDecoding(ProviderHello.self, Channel.hello, [version]).version
        }
        super.init()

        // Not .public: the socket sits in this extension's container, and a
        // container path holds the account name.
        fpLog.info("init socket=\(SiaPaths.providerSocketFromExtension())")
    }

    public func invalidate() {}

    /// Every callback that reaches the daemon waits on this. The OS keeps an
    /// extension alive across app upgrades, so a stale one would otherwise drive
    /// a surface it was not built against.
    private func ready() async throws {
        try await handshake.ready()
    }

    // MARK: - reads

    public func item(
        for identifier: NSFileProviderItemIdentifier, request _: NSFileProviderRequest,
        completionHandler: @escaping (NSFileProviderItem?, Error?) -> Void
    ) -> Progress {
        if identifier == .rootContainer {
            completionHandler(SiaItem.root, nil)
            return Progress()
        }
        Task {
            do {
                try await ready()
                let item = try await rpc.callDecodingOptional(
                    ProviderItem.self, Channel.item, [identifier.rawValue])
                guard let item else {
                    completionHandler(nil, fpError(.noSuchItem, "This item is no longer in Sia Storage."))
                    return
                }
                completionHandler(SiaItem(item), nil)
            } catch {
                completionHandler(nil, mapError(error))
            }
        }
        return Progress()
    }

    public func enumerator(
        for containerItemIdentifier: NSFileProviderItemIdentifier, request _: NSFileProviderRequest
    ) throws -> NSFileProviderEnumerator {
        // The working set is its own scope rather than an alias for the root:
        // it is the only one whose change feed spans folders, which is what
        // makes a file moving between two of them visible to the OS.
        let gate = { [handshake] in try await handshake.ready() }
        if containerItemIdentifier == .workingSet {
            return SiaEnumerator(rpc: rpc, containerId: Container.workingSet, ready: gate)
        }
        let container =
            containerItemIdentifier == .rootContainer ? nil : containerItemIdentifier.rawValue
        return SiaEnumerator(rpc: rpc, containerId: container, ready: gate)
    }

    // MARK: - writes

    // The protocol requires all four whether or not they do anything, so a
    // read-only mount has to refuse them rather than leave them out.

    public func fetchContents(
        for _: NSFileProviderItemIdentifier, version _: NSFileProviderItemVersion?,
        request _: NSFileProviderRequest,
        completionHandler: @escaping (URL?, NSFileProviderItem?, Error?) -> Void
    ) -> Progress {
        completionHandler(nil, nil, Self.readOnly)
        return Progress()
    }

    public func createItem(
        basedOn _: NSFileProviderItem, fields _: NSFileProviderItemFields,
        contents _: URL?, options _: NSFileProviderCreateItemOptions = [],
        request _: NSFileProviderRequest,
        completionHandler: @escaping (
            NSFileProviderItem?, NSFileProviderItemFields, Bool, Error?
        ) -> Void
    ) -> Progress {
        completionHandler(nil, [], false, Self.readOnly)
        return Progress()
    }

    public func modifyItem(
        _: NSFileProviderItem, baseVersion _: NSFileProviderItemVersion,
        changedFields _: NSFileProviderItemFields, contents _: URL?,
        options _: NSFileProviderModifyItemOptions = [], request _: NSFileProviderRequest,
        completionHandler: @escaping (
            NSFileProviderItem?, NSFileProviderItemFields, Bool, Error?
        ) -> Void
    ) -> Progress {
        completionHandler(nil, [], false, Self.readOnly)
        return Progress()
    }

    public func deleteItem(
        identifier _: NSFileProviderItemIdentifier, baseVersion _: NSFileProviderItemVersion,
        options _: NSFileProviderDeleteItemOptions = [], request _: NSFileProviderRequest,
        completionHandler: @escaping (Error?) -> Void
    ) -> Progress {
        completionHandler(Self.readOnly)
        return Progress()
    }

    static let readOnly = NSError(
        domain: NSCocoaErrorDomain, code: NSFeatureUnsupportedError,
        userInfo: [NSLocalizedDescriptionKey: "The Sia folder is read-only for now"])
}

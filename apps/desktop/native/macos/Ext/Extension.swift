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
    private let handoff: Handoff
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
        self.handoff = Handoff()
        self.handshake = Handshake {
            try await rpc.callDecoding(ProviderHello.self, Channel.hello, [version]).version
        }
        super.init()

        // Not .public: the socket sits in this extension's container, and a
        // container path holds the account name.
        fpLog.info("init socket=\(SiaPaths.providerSocketFromExtension())")
        // Off the caller's thread: fileproviderd constructs the extension on a
        // thread it is waiting on, and both of these walk the filesystem.
        let handoff = self.handoff
        DispatchQueue.global(qos: .utility).async {
            do {
                try handoff.prepare()
            } catch {
                fpLog.failure("handoff unavailable", error)
            }
            handoff.sweep()
        }
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
        // Its own scope, not an alias for the root: only its change feed spans
        // folders, which is what makes a file moving between two of them visible.
        let gate = { [handshake] in try await handshake.ready() }
        if containerItemIdentifier == .workingSet {
            return SiaEnumerator(rpc: rpc, containerId: Container.workingSet, ready: gate)
        }
        let container =
            containerItemIdentifier == .rootContainer ? nil : containerItemIdentifier.rawValue
        return SiaEnumerator(rpc: rpc, containerId: container, ready: gate)
    }

    // MARK: - bytes

    public func fetchContents(
        for identifier: NSFileProviderItemIdentifier, version _: NSFileProviderItemVersion?,
        request _: NSFileProviderRequest,
        completionHandler: @escaping (URL?, NSFileProviderItem?, Error?) -> Void
    ) -> Progress {
        // Progress without cancellation: `app.provider.fetch` takes no signal, so
        // cancelling in Finder stops the bar and not the download.
        let progress = Progress(totalUnitCount: 100)
        Task {
            let destination = handoff.fetchDestination()
            fpLog.info("fetch \(identifier.rawValue, privacy: .public)")
            let poller = ProgressPoller(rpc: rpc, id: identifier.rawValue, progress: progress)
            defer { poller.stop() }
            do {
                // Started past the gate: the poller's calls are not gated, so
                // polling early would reach a daemon this extension just refused.
                try await ready()
                poller.start()
                let result = try await rpc.callDecoding(
                    ProviderFetchResult.self, Channel.fetch, [identifier.rawValue, destination])
                progress.completedUnitCount = 100
                fpLog.info("fetch ok \(result.bytes, privacy: .public) bytes")
                completionHandler(
                    URL(fileURLWithPath: destination), SiaItem(result.item), nil)
            } catch {
                fpLog.failure("fetch failed", error)
                try? FileManager.default.removeItem(atPath: destination)
                completionHandler(nil, nil, mapError(error))
            }
        }
        return progress
    }

    // MARK: - writes

    public func createItem(
        basedOn itemTemplate: NSFileProviderItem, fields _: NSFileProviderItemFields,
        contents: URL?, options _: NSFileProviderCreateItemOptions = [],
        request _: NSFileProviderRequest,
        completionHandler: @escaping (
            NSFileProviderItem?, NSFileProviderItemFields, Bool, Error?
        ) -> Void
    ) -> Progress {
        Task {
            // Cleared once the daemon has taken the file; until then a failure
            // has to put it back.
            var staged: String?
            do {
                try await ready()
                let parent = Self.containerArg(itemTemplate.parentItemIdentifier)
                let isFolder = itemTemplate.contentType == .folder
                var args: [Any] = [parent, itemTemplate.filename, isFolder ? "dir" : "file"]
                if !isFolder {
                    guard let contents else {
                        completionHandler(
                            nil, [], false, fpError(.cannotSynchronize, "No contents to create"))
                        return
                    }
                    let path = try handoff.stage(contents)
                    staged = path
                    args.append(path)
                }
                // The name stays private: os_log redacts by default and this is
                // the user's data, unlike the ids either side of it.
                fpLog.info("create \(itemTemplate.filename) kind=\(isFolder ? "dir" : "file", privacy: .public)")
                let created = try await rpc.callDecoding(
                    ProviderItem.self, Channel.create, args)
                staged = nil
                fpLog.info("create ok \(created.id, privacy: .public)")
                completionHandler(SiaItem(created), [], false, nil)
            } catch {
                if let staged { handoff.discard(staged) }
                fpLog.failure("create failed", error)
                completionHandler(nil, [], false, mapError(error))
            }
        }
        return Progress()
    }

    public func modifyItem(
        _ item: NSFileProviderItem, baseVersion _: NSFileProviderItemVersion,
        changedFields: NSFileProviderItemFields, contents: URL?,
        options _: NSFileProviderModifyItemOptions = [], request _: NSFileProviderRequest,
        completionHandler: @escaping (
            NSFileProviderItem?, NSFileProviderItemFields, Bool, Error?
        ) -> Void
    ) -> Progress {
        Task {
            var staged: String?
            do {
                try await ready()
                var latest: ProviderItem?

                fpLog.info(
                    "modify \(item.itemIdentifier.rawValue, privacy: .public) fields=\(changedFields.rawValue, privacy: .public)"
                )
                if changedFields.contains(.contents) {
                    // Refused rather than skipped: falling through would report
                    // the edit as saved with the bytes still only in Finder.
                    guard let contents else {
                        throw HandoffError.io("the system offered no bytes to save")
                    }
                    let path = try handoff.stage(contents)
                    staged = path
                    latest = try await rpc.callDecoding(
                        ProviderItem.self, Channel.write,
                        [item.itemIdentifier.rawValue, path])
                    staged = nil
                }
                if changedFields.contains(.filename) || changedFields.contains(.parentItemIdentifier)
                {
                    latest = try await rpc.callDecoding(
                        ProviderItem.self, Channel.rename,
                        [
                            item.itemIdentifier.rawValue,
                            Self.containerArg(item.parentItemIdentifier), item.filename,
                        ])
                }
                if latest == nil {
                    latest = try await rpc.callDecodingOptional(
                        ProviderItem.self, Channel.item, [item.itemIdentifier.rawValue])
                }
                guard let latest else {
                    completionHandler(nil, [], false, fpError(.noSuchItem, "Item vanished"))
                    return
                }
                fpLog.info("modify ok \(latest.id, privacy: .public)")
                completionHandler(SiaItem(latest), [], false, nil)
            } catch {
                if let staged { handoff.discard(staged) }
                fpLog.failure("modify failed", error)
                completionHandler(nil, [], false, mapError(error))
            }
        }
        return Progress()
    }

    public func deleteItem(
        identifier: NSFileProviderItemIdentifier, baseVersion _: NSFileProviderItemVersion,
        options _: NSFileProviderDeleteItemOptions = [], request _: NSFileProviderRequest,
        completionHandler: @escaping (Error?) -> Void
    ) -> Progress {
        Task {
            do {
                try await ready()
                _ = try await rpc.call(Channel.trash, [identifier.rawValue])
                fpLog.info("trashed \(identifier.rawValue, privacy: .public)")
                completionHandler(nil)
            } catch {
                fpLog.failure("trash failed", error)
                completionHandler(mapError(error))
            }
        }
        return Progress()
    }

    /// The mount root has no row, so it is passed as null rather than by id.
    static func containerArg(_ identifier: NSFileProviderItemIdentifier) -> Any {
        identifier == .rootContainer ? NSNull() : identifier.rawValue
    }
}

/// Drives the Finder download bar while a fetch is in flight.
///
/// The daemon reports progress through a separate call rather than pushing it
/// down the change stream, which carries a scope and no payload, and is shared
/// by every fetch in flight.
final class ProgressPoller: @unchecked Sendable {
    private let rpc: Rpc
    private let id: String
    private let progress: Progress
    private let lock = NSLock()
    private var timer: DispatchSourceTimer?
    private var polling = false

    init(rpc: Rpc, id: String, progress: Progress) {
        self.rpc = rpc
        self.id = id
        self.progress = progress
    }

    func start() {
        let timer = DispatchSource.makeTimerSource(queue: .global(qos: .utility))
        timer.schedule(deadline: .now() + .milliseconds(250), repeating: .milliseconds(250))
        timer.setEventHandler { [weak self] in
            guard let self, self.claim() else { return }
            Task {
                defer { self.release() }
                guard
                    let reading = try? await self.rpc.callDecoding(
                        ProviderProgress.self, Channel.progress, [self.id]),
                    let total = reading.total, total > 0
                else { return }
                // Only the fetch itself reports completion. A poll already in
                // flight when it does would otherwise walk the bar backwards.
                guard self.progress.completedUnitCount < 100 else { return }
                self.progress.completedUnitCount = min(99, reading.received * 100 / total)
            }
        }
        timer.resume()
        self.timer = timer
    }

    func stop() {
        timer?.cancel()
        timer = nil
    }

    /// A daemon slower than the tick would otherwise accumulate one open socket
    /// per tick for the length of the fetch.
    private func claim() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if polling { return false }
        polling = true
        return true
    }

    private func release() {
        lock.lock()
        polling = false
        lock.unlock()
    }
}

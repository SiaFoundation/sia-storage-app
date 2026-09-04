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

@objc(FileProviderExtension)
public final class FileProviderExtension: NSObject, NSFileProviderReplicatedExtension {
    private let rpc: Rpc
    private let handoff: Handoff
    private let domain: NSFileProviderDomain
    private let handshake: Handshake
    private let availability = Availability(grace: FileProviderExtension.gracePeriod)
    private var changes: RpcStream?
    /// Set once teardown starts. Stopping the stream reports a disconnect the
    /// same way a dead daemon does, which would otherwise unmount on the way out.
    private var invalidated = false

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

        fpLog.info("init socket=\(SiaPaths.providerSocketFromExtension(), privacy: .public)")
        // Off the caller's thread: fileproviderd constructs the extension on a
        // thread it is waiting on, and both of these walk the filesystem.
        let handoff = self.handoff
        DispatchQueue.global(qos: .utility).async {
            do {
                try handoff.prepare()
            } catch {
                fpLog.error("handoff unavailable: \(error.localizedDescription, privacy: .public)")
            }
            handoff.sweep()
        }
        subscribeToChanges()
    }

    /// Signals the working set when the library changes, reconnecting on drop:
    /// only the provider may signal its own domain, and the OS keeps this
    /// process alive across daemon restarts.
    private func subscribeToChanges() {
        let stream = RpcStream(socketPath: SiaPaths.providerSocketFromExtension()) {
            [weak self] event in
            guard event.scope == "library", let self else { return }
            guard let manager = NSFileProviderManager(for: self.domain) else {
                fpLog.error("self-signal: no manager for this domain")
                return
            }
            manager.signalEnumerator(for: .workingSet) { error in
                if let error {
                    fpLog.error(
                        "self-signal failed: \(error.localizedDescription, privacy: .public)")
                } else {
                    fpLog.info("self-signal ok")
                }
            }
        }
        stream.start(
            onConnected: { [weak self] in
                guard let self else { return }
                Task { await self.apply(self.availability.succeeded()) }
            },
            onDisconnect: { [weak self] error in
                fpLog.error("change stream ended: \(error.localizedDescription, privacy: .public)")
                self?.noteDaemonAway()
                self?.scheduleResubscribe()
            })
        changes = stream
    }

    /// Waits before reconnecting, so a daemon that is down rather than restarting
    /// costs one connect a second instead of a spin.
    private func scheduleResubscribe() {
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 1) { [weak self] in
            guard let self, self.changes != nil else { return }
            self.subscribeToChanges()
        }
    }

    /// Starts the clock on an outage, and comes back when it is up.
    private func noteDaemonAway() {
        Task { [weak self] in
            guard let self, !self.invalidated else { return }
            guard await self.availability.failed(at: Self.now()) else { return }
            try? await Task.sleep(nanoseconds: UInt64(Self.gracePeriod * 1_000_000_000))
            // Checked again: teardown inside the grace window would otherwise
            // still reach the disconnect below.
            guard !self.invalidated else { return }
            await self.apply(self.availability.settle(at: Self.now()))
        }
    }

    /// Tells the system the mount is not being served, or that it is again.
    ///
    /// The user keeps browsing either way; what changes is that a disconnected
    /// domain stops being asked for updates, and Finder says why at the top of
    /// the folder instead of failing one operation at a time.
    private func apply(_ action: AvailabilityAction) async {
        guard action != .none, let manager = NSFileProviderManager(for: domain) else { return }
        do {
            switch action {
            case .disconnect:
                try await manager.disconnect(
                    reason: "Sia Storage isn't running. Open it to reconnect.",
                    options: .temporary)
                fpLog.info("disconnected: the daemon is not answering")
            case .reconnect:
                try await manager.reconnect()
                fpLog.info("reconnected: the daemon is back")
            case .none:
                break
            }
        } catch {
            fpLog.error("availability: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// The wait before `settle` and the actor's threshold are one value, or
    /// `settle` refuses every outage and nothing says why.
    static let gracePeriod: Double = 5
    static func now() -> Double { ProcessInfo.processInfo.systemUptime }

    public func invalidate() {
        // Both set before the stop, which is what fires the handler reading them.
        invalidated = true
        let stream = changes
        changes = nil
        stream?.stop()
    }

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
                    completionHandler(nil, fpError(.noSuchItem, "No item \(identifier.rawValue)"))
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

    // MARK: - bytes

    public func fetchContents(
        for identifier: NSFileProviderItemIdentifier, version _: NSFileProviderItemVersion?,
        request _: NSFileProviderRequest,
        completionHandler: @escaping (URL?, NSFileProviderItem?, Error?) -> Void
    ) -> Progress {
        // Reports progress but does not carry cancellation: `app.provider.fetch`
        // takes no signal, so cancelling in Finder stops the reporting and not
        // the download.
        let progress = Progress(totalUnitCount: 100)
        Task {
            let destination = handoff.fetchDestination()
            fpLog.info("fetch \(identifier.rawValue, privacy: .public)")
            let poller = ProgressPoller(rpc: rpc, id: identifier.rawValue, progress: progress)
            poller.start()
            defer { poller.stop() }
            do {
                try await ready()
                let result = try await rpc.callDecoding(
                    ProviderFetchResult.self, Channel.fetch, [identifier.rawValue, destination])
                progress.completedUnitCount = 100
                fpLog.info("fetch ok \(result.bytes, privacy: .public) bytes")
                completionHandler(
                    URL(fileURLWithPath: destination), SiaItem(result.item), nil)
            } catch {
                fpLog.error("fetch failed: \(error.localizedDescription, privacy: .public)")
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
                fpLog.error("create failed: \(error.localizedDescription, privacy: .public)")
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
                if changedFields.contains(.contents), let contents {
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
                fpLog.error("modify failed: \(error.localizedDescription, privacy: .public)")
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
                fpLog.error("trash failed: \(error.localizedDescription, privacy: .public)")
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

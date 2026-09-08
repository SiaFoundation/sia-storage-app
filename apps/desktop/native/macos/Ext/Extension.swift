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

/// fileproviderd runs the extension out of reach of a terminal, so os_log is
/// the only way to see what it did:
///   log show --predicate 'subsystem == "sia.storage.fileprovider"' --last 5m
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
    private let availability = Availability(grace: FileProviderExtension.gracePeriod)
    /// Guards `changes` and `invalidated`, which the system's teardown thread,
    /// the stream's queue and the resubscribe timer all touch.
    private let lifecycle = NSLock()
    private var changes: RpcStream?
    /// Set once teardown starts, so a reconnect already scheduled gives up
    /// instead of subscribing behind it.
    private var invalidated = false

    public required init(domain: NSFileProviderDomain) {
        self.domain = domain
        let rpc = Rpc(socketPath: SiaPaths.providerSocketFromExtension())
        // This is the daemon's version, not the extension's: the build stamps
        // apps/cli's package version into every bundle's Info.plist.
        let version =
            (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "unknown"
        self.rpc = rpc
        self.handoff = Handoff()
        self.handshake = Handshake {
            try await rpc.callDecoding(ProviderHello.self, Channel.hello, [version])
        }
        super.init()

        // Not .public: the socket sits in this extension's container, and a
        // container path holds the account name.
        fpLog.notice("init socket=\(SiaPaths.providerSocketFromExtension())")
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
        subscribeToChanges()
    }

    /// Tells the system the library moved, so it re-reads the working set.
    ///
    /// That set feeds search and the system's own change tracking. It does not
    /// put folders on disk: the system drops items whose parent it has not
    /// written out, which is what `warm` is for.
    private func signalWorkingSet() {
        guard let manager = NSFileProviderManager(for: domain) else {
            fpLog.error("self-signal: no manager for this domain")
            return
        }
        manager.signalEnumerator(for: .workingSet) { error in
            if let error {
                fpLog.failure("self-signal failed", error)
            } else {
                fpLog.debug("self-signal ok")
            }
        }
    }

    /// Holds the daemon's change stream open, reconnecting on drop, and signals
    /// the working set from it. Only the provider may signal its own domain,
    /// and the OS keeps this process alive across daemon restarts.
    private func subscribeToChanges() {
        let stream = RpcStream(socketPath: SiaPaths.providerSocketFromExtension()) {
            [weak self] event in
            guard event.scope == "library", let self else { return }
            self.signalWorkingSet()
        }
        // Published before it starts: the other order leaves a window where
        // invalidate() finds no stream and the one just started outlives it.
        let adopted = withLifecycle { () -> Bool in
            if invalidated { return false }
            changes = stream
            return true
        }
        guard adopted else { return }
        stream.start(
            onConnected: { [weak self] in
                // Checked inside the task, not before it: teardown can land in
                // the hop and the reconnect would then run against a dead domain.
                Task { [weak self] in
                    guard let self, !self.withLifecycle({ self.invalidated }) else { return }
                    await self.apply(self.availability.succeeded())
                    // A library that never changes is never signalled, so the
                    // system would hear about the working set only on an edit.
                    self.signalWorkingSet()
                }
            },
            onDisconnect: { [weak self] error in
                fpLog.failure("change stream ended", error)
                Task { [weak self] in await self?.handshake.reset() }
                self?.noteDaemonAway()
                self?.scheduleResubscribe()
            })
    }

    /// Waits before reconnecting, so a daemon that is down rather than restarting
    /// costs one connect a second instead of a spin.
    private func scheduleResubscribe() {
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 1) { [weak self] in
            // invalidated rather than a nil changes: the stream is replaced on
            // every normal reconnect, so only the flag distinguishes teardown.
            guard let self, !self.withLifecycle({ self.invalidated }) else { return }
            self.subscribeToChanges()
        }
    }

    /// Starts the clock on an outage, and comes back when it is up.
    private func noteDaemonAway() {
        Task { [weak self] in
            guard let self, !self.withLifecycle({ self.invalidated }) else { return }
            guard await self.availability.failed(at: Self.now()) else { return }
            // Returns on cancellation: a cancelled sleep comes back early, and
            // settling then reports an outage the grace period never timed.
            guard
                (try? await Task.sleep(nanoseconds: UInt64(Self.gracePeriod * 1_000_000_000)))
                    != nil
            else { return }
            // Checked again: teardown inside the grace window would otherwise
            // still reach the disconnect below.
            guard !self.withLifecycle({ self.invalidated }) else { return }
            await self.apply(self.availability.settle(at: Self.now()))
        }
    }

    /// Tells the system the mount is not being served, or that it is again.
    ///
    /// The user keeps browsing either way; what changes is that a disconnected
    /// domain stops being asked for updates, and Finder says why at the top of
    /// the folder instead of failing one operation at a time.
    private func apply(
        _ action: AvailabilityAction,
        reason: String = unreachableMessage
    ) async {
        guard action != .none else { return }
        guard let manager = NSFileProviderManager(for: domain) else {
            // The domain went away underneath us, which is the one case where
            // the banner silently never appears.
            fpLog.error("availability: no manager for this domain")
            return
        }
        do {
            switch action {
            case .disconnect:
                try await manager.disconnect(reason: reason, options: .temporary)
                // Two causes share this path, and the persisted line has to
                // match the banner Finder shows for it.
                fpLog.notice(
                    "disconnected: \(reason == unreachableMessage ? "the daemon is not answering" : "the library changed", privacy: .public)"
                )
            case .reconnect:
                try await manager.reconnect()
                fpLog.notice("reconnected: the daemon is back")
            case .none:
                break
            }
        } catch {
            fpLog.failure("availability", error)
        }
    }

    /// The wait before `settle` and the actor's threshold are one value, or
    /// `settle` refuses every outage and nothing says why.
    static let gracePeriod: Double = 5
    static func now() -> Double { ProcessInfo.processInfo.systemUptime }

    private func withLifecycle<T>(_ body: () -> T) -> T {
        lifecycle.lock()
        defer { lifecycle.unlock() }
        return body()
    }

    public func invalidate() {
        // Both set before the stop, which is what fires the handler reading them.
        let stream = withLifecycle { () -> RpcStream? in
            invalidated = true
            let current = changes
            changes = nil
            return current
        }
        stream?.stop()
    }

    /// Every callback that reaches the daemon waits on this. The OS keeps an
    /// extension alive across app upgrades, so a stale one would otherwise drive
    /// a surface it was not built against.
    private func ready() async throws {
        do {
            try await handshake.ready()
        } catch let error as HandshakeError {
            // A mismatch is permanent, so it says so once at the top of the
            // folder rather than failing every file the user touches.
            if case .incompatible(let why) = error {
                await apply(availability.incompatible(at: Self.now()), reason: why)
            }
            throw error
        }
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
        // Through the wrapper, not the handshake directly: a mismatch found
        // while enumerating must disconnect the domain like any other callback.
        let gate: @Sendable () async throws -> Void = { [weak self] in
            guard let self else { throw HandshakeError.notEstablished }
            try await self.ready()
        }
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
            fpLog.debug("fetch \(identifier.rawValue, privacy: .public)")
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
                fpLog.debug("fetch ok \(result.bytes, privacy: .public) bytes")
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
                fpLog.debug("create \(itemTemplate.filename) kind=\(isFolder ? "dir" : "file", privacy: .public)")
                let created = try await rpc.callDecoding(
                    ProviderItem.self, Channel.create, args)
                staged = nil
                fpLog.debug("create ok \(created.id, privacy: .public)")
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

                fpLog.debug(
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
                fpLog.debug("modify ok \(latest.id, privacy: .public)")
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
                fpLog.debug("trashed \(identifier.rawValue, privacy: .public)")
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

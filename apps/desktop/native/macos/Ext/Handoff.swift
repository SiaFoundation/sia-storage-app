// Moving file bytes between the extension and the daemon by path.
//
// Nothing here reads or writes file contents. The kernel hands the extension a
// URL on the way up and expects one back on the way down; both are relocated
// into the shared handoff directory by reference wherever the filesystem allows
// it, so a large file costs no copy and no memory on either side.

import Foundation
import SiaShared

public enum HandoffError: Error, Equatable, LocalizedError {
    case unavailable(String)
    case io(String)

    // Without this the text is Swift's default, which names the enum case and
    // tells the user nothing about what failed.
    public var errorDescription: String? {
        switch self {
        case .unavailable(let m), .io(let m): return m
        }
    }
}

public struct Handoff {
    private let root: String

    public init(root: String = SiaPaths.handoffDirFromExtension()) {
        self.root = root
    }

    public func prepare() throws {
        for sub in [SiaPaths.fetchSubdir, SiaPaths.stageSubdir] {
            SiaPaths.ensureDirectory("\(root)/\(sub)")
        }
        guard FileManager.default.isWritableFile(atPath: root) else {
            throw HandoffError.unavailable("handoff directory is not writable: \(root)")
        }
    }

    /// A fresh path for the daemon to write a download into.
    ///
    /// Creates the directory rather than assuming `prepare()` has run: it runs in
    /// the background at launch, and the system can drive a fetch before it
    /// finishes, which would otherwise fail as a missing file.
    public func fetchDestination() -> String {
        let directory = "\(root)/\(SiaPaths.fetchSubdir)"
        SiaPaths.ensureDirectory(directory)
        return "\(directory)/\(UUID().uuidString)"
    }

    /// Places the kernel's copy of an edited file where the daemon can take it.
    ///
    /// link(2) first: it costs nothing and leaves the source intact. rename(2)
    /// next, which is still no byte movement but consumes the source, and that
    /// is fine because the URL the kernel hands over is a throwaway. copyfile(3)
    /// last, for the cross-volume case; it streams rather than buffering.
    public func stage(_ source: URL) throws -> String {
        let directory = "\(root)/\(SiaPaths.stageSubdir)"
        SiaPaths.ensureDirectory(directory)
        let destination = "\(directory)/\(UUID().uuidString)"
        let from = source.path

        if link(from, destination) == 0 { return destination }
        if rename(from, destination) == 0 { return destination }
        do {
            try FileManager.default.copyItem(atPath: from, toPath: destination)
            return destination
        } catch {
            // A copy that failed part way leaves the destination behind, and the
            // sweep would not reach it for ten minutes.
            try? FileManager.default.removeItem(atPath: destination)
            // Neither the path nor the underlying message is included: both name
            // the file, and this text reaches the system log.
            throw HandoffError.io("could not stage the file for upload")
        }
    }

    /// Drops a staged file the daemon never took, which a call failing after
    /// staging would otherwise leave behind. On one volume `stage` made a hard
    /// link, so the bytes survive the kernel dropping its own copy and stay
    /// until something removes this name.
    public func discard(_ path: String) {
        try? FileManager.default.removeItem(atPath: path)
    }

    /// Clears entries nobody claimed. A crash between staging and the daemon
    /// consuming, or between a fetch landing and the OS collecting it, leaves a
    /// file with no owner; without this the container grows without bound.
    public func sweep(olderThan maxAge: TimeInterval = 600) {
        for sub in [SiaPaths.fetchSubdir, SiaPaths.stageSubdir] {
            SiaPaths.sweep(directory: "\(root)/\(sub)", olderThan: maxAge)
        }
    }
}

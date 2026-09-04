// Where the two processes meet on disk.
//
// The extension is sandboxed and the app is not, so the only directory both can
// write is the extension's own container. An App Group looks like the obvious
// choice and is not: a sandboxed File Provider extension can read one but not
// write it, which rules out both the socket's directory and the byte handoff.
//
// Inside the sandbox NSHomeDirectory() already IS the container's Data
// directory, so these build from it directly. Reconstructing the
// ~/Library/Containers/<id>/Data path that the app outside uses produces a
// nested path that does not exist, and every call then fails to reach a socket
// sitting right there.

import Foundation

public enum SiaPaths {
    /// Subdirectory the daemon writes fetched bytes into.
    public static let fetchSubdir = "fetch"
    /// Subdirectory the extension stages bytes into on the way up.
    public static let stageSubdir = "stage"

    /// Only correct when called from inside the extension, which is what the
    /// name says: it builds from the sandbox's own home directory. The app runs
    /// unsandboxed and has to be told this path rather than derive it.
    public static func providerSocketFromExtension() -> String {
        "\(NSHomeDirectory())/provider.sock"
    }

    /// Same rule as the socket above: correct only inside the extension.
    public static func handoffDirFromExtension() -> String {
        "\(NSHomeDirectory())/handoff"
    }

    /// Removes handoff leftovers older than `maxAge`.
    ///
    /// A crash between staging bytes and the daemon consuming them, or between
    /// the daemon writing a fetch and the OS collecting it, leaves a file nobody
    /// owns. Sweeping on launch bounds that rather than letting the container
    /// grow without limit.
    public static func sweep(directory: String, olderThan maxAge: TimeInterval, now: Date = Date()) {
        let fm = FileManager.default
        guard let entries = try? fm.contentsOfDirectory(atPath: directory) else { return }
        for entry in entries {
            let full = "\(directory)/\(entry)"
            guard
                let attrs = try? fm.attributesOfItem(atPath: full),
                let modified = attrs[.modificationDate] as? Date
            else { continue }
            if now.timeIntervalSince(modified) > maxAge {
                try? fm.removeItem(atPath: full)
            }
        }
    }

    /// Best effort. A failure here surfaces at the next write rather than being
    /// reported, because the caller checks the directory is usable afterwards.
    public static func ensureDirectory(_ path: String) {
        try? FileManager.default.createDirectory(
            atPath: path, withIntermediateDirectories: true, attributes: nil)
    }
}

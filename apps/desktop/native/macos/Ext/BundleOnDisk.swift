// Whether the extension's bundle on disk names the daemon version the running
// process was built for.
//
// An app update swaps the whole bundle while fileproviderd may keep the
// previous extension process alive. That process still presents the previous
// daemon version in its handshake, and the updated daemon refuses it, so
// Finder serves errors for as long as the process lives. The extension checks
// the plist on disk when a handshake fails and exits once it has been
// replaced, and fileproviderd launches the new binary on its next call.

import Foundation

enum BundleOnDisk {
    /// True when the Info.plist at `bundleURL` names a daemon version other than
    /// `loaded`. A plist that cannot be read proves nothing, so it reads as the
    /// same build.
    static func replaced(loaded: String, bundleURL: URL) -> Bool {
        let plist = bundleURL.appendingPathComponent("Contents/Info.plist")
        guard let info = NSDictionary(contentsOf: plist),
            let onDisk = info["SiaDaemonVersion"] as? String
        else { return false }
        return onDisk != loaded
    }
}

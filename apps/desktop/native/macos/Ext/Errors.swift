// Turning a daemon error into one fileproviderd will show the user.
//
// The framework honours only NSFileProviderErrorDomain and NSCocoaErrorDomain.
// Anything else is replaced wholesale with "couldn't communicate with helper
// application", which tells the user nothing and hides the real cause, so every
// throw is mapped before it crosses back.

import FileProvider
import Foundation
import SiaShared

/// Shown two ways for one condition: the banner across the top of the folder and
/// the alert on a single item. They have to read the same.
let unreachableMessage = "Sia Storage isn't running. Open it and try again."

public func mapError(_ error: Error) -> NSError {
    let ns = error as NSError
    if ns.domain == NSFileProviderErrorDomain || ns.domain == NSCocoaErrorDomain { return ns }

    // A staging failure is a file error, not a connection one. Without this it
    // falls to the catch-all below and reports the daemon as unreachable.
    if error is HandoffError {
        // Fixed text rather than the error's own: one variant names the
        // container directory, and a container path holds the account name.
        return NSError(
            domain: NSCocoaErrorDomain, code: NSFileWriteUnknownError,
            userInfo: [NSLocalizedDescriptionKey: "Sia Storage could not write this file."])
    }

    if let rpc = error as? RpcError {
        switch rpc {
        case .unreachable:
            // Finder puts this in an alert, so it says what the user can do
            // rather than quoting a syscall at them.
            return fpError(.serverUnreachable, unreachableMessage)
        case .encoding(let message), .decoding(let message):
            // Malformed data on the wire. A read failure rather than a
            // connection one, because retrying the connection will not help.
            return NSError(
                domain: NSCocoaErrorDomain, code: NSFileReadCorruptFileError,
                userInfo: [NSLocalizedDescriptionKey: message])
        case .remote(let message):
            return mapRemoteMessage(message)
        }
    }
    return fpError(.serverUnreachable, ns.localizedDescription)
}

/// Classifies the daemon's error text, which is its own words plus errno text
/// from the filesystem under it. Matching a fragment rather than a sentence
/// means a reworded message downgrades instead of being reported as the wrong
/// thing.
func mapRemoteMessage(_ message: String) -> NSError {
    let lower = message.lowercased()

    if lower.contains("no file with id") || lower.contains("no directory with") {
        // The daemon names the row it looked for, which is an id the user has
        // never seen and cannot act on.
        return fpError(.noSuchItem, "This item is no longer in Sia Storage.")
    }
    if lower.contains("outside") || lower.contains("no handoff directory") {
        // The daemon names the directory it rejected, which is a path the user
        // did not choose and cannot act on.
        return NSError(
            domain: NSCocoaErrorDomain, code: NSFileWriteNoPermissionError,
            userInfo: [NSLocalizedDescriptionKey: "Sia Storage could not write this file."])
    }
    if lower.contains("version mismatch") {
        return fpError(.serverUnreachable, message)
    }
    if lower.contains("download did not produce") {
        return fpError(.serverUnreachable, message)
    }
    if lower.contains("already exists") || lower.contains("collision") {
        return fpError(.filenameCollision, message)
    }
    if lower.contains("no space") || lower.contains("enospc") || lower.contains("quota") {
        return fpError(.insufficientQuota, message)
    }
    return fpError(.cannotSynchronize, message)
}

func fpError(_ code: NSFileProviderError.Code, _ message: String) -> NSError {
    NSError(
        domain: NSFileProviderErrorDomain, code: code.rawValue,
        userInfo: [NSLocalizedDescriptionKey: message])
}

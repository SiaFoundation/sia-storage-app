// Turning a daemon error into one fileproviderd will show the user.
//
// The framework honours only NSFileProviderErrorDomain and NSCocoaErrorDomain.
// Anything else is replaced wholesale with "couldn't communicate with helper
// application", which tells the user nothing and hides the real cause, so every
// throw is mapped before it crosses back.

import FileProvider
import Foundation
import SiaShared

public func mapError(_ error: Error) -> NSError {
    let ns = error as NSError
    if ns.domain == NSFileProviderErrorDomain || ns.domain == NSCocoaErrorDomain { return ns }

    if let rpc = error as? RpcError {
        switch rpc {
        case .unreachable:
            // Finder puts this in an alert, so it says what the user can do
            // rather than quoting a syscall at them. The transport's own text
            // still reaches the log through the catch that called this.
            return fpError(.serverUnreachable, "Sia Storage isn't running. Open it and try again.")
        case .encoding(let message), .decoding(let message):
            // Malformed data on one side of the wire. Reported as a read
            // failure rather than a connection failure, because retrying the
            // connection will not help.
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
        return fpError(.noSuchItem, message)
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

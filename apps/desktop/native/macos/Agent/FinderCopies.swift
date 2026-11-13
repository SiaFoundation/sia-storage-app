// The calls this program makes on single items of the app's Finder domain,
// behind protocols so a test can answer for the system.
//
// `NSFileProviderManager(for:)` finds the provider through the calling
// process's main bundle. From the helper bundle under `Contents/Helpers` that
// is the helper's own, which holds no extension, so every per-domain call
// fails with `providerNotFound`. The app's packaging therefore also installs
// this program bare in `Contents/MacOS`, where the main bundle is the app.

import FileProvider
import Foundation

public protocol FinderCopies {
    /// Throws `AgentError.noSuchDomain` when no domain has that identifier.
    func open(domainId: String) async throws -> FinderDomainCopies
}

public protocol FinderDomainCopies: Sendable {
    /// The system's answer for one item: nil when it was evicted or held no
    /// content. An unknown item answers nil too, or `noSuchItem`.
    func evict(itemId: String) async -> Error?
    /// Asks the system to call the extension's `modifyItem` with the item's
    /// contents. Nil when it took the request. An item whose contents Finder
    /// does not hold answers `NSUbiquitousFileUnavailableError`.
    func resend(itemId: String) async -> Error?
}

/// The real system.
public struct SystemFinderCopies: FinderCopies {
    public init() {}

    public func open(domainId: String) async throws -> FinderDomainCopies {
        let domains = try await NSFileProviderManager.domains()
        guard let domain = domains.first(where: { $0.identifier.rawValue == domainId }),
            let manager = NSFileProviderManager(for: domain)
        else { throw AgentError.noSuchDomain(domainId) }
        return SystemDomainCopies(manager: manager)
    }
}

private struct SystemDomainCopies: FinderDomainCopies, @unchecked Sendable {
    let manager: NSFileProviderManager

    func evict(itemId: String) async -> Error? {
        await withCheckedContinuation { continuation in
            manager.evictItem(identifier: NSFileProviderItemIdentifier(itemId)) {
                continuation.resume(returning: $0)
            }
        }
    }

    func resend(itemId: String) async -> Error? {
        await withCheckedContinuation { continuation in
            manager.requestModification(
                of: .contents, forItemWithIdentifier: NSFileProviderItemIdentifier(itemId),
                options: []
            ) {
                continuation.resume(returning: $0)
            }
        }
    }
}

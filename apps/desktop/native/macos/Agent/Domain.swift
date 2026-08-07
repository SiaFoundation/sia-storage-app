// Registering the Finder mount.
//
// NSFileProviderManager.add is entitled, and the entitlement is carried by a
// provisioning profile, which only a bundle can embed. The extension cannot make
// the call either: it may drive a domain it already belongs to and may not
// create one. So this is a separate program, spawned per operation, that lives
// in a nested bundle inside the app and is signed with the app's own identity.
//
// Everything below is the decision, kept away from the framework so it can be
// tested without entitlements. `main.swift` supplies the real implementation.

import FileProvider
import Foundation

/// The calls this program makes against the system, behind a protocol so a test
/// can watch the order without a signed bundle to make them from.
public protocol DomainRegistry {
    func existing() async throws -> [String]
    func add(identifier: String, displayName: String) async throws
    func setHidden(identifier: String, hidden: Bool) async throws
    /// Returns where any unsynced local changes were kept, if there were some.
    func remove(identifier: String) async throws -> String?
}

public enum AgentError: Error, Equatable {
    case usage(String)
    /// The domain's replicated directory is still on disk from a previous one.
    case replicaInTheWay(String)
    case noSuchDomain(String)

    public var message: String {
        switch self {
        case .usage(let usage): return "usage: \(usage)"
        case .noSuchDomain(let identifier):
            return "no domain named \(identifier) is registered"
        case .replicaInTheWay(let identifier):
            return
                "the replicated directory for \(identifier) is still on disk. "
                + "The system is cleaning up a previous domain, so try again shortly."
        }
    }
}

public struct AgentResult: Equatable {
    public let ok: Bool
    public let domains: [String]
    public let message: String?
    /// Where removal left the files it would not delete.
    public let preserved: String?

    public init(
        ok: Bool, domains: [String] = [], message: String? = nil, preserved: String? = nil
    ) {
        self.ok = ok
        self.domains = domains
        self.message = message
        self.preserved = preserved
    }

    /// One line of JSON, which is the whole interface back to the caller.
    public var json: String {
        var fields = ["\"ok\":\(ok)"]
        if !domains.isEmpty {
            let list = domains.map { "\"\(escaped($0))\"" }.joined(separator: ",")
            fields.append("\"domains\":[\(list)]")
        }
        if let preserved { fields.append("\"preserved\":\"\(escaped(preserved))\"") }
        if let message { fields.append("\"message\":\"\(escaped(message))\"") }
        return "{\(fields.joined(separator: ","))}"
    }

    /// JSON string escaping. A preserved path is whatever the filesystem holds
    /// and a domain identifier is whatever its vendor chose, so a quote or a
    /// backslash has to survive rather than be replaced with something that
    /// parses into the wrong thing.
    private func escaped(_ value: String) -> String {
        var out = ""
        for character in value.unicodeScalars {
            switch character {
            case "\\": out += "\\\\"
            case "\"": out += "\\\""
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if character.value < 0x20 {
                    out += String(format: "\\u%04x", character.value)
                } else {
                    out.unicodeScalars.append(character)
                }
            }
        }
        return out
    }
}

public enum Agent {
    /// Runs one verb against the registry.
    ///
    /// Registering only ever adds. `addDomain` is documented to update the
    /// display name and hidden state of an identifier that already exists and
    /// succeed, and to be the way to clear a disconnected one, so one call at
    /// launch restores the mount from any of the states this program can leave
    /// it in, without reading the current one first.
    ///
    /// Removing first would be worse than redundant. A plain removal keeps none
    /// of the domain's current files, so a mount with downloaded content would
    /// be torn down and rebuilt every time the app started, and the add that
    /// followed would race the disk location being cleaned up: it fails with
    /// `NSFileWriteFileExistsError` while the old one is still there.
    public static func run(_ arguments: [String], registry: DomainRegistry) async throws
        -> AgentResult
    {
        switch arguments.first {
        case "register":
            guard arguments.count == 3 else {
                throw AgentError.usage("register <domainId> <displayName>")
            }
            let identifier = arguments[1]
            try await registry.add(identifier: identifier, displayName: arguments[2])
            return AgentResult(ok: true, domains: [identifier])

        case "hide", "show":
            guard arguments.count == 2 else {
                throw AgentError.usage("\(arguments[0]) <domainId>")
            }
            try await registry.setHidden(identifier: arguments[1], hidden: arguments[0] == "hide")
            return AgentResult(ok: true, domains: [arguments[1]])

        case "unregister":
            guard arguments.count == 2 else { throw AgentError.usage("unregister <domainId>") }
            let preserved = try await registry.remove(identifier: arguments[1])
            return AgentResult(ok: true, preserved: preserved)

        case "list":
            return AgentResult(ok: true, domains: try await registry.existing())

        default:
            throw AgentError.usage("register | hide | show | unregister | list")
        }
    }
}

/// The real registry.
public struct SystemDomainRegistry: DomainRegistry {
    public init() {}

    public func existing() async throws -> [String] {
        try await NSFileProviderManager.domains().map { $0.identifier.rawValue }
    }

    public func add(identifier: String, displayName: String) async throws {
        let domain = NSFileProviderDomain(
            identifier: NSFileProviderDomainIdentifier(identifier), displayName: displayName)
        do {
            try await NSFileProviderManager.add(domain)
        } catch let error as NSError
            where error.domain == NSCocoaErrorDomain && error.code == NSFileWriteFileExistsError
        {
            // The replicated directory outlived the domain, which happens when a
            // domain is removed and its disk location is still being cleaned up.
            // Named, because the framework's own message says only that a file
            // exists and never which one.
            throw AgentError.replicaInTheWay(identifier)
        }
    }

    public func setHidden(identifier: String, hidden: Bool) async throws {
        guard let domain = try await domain(identifier) else {
            throw AgentError.noSuchDomain(identifier)
        }
        domain.isHidden = hidden
        // Re-adding is how the hidden state is written: the property is on the
        // domain object, and the system takes the latest one it was handed.
        try await NSFileProviderManager.add(domain)
    }

    /// Keeps items with unsynced local changes rather than deleting everything.
    /// A file created in Finder that has not uploaded yet exists nowhere else.
    public func remove(identifier: String) async throws -> String? {
        guard let domain = try await domain(identifier) else { return nil }
        let preserved = try await NSFileProviderManager.remove(
            domain, mode: .preserveDirtyUserData)
        return preserved?.path
    }

    private func domain(_ identifier: String) async throws -> NSFileProviderDomain? {
        try await NSFileProviderManager.domains().first { $0.identifier.rawValue == identifier }
    }
}

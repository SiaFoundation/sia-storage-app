// Registering the Finder mount.
//
// NSFileProviderManager.add is entitled, and only a bundle can embed the
// provisioning profile carrying it. The extension cannot make the call either:
// it may drive a domain it already belongs to and may not create one. Hence a
// separate signed program, spawned per operation, nested inside the app.

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

    /// Escapes `"`, `\`, and the control range per RFC 8259. Paths and domain
    /// identifiers are arbitrary strings, so any of these can appear.
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
    /// Registering is add-only. `NSFileProviderManager.add` updates an existing
    /// identifier and clears a disconnected one, so one call at launch restores
    /// the mount from any state this program leaves. Removing first would discard
    /// the domain's downloaded files and race the cleanup of its disk location,
    /// which fails with `NSFileWriteFileExistsError`.
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
            // The replicated directory outlived its domain, mid-cleanup. Named
            // because the framework's message says only that a file exists.
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

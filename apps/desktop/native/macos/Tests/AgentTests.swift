import FileProvider
import XCTest

@testable import SiaDomainAgent

/// Records the calls in order, so a test can assert the sequence rather than the
/// end state. Registering must not remove first, and only the order shows it.
private final class RecordingRegistry: DomainRegistry, @unchecked Sendable {
    var calls: [String] = []
    var present: [String] = []
    var names: [String: String] = [:]
    var hidden: Set<String> = []
    var dirty: [String: String] = [:]
    var addFails = false

    func existing() async throws -> [String] {
        calls.append("existing")
        return present
    }

    /// Models what the framework documents: adding an identifier that is already
    /// there updates its display name and hidden state and succeeds, rather than
    /// registering it twice.
    func add(identifier: String, displayName: String) async throws {
        calls.append("add:\(identifier):\(displayName)")
        if addFails { throw NSError(domain: "test", code: 1) }
        names[identifier] = displayName
        hidden.remove(identifier)
        if !present.contains(identifier) { present.append(identifier) }
    }

    func setHidden(identifier: String, hidden isHidden: Bool) async throws {
        calls.append("setHidden:\(identifier):\(isHidden)")
        guard present.contains(identifier) else { throw AgentError.noSuchDomain(identifier) }
        if isHidden { hidden.insert(identifier) } else { hidden.remove(identifier) }
    }

    func remove(identifier: String) async throws -> String? {
        calls.append("remove:\(identifier)")
        present.removeAll { $0 == identifier }
        hidden.remove(identifier)
        return dirty[identifier]
    }
}

final class AgentJSONEscapingTests: XCTestCase {
    func testADomainIdentifierWithAQuoteStillParses() throws {
        // `existing()` returns every domain registered on the machine, so the
        // identifiers include other vendors' and are not ours to assume clean.
        let result = AgentResult(ok: true, domains: ["sia-dev", "a\"b\\c"])

        let parsed = try JSONSerialization.jsonObject(with: Data(result.json.utf8))

        let domains = (parsed as? [String: Any])?["domains"] as? [String]
        XCTAssertEqual(domains, ["sia-dev", "a\"b\\c"])
    }
}

final class AgentTests: XCTestCase {
    func testRegisterOnlyAdds() async throws {
        let registry = RecordingRegistry()

        let result = try await Agent.run(["register", "sia-dev", "Sia Storage"], registry: registry)

        XCTAssertEqual(registry.calls, ["add:sia-dev:Sia Storage"])
        XCTAssertTrue(result.ok)
        XCTAssertEqual(result.domains, ["sia-dev"])
    }

    func testRegisterLeavesAnExistingMountInPlace() async throws {
        let registry = RecordingRegistry()
        registry.present = ["sia-dev"]

        _ = try await Agent.run(["register", "sia-dev", "Sia Storage"], registry: registry)
        _ = try await Agent.run(["register", "sia-dev", "Renamed"], registry: registry)

        XCTAssertFalse(registry.calls.contains { $0.hasPrefix("remove") })
        XCTAssertEqual(registry.present, ["sia-dev"])
        XCTAssertEqual(registry.names["sia-dev"], "Renamed")
    }

    func testRegisterReportsAFailureToAdd() async {
        let registry = RecordingRegistry()
        registry.addFails = true

        do {
            _ = try await Agent.run(["register", "sia-dev", "Sia"], registry: registry)
            XCTFail("expected the add to surface")
        } catch {
            XCTAssertTrue(registry.calls.contains("add:sia-dev:Sia"))
        }
    }

    func testUnregisterRemovesTheDomain() async throws {
        let registry = RecordingRegistry()
        registry.present = ["sia-dev"]

        let result = try await Agent.run(["unregister", "sia-dev"], registry: registry)

        XCTAssertEqual(registry.calls, ["remove:sia-dev"])
        XCTAssertTrue(result.ok)
        XCTAssertEqual(registry.present, [])
    }

    func testUnregisterReportsWhereUnsyncedFilesWereKept() async throws {
        let registry = RecordingRegistry()
        registry.present = ["sia-dev"]
        registry.dirty["sia-dev"] = "/Users/x/Sia (preserved)"

        let result = try await Agent.run(["unregister", "sia-dev"], registry: registry)

        XCTAssertEqual(result.preserved, "/Users/x/Sia (preserved)")
        XCTAssertTrue(result.json.contains("\"preserved\":\"/Users/x/Sia (preserved)\""))
    }

    func testHideAndShowFlipVisibilityWithoutRemoving() async throws {
        let registry = RecordingRegistry()
        registry.present = ["sia-dev"]

        _ = try await Agent.run(["hide", "sia-dev"], registry: registry)
        XCTAssertEqual(registry.hidden, ["sia-dev"])
        XCTAssertEqual(registry.present, ["sia-dev"])

        _ = try await Agent.run(["show", "sia-dev"], registry: registry)
        XCTAssertEqual(registry.hidden, [])
        XCTAssertFalse(registry.calls.contains { $0.hasPrefix("remove") })
    }

    func testRegisterUnhidesAMountHiddenAtTheLastQuit() async throws {
        let registry = RecordingRegistry()
        registry.present = ["sia-dev"]
        _ = try await Agent.run(["hide", "sia-dev"], registry: registry)

        _ = try await Agent.run(["register", "sia-dev", "Sia Storage"], registry: registry)

        XCTAssertEqual(registry.hidden, [])
    }

    func testHidingSomethingThatIsNotRegisteredFails() async {
        let registry = RecordingRegistry()

        do {
            _ = try await Agent.run(["hide", "sia-dev"], registry: registry)
            XCTFail("expected a failure")
        } catch let error as AgentError {
            XCTAssertEqual(error, .noSuchDomain("sia-dev"))
        } catch {
            XCTFail("expected an AgentError, got \(error)")
        }
    }

    func testListReportsWhatIsRegistered() async throws {
        let registry = RecordingRegistry()
        registry.present = ["sia-dev", "sia-prod"]

        let result = try await Agent.run(["list"], registry: registry)

        XCTAssertEqual(result.domains, ["sia-dev", "sia-prod"])
    }

    func testRefusesAVerbItDoesNotHave() async {
        let registry = RecordingRegistry()

        do {
            _ = try await Agent.run(["mount"], registry: registry)
            XCTFail("expected a usage error")
        } catch let error as AgentError {
            XCTAssertEqual(error, .usage("register | hide | show | unregister | list | resend | materialized"))
        } catch {
            XCTFail("expected a usage error, got \(error)")
        }
        XCTAssertEqual(registry.calls, [])
    }

    func testRefusesRegisterWithoutADisplayName() async {
        let registry = RecordingRegistry()

        do {
            _ = try await Agent.run(["register", "sia-dev"], registry: registry)
            XCTFail("expected a usage error")
        } catch let error as AgentError {
            XCTAssertEqual(error, .usage("register <domainId> <displayName>"))
        } catch {
            XCTFail("expected a usage error, got \(error)")
        }
    }

    func testNamesTheDirectoryLeftBehindByAPreviousDomain() {
        XCTAssertTrue(AgentError.replicaInTheWay("sia-dev").message.contains("sia-dev"))
        XCTAssertTrue(AgentError.replicaInTheWay("sia-dev").message.contains("try again"))
    }

    func testResultIsOneLineOfJson() {
        let result = AgentResult(ok: true, domains: ["a", "b"])

        XCTAssertEqual(result.json, "{\"ok\":true,\"domains\":[\"a\",\"b\"]}")
        XCTAssertFalse(result.json.contains("\n"))
    }

    func testAFailureCarriesItsMessageUnchanged() {
        let result = AgentResult(ok: false, message: "no such \"domain\"")

        XCTAssertEqual(
            result.json, "{\"ok\":false,\"message\":\"no such \\\"domain\\\"\"}")
    }

    func testAPathKeepsItsBackslashesAndQuotes() throws {
        let result = AgentResult(ok: true, preserved: #"/Volumes/od\d/a"b"#)

        let parsed = try JSONSerialization.jsonObject(with: Data(result.json.utf8))
        let preserved = (parsed as? [String: Any])?["preserved"] as? String
        XCTAssertEqual(preserved, #"/Volumes/od\d/a"b"#)
    }
}

/// Answers each item from a table, and fails `open` for any other domain.
private struct TableCopies: FinderCopies {
    let domainId: String
    let answers: [String: Error]

    func open(domainId: String) async throws -> FinderDomainCopies {
        guard domainId == self.domainId else { throw AgentError.noSuchDomain(domainId) }
        return TableDomain(answers: answers)
    }
}

private struct TableDomain: FinderDomainCopies, @unchecked Sendable {
    let answers: [String: Error]
    func resend(itemId: String) async -> Error? { answers[itemId] }
}

final class ResendTests: XCTestCase {
    func testEachSystemAnswerMapsToTheResultTheDaemonActsOn() {
        let cases: [(Error?, ResendResult)] = [
            (nil, .asked),
            (NSError(domain: NSCocoaErrorDomain, code: NSUbiquitousFileUnavailableError), .notHydrated),
            (NSError(domain: NSFileProviderErrorDomain, code: NSFileProviderError.noSuchItem.rawValue), .notHydrated),
            (NSError(domain: NSPOSIXErrorDomain, code: Int(EIO)), .failed),
        ]
        for (error, expected) in cases {
            XCTAssertEqual(ResendResult(error), expected, "\(String(describing: error))")
        }
    }

    func testTheResendVerbWritesOneResultPerItemToTheGivenFile() async throws {
        let out = FileManager.default.temporaryDirectory
            .appendingPathComponent("resend-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: out) }
        let copies = TableCopies(
            domainId: "sia-dev",
            answers: [
                "cloud-only": NSError(
                    domain: NSCocoaErrorDomain, code: NSUbiquitousFileUnavailableError)
            ])

        let result = try await Agent.run(
            ["resend", "sia-dev", out.path, "held", "cloud-only"], registry: RecordingRegistry(),
            copies: copies)

        XCTAssertTrue(result.ok)
        let parsed = try JSONSerialization.jsonObject(with: Data(contentsOf: out)) as? [String: Any]
        let entries = parsed?["results"] as? [[String: String]] ?? []
        let byId = Dictionary(uniqueKeysWithValues: entries.map { ($0["id"]!, $0["result"]!) })
        XCTAssertEqual(byId, ["held": "asked", "cloud-only": "not-hydrated"])
    }
}

/// Answers from fixed lists, and expires any anchor but `fresh`.
private struct TableSet: MaterializedSet {
    var ids: [String] = []
    var updated: [String] = []
    var deleted: [String] = []
    var fresh = Data("fresh".utf8)

    func all(domainId: String) async throws -> (ids: [String], anchor: Data) {
        (ids, Data("after-walk".utf8))
    }

    func changes(domainId: String, since anchor: Data) async throws -> (
        updated: [String], deleted: [String], anchor: Data
    ) {
        guard anchor == fresh else { throw MaterializedError.expired }
        return (updated, deleted, Data("after-changes".utf8))
    }
}

final class MaterializedTests: XCTestCase {
    private func run(_ anchor: String?, _ set: TableSet) async throws -> [String: Any] {
        let out = FileManager.default.temporaryDirectory
            .appendingPathComponent("materialized-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: out) }
        let args = ["materialized", "sia-dev", out.path] + (anchor.map { [$0] } ?? [])
        _ = try await Agent.run(args, registry: RecordingRegistry(), materialized: set)
        return try JSONSerialization.jsonObject(with: Data(contentsOf: out)) as! [String: Any]
    }

    func testAFullWalkListsFilesOnlyAndTheAnchorToReadFrom() async throws {
        let set = TableSet(ids: [
            NSFileProviderItemIdentifier.rootContainer.rawValue, "dir:photos", "a", "b",
            NSFileProviderItemIdentifier.trashContainer.rawValue,
        ])

        let result = try await run(nil, set)

        XCTAssertEqual(result["full"] as? [String], ["a", "b"])
        XCTAssertEqual(result["anchor"] as? String, Data("after-walk".utf8).base64EncodedString())
        XCTAssertNil(result["removed"])
    }

    func testAChangeReadReportsAddedAndRemovedFiles() async throws {
        let set = TableSet(updated: ["a", "dir:x"], deleted: ["b"])

        let result = try await run(Data("fresh".utf8).base64EncodedString(), set)

        XCTAssertEqual(result["added"] as? [String], ["a"])
        XCTAssertEqual(result["removed"] as? [String], ["b"])
        XCTAssertNil(result["full"])
    }

    func testAnUnreadableAnchorFallsBackToAFullWalk() async throws {
        let result = try await run("not base64 !", TableSet(ids: ["a"]))

        XCTAssertEqual(result["full"] as? [String], ["a"])
    }

    func testAnExpiredAnchorFallsBackToAFullWalk() async throws {
        let set = TableSet(ids: ["a"], deleted: ["b"])

        let result = try await run(Data("stale".utf8).base64EncodedString(), set)

        XCTAssertEqual(result["full"] as? [String], ["a"])
        XCTAssertNil(result["removed"])
    }
}

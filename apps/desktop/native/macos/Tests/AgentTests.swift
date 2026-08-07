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
            XCTAssertEqual(error, .usage("register | hide | show | unregister | list"))
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

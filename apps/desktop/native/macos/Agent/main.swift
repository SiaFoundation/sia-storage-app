// Entry point for the domain agent. One verb, one line of JSON, then exit.
//
// Compiled together with Domain.swift into a single module, so there is nothing
// to import here. SwiftPM builds the same file set minus this one as a library,
// which is how the tests reach it.

import Foundation

let arguments = Array(CommandLine.arguments.dropFirst())

// Top-level code cannot await, and the process would exit before an unawaited
// task resumed, so the semaphore holds it open for exactly as long as the one
// operation takes.
let done = DispatchSemaphore(value: 0)
var status: Int32 = 0

Task {
    do {
        let result = try await Agent.run(arguments, registry: SystemDomainRegistry())
        print(result.json)
    } catch let error as AgentError {
        print(AgentResult(ok: false, message: error.message).json)
        status = 1
    } catch {
        print(AgentResult(ok: false, message: error.localizedDescription).json)
        status = 1
    }
    done.signal()
}

done.wait()
exit(status)

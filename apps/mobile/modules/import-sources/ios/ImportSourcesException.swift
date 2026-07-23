import ExpoModulesCore

/// Expo exception whose `code` JS reads and maps into the import failure
/// classifier. Every code except `cancelled` is a core reason-registry code;
/// `cancelled` maps to the cancelled import-file state.
final class ImportSourcesException: Exception {
  private let codeString: String
  private let reasonString: String

  init(_ code: String, _ reason: String) {
    self.codeString = code
    self.reasonString = reason
    super.init()
  }

  override var code: String { codeString }
  override var reason: String { reasonString }
}

func rethrowCoded<T>(_ body: () throws -> T) throws -> T {
  do {
    return try body()
  } catch let error as CodedError {
    throw ImportSourcesException(error.code, error.message)
  }
}

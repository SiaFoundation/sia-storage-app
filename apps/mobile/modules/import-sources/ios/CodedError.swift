import Foundation

/// Pure-layer error carrying a registry code. The Expo module bindings map it
/// to an exception whose `code` crosses the bridge as `error.code` in JS.
public struct CodedError: Error, Equatable {
  public let code: String
  public let message: String

  public init(_ code: String, _ message: String = "") {
    self.code = code
    self.message = message
  }
}

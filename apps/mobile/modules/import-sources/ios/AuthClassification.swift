import Foundation

/// Classification of an empty asset fetch, kept pure for host tests. Under
/// limited photo access an asset the user did not select is invisible, not
/// deleted; marking it deleted would be wrong and unrecoverable, while
/// permission-denied backs off and heals when the user widens access.
public enum AuthClassification {
  public static func classifyEmptyFetch(isLimitedAuth: Bool) -> String {
    isLimitedAuth ? "permission-denied" : "deleted"
  }
}

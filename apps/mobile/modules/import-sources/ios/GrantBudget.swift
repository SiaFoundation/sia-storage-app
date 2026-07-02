import Foundation

/// iOS has no persistable-grant table, so the budget is effectively
/// unlimited, but it must cross the JS bridge as a finite number (Infinity
/// does not survive the bridge), hence Int32.max.
public enum GrantBudget {
  public static let iosRemaining: Int = 2_147_483_647
}

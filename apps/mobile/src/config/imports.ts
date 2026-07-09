/**
 * Headroom kept out of the Android persistable-grant budget so bookmark
 * creation never drains it to zero. The live remaining count comes from the
 * native module (`grantBudgetRemaining`); picks past the remaining budget
 * minus this reserve import as `ephemeral`.
 */
export const IMPORT_GRANT_RESERVE = 16

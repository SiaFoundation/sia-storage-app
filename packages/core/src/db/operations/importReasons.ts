import { IMPORT_MAX_ATTEMPTS } from '../../config'

/**
 * Every code the import_files `reason` column can carry, with its retry
 * rule. When a copy attempt fails, the error is classified into one of
 * these codes; the rule decides whether the row retries on the backoff
 * schedule or is marked failed/unavailable right away, and which terminal
 * state it lands in once attempts run out. Native module error codes are
 * a strict subset of these. Migration 0003 carries `files.lostReason`
 * sentences into `reason`, so readers must fall back to raw text.
 */
export type ImportReasonCode =
  | 'deleted'
  | 'session-expired'
  | 'unsupported'
  | 'export-failed'
  | 'cloud-pending'
  | 'cloud-download-failed'
  | 'source-missing'
  | 'source-pending'
  | 'permission-denied'
  | 'not-enough-space'
  | 'not-persistable'
  | 'resolver-error'
  | 'io-error'
  | 'hash-failed'
  | 'destination-deleted'
  | 'duplicate-content'

export type ImportReasonRule = {
  /** immediate = no retries, mark the row terminal now; backoff = retry on the schedule. */
  kind: 'immediate' | 'backoff'
  /** Terminal state when attempts exhaust (or immediately, for `immediate`). */
  exhausted: 'failed' | 'unavailable'
  /**
   * Attempt cap. Deterministic failures cap low so an error that can never
   * heal doesn't burn the full ~5h retry schedule.
   */
  cap: number
}

export const IMPORT_REASONS: Record<ImportReasonCode, ImportReasonRule> = {
  deleted: { kind: 'immediate', exhausted: 'unavailable', cap: 0 },
  'session-expired': { kind: 'immediate', exhausted: 'unavailable', cap: 0 },
  unsupported: { kind: 'immediate', exhausted: 'failed', cap: 0 },
  'export-failed': { kind: 'backoff', exhausted: 'unavailable', cap: 2 },
  'cloud-pending': { kind: 'backoff', exhausted: 'unavailable', cap: IMPORT_MAX_ATTEMPTS },
  'cloud-download-failed': {
    kind: 'backoff',
    exhausted: 'unavailable',
    cap: IMPORT_MAX_ATTEMPTS,
  },
  'source-missing': { kind: 'backoff', exhausted: 'unavailable', cap: IMPORT_MAX_ATTEMPTS },
  'source-pending': { kind: 'backoff', exhausted: 'unavailable', cap: IMPORT_MAX_ATTEMPTS },
  'permission-denied': { kind: 'backoff', exhausted: 'unavailable', cap: IMPORT_MAX_ATTEMPTS },
  'not-enough-space': { kind: 'backoff', exhausted: 'unavailable', cap: IMPORT_MAX_ATTEMPTS },
  'not-persistable': { kind: 'immediate', exhausted: 'unavailable', cap: 0 },
  'resolver-error': { kind: 'backoff', exhausted: 'unavailable', cap: IMPORT_MAX_ATTEMPTS },
  'io-error': { kind: 'backoff', exhausted: 'failed', cap: IMPORT_MAX_ATTEMPTS },
  'hash-failed': { kind: 'backoff', exhausted: 'failed', cap: IMPORT_MAX_ATTEMPTS },
  // Never set by the error classifier: the destination directory was
  // deleted out from under the row, or the content already exists.
  'destination-deleted': { kind: 'immediate', exhausted: 'failed', cap: 0 },
  'duplicate-content': { kind: 'immediate', exhausted: 'unavailable', cap: 0 },
}

/** A retry can never succeed for these codes, so the retry action skips them. */
export const UNRETRYABLE_REASONS: readonly ImportReasonCode[] = [
  'deleted',
  'session-expired',
  'unsupported',
  'destination-deleted',
]

export function isImportReasonCode(value: string | null | undefined): value is ImportReasonCode {
  return value != null && value in IMPORT_REASONS
}

export function importReasonRule(code: ImportReasonCode): ImportReasonRule {
  return IMPORT_REASONS[code]
}

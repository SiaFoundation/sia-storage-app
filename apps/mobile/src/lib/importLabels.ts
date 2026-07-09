import {
  type ImportFileRow,
  type ImportFileState,
  IMPORT_REASONS,
  type ImportReasonCode,
  type ImportRow,
  type ImportSource,
  type ImportStatus,
  type ImportSummary,
  isImportReasonCode,
} from '@siastorage/core/db/operations'
import { humanSize } from './humanSize'
import { palette } from '../styles/colors'

const SOURCE_LABELS: Record<ImportSource, string> = {
  picker: 'Files',
  camera: 'Camera',
  share: 'Shared',
  'new-photos': 'New photos',
  'library-scan': 'Photo library',
  legacy: 'Imported before update',
}

export function sourceLabel(source: ImportSource): string {
  return SOURCE_LABELS[source] ?? source
}

const STATUS_LABELS: Record<ImportStatus, string> = {
  queued: 'Queued',
  importing: 'Importing',
  done: 'Done',
}

export function statusLabel(status: ImportStatus): string {
  return STATUS_LABELS[status] ?? status
}

/**
 * The detail-screen Status value. A done import reports HOW it ended so "done"
 * can't mask a cancel: any cancelled row reads Cancelled, any failed/unavailable
 * reads Completed (paired with the yellow color), a clean import reads Complete.
 * In-flight statuses read plainly.
 */
export function detailStatusLabel(summary: ImportSummary): string {
  if (summary.status !== 'done') return statusLabel(summary.status)
  if (summary.cancelled > 0) return 'Cancelled'
  if (summary.failed > 0 || summary.unavailable > 0) return 'Completed'
  return 'Complete'
}

/**
 * A `done` import colors by how it ended: gray when the user cancelled it,
 * yellow when it has `failed`/`unavailable` children, green when clean.
 * In-flight statuses are blue.
 */
export function statusColor(summary: ImportSummary): string {
  if (summary.status === 'done') {
    if (summary.cancelled > 0) return palette.gray[400]
    return summary.failed > 0 || summary.unavailable > 0 ? palette.yellow[400] : palette.green[500]
  }
  return palette.blue[400]
}

/** Whether every row's byte size is known, so byte totals are authoritative. */
function hasFullByteTotals(summary: ImportSummary): boolean {
  return summary.total > 0 && summary.sizedCount === summary.total && summary.totalBytes > 0
}

/**
 * The 0..1 progress ratio for an import, cumulative over the whole import.
 * When every row's size is known, the bar is byte-weighted
 * (copiedBytes / totalBytes), which stays smooth and shows within-file
 * progress on a single large file. Otherwise it falls back to a count bar
 * (terminal / expected). Returns 0 while nothing is measurable yet. Appending
 * to an open import grows the denominator, so the ratio can dip;
 * useMonotonicRatio smooths what the bar shows.
 */
export function progressRatio(
  imp: Pick<ImportRow, 'expectedCount'>,
  summary: ImportSummary,
): number {
  if (hasFullByteTotals(summary)) {
    return Math.min(1, summary.copiedBytes / summary.totalBytes)
  }
  const expected = Math.max(imp.expectedCount, summary.total)
  if (expected <= 0) return 0
  const terminal = summary.total - summary.inFlight
  return Math.min(1, terminal / expected)
}

/** "746 of 1,000", processed count over the import's expected total. */
export function progressCountLabel(
  imp: Pick<ImportRow, 'expectedCount'>,
  summary: ImportSummary,
): string {
  const expected = Math.max(imp.expectedCount, summary.total)
  const terminal = Math.max(0, summary.total - summary.inFlight)
  return `${terminal.toLocaleString()} of ${expected.toLocaleString()}`
}

/**
 * "312 MB of 1.4 GB", shown only when every row's size is known; a
 * partial-total byte label would misread as authoritative. Null hides the line.
 */
export function progressBytesLabel(summary: ImportSummary): string | null {
  if (!hasFullByteTotals(summary)) {
    return null
  }
  const copied = humanSize(Math.min(summary.copiedBytes, summary.totalBytes))
  return `${copied} of ${humanSize(summary.totalBytes)}`
}

/**
 * One-line outcome for list rows ("1,000 added · 5 duplicates") where the
 * per-state chips would be repetitive noise. Zero counts drop; an empty
 * import reads "No files".
 */
export function summaryLine(summary: ImportSummary): string {
  const parts = [
    [summary.added, 'added', 'added'],
    [summary.duplicate, 'duplicate', 'duplicates'],
    [summary.unavailable, 'unavailable', 'unavailable'],
    [summary.failed, 'failed', 'failed'],
    [summary.cancelled, 'cancelled', 'cancelled'],
  ] as const
  const line = parts
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => `${n.toLocaleString()} ${n === 1 ? one : many}`)
    .join(' · ')
  return line || 'No files'
}

export type CountChip = { label: string; count: number; color: string }

export function countChips(summary: ImportSummary): CountChip[] {
  return [
    { label: 'Added', count: summary.added, color: palette.green[500] },
    { label: 'Duplicate', count: summary.duplicate, color: palette.gray[400] },
    { label: 'Unavailable', count: summary.unavailable, color: palette.red[500] },
    { label: 'Failed', count: summary.failed, color: palette.red[500] },
    { label: 'Cancelled', count: summary.cancelled, color: palette.gray[500] },
  ].filter((c) => c.count > 0)
}

export type FileStateStyle = { label: string; color: string; spinner: boolean }

const FILE_STATE_STYLES: Record<ImportFileState, FileStateStyle> = {
  pending: { label: 'Pending', color: palette.blue[400], spinner: true },
  active: { label: 'Copying', color: palette.blue[400], spinner: true },
  added: { label: 'Added', color: palette.green[500], spinner: false },
  duplicate: { label: 'Duplicate', color: palette.gray[400], spinner: false },
  unavailable: { label: 'Unavailable', color: palette.red[500], spinner: false },
  failed: { label: 'Failed', color: palette.red[500], spinner: false },
  cancelled: { label: 'Cancelled', color: palette.gray[500], spinner: false },
}

export function fileStateStyle(state: ImportFileState): FileStateStyle {
  return FILE_STATE_STYLES[state] ?? { label: state, color: palette.gray[400], spinner: false }
}

const REASON_COPY: Record<ImportReasonCode, string> = {
  deleted: 'Deleted from the source',
  'session-expired': "This file's access expired. Pick it again to import it",
  unsupported: "This file type can't be imported",
  'export-failed': "This video can't be exported from the photo library",
  'cloud-pending': 'Waiting for iCloud download',
  'cloud-download-failed': "Couldn't download from iCloud",
  'source-missing': "The file's contents aren't on this device",
  'source-pending': 'The file is still being saved by another app',
  'permission-denied': 'Permission needed to read this file',
  'not-enough-space': 'Not enough space on this device',
  'not-persistable': "This file's access couldn't be kept. Pick it again",
  'resolver-error': "Couldn't read the source right now",
  'io-error': 'Import failed while copying',
  'hash-failed': 'Import failed while verifying',
  'destination-deleted': 'The destination folder was deleted',
  'duplicate-content': 'Identical content already in this folder',
}

/** User copy for a row's reason: registry codes map to copy; rows written
 * before the registry hold sentences and render as-is. */
export function reasonCopy(reason: string | null): string | null {
  if (!reason) return null
  return isImportReasonCode(reason) ? REASON_COPY[reason] : reason
}

export function isRetryingRow(
  row: Pick<ImportFileRow, 'state' | 'attempts' | 'nextAttemptAt'>,
  now: number,
): boolean {
  return row.state === 'pending' && row.attempts > 0 && row.nextAttemptAt > now
}

/** "in Xm" countdown to the next retry; floors at "in <1m". */
export function retryCountdownLabel(nextAttemptAt: number, now: number): string {
  const ms = nextAttemptAt - now
  if (ms < 60_000) return 'in <1m'
  return `in ${Math.round(ms / 60_000)}m`
}

/**
 * Row-aware state style: a pending row in backoff renders "Retrying (n/N)"
 * without a spinner, because a spinner on a sleeping row lies about activity.
 * N is the row's reason-specific attempt cap, not a hardcoded max.
 */
export function fileRowStyle(
  row: Pick<ImportFileRow, 'state' | 'attempts' | 'nextAttemptAt' | 'reason'>,
  now: number,
): FileStateStyle {
  if (isRetryingRow(row, now)) {
    const cap = isImportReasonCode(row.reason) ? IMPORT_REASONS[row.reason].cap : undefined
    const label = cap ? `Retrying (${row.attempts}/${cap})` : `Retrying (${row.attempts})`
    return { label, color: palette.yellow[400], spinner: false }
  }
  return fileStateStyle(row.state)
}

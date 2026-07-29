import {
  type ImportFileRow,
  type ImportFileState,
  IMPORT_REASONS,
  type ImportReasonCode,
  type ImportRow,
  type ImportSource,
  type ImportStatus,
  type ImportSummary,
  isBackgroundSource,
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
  'empty-file': "This file is empty, there's nothing to back up",
}

/** User copy for a row's reason: registry codes map to copy; rows written
 * before the registry hold sentences and render as-is. */
export function reasonCopy(reason: string | null): string | null {
  if (!reason) return null
  return isImportReasonCode(reason) ? REASON_COPY[reason] : reason
}

/**
 * A pacing snapshot published by the scanner manager after each tick. `cause`
 * names why paceable copies are deferring; null means no pressure. A consumer
 * treats a snapshot older than its staleness window as absent.
 */
export type ImportPacingSnapshot = {
  at: number
  cause: 'critical-floor' | 'headroom' | 'backlog' | null
  freeBytes: number | null
  pendingLocalBytes: number | null
}

export type ImportActivity =
  | 'importing'
  | 'idle-open'
  | 'needs-space'
  | 'waiting-space'
  | 'waiting-uploads'
  | 'retry-wait'
  | null

/**
 * The one wait-or-work state for an in-flight import, precedence first match:
 * running copies always read as importing (rows claimed before pressure rose
 * keep running, so a wait badge over a moving bar would lie); the critical
 * floor binds every source; the paced states only background sources; and
 * retry-wait fires when every pending row is sleeping out its backoff. An
 * open import with nothing in flight is idle-open (watching for more), not
 * importing. Returns null for a done import.
 */
export function deriveImportActivity(
  imp: Pick<ImportRow, 'source'>,
  summary: ImportSummary,
  pacing: ImportPacingSnapshot | null,
): ImportActivity {
  if (summary.inFlight === 0) {
    return summary.status === 'importing' ? 'idle-open' : null
  }
  if (summary.active > 0) return 'importing'
  const cause = pacing?.cause ?? null
  if (cause === 'critical-floor') return 'needs-space'
  if (isBackgroundSource(imp.source)) {
    if (cause === 'headroom') return 'waiting-space'
    if (cause === 'backlog') return 'waiting-uploads'
  }
  if (summary.backoffPending > 0 && summary.backoffPending === summary.inFlight) return 'retry-wait'
  // Plain queued: callers keep their existing label.
  return null
}

const ACTIVITY_BADGES: Record<Exclude<ImportActivity, null>, string> = {
  importing: 'Importing',
  'idle-open': 'Watching',
  'needs-space': 'Needs space',
  'waiting-space': 'Waiting',
  'waiting-uploads': 'Waiting',
  'retry-wait': 'Waiting',
}

/** Compact badge word for list surfaces; the detail carries the specifics. */
export function activityBadgeLabel(activity: Exclude<ImportActivity, null>): string {
  return ACTIVITY_BADGES[activity]
}

// Only the photo sources hold an import open (new-photos idling toward its
// seal, a library scan still feeding), so the photo wording is safe.
const ACTIVITY_DETAIL_LABELS: Record<Exclude<ImportActivity, null>, string> = {
  importing: 'Importing',
  'idle-open': 'Watching for new photos',
  'needs-space': 'Needs space',
  'waiting-space': 'Waiting for space',
  'waiting-uploads': 'Waiting on uploads',
  'retry-wait': 'Waiting to retry',
}

export function activityDetailLabel(activity: Exclude<ImportActivity, null>): string {
  return ACTIVITY_DETAIL_LABELS[activity]
}

/**
 * One-sentence explainer under the detail progress bar; null for plain
 * importing. The appended numbers move tick to tick (upload backlog
 * shrinking, free space growing), which is the visible proof the wait is
 * progressing and not stuck.
 */
export function activityExplainer(
  activity: Exclude<ImportActivity, null>,
  summary: ImportSummary,
  now: number,
  pacing?: ImportPacingSnapshot | null,
): string | null {
  switch (activity) {
    case 'waiting-uploads': {
      const base = 'Waiting for uploads to catch up. Importing continues automatically'
      const left = pacing?.pendingLocalBytes
      return left ? `${base} · ${humanSize(left)} left to upload` : base
    }
    case 'waiting-space': {
      const base = 'Free space is low. Importing continues as uploads clear space'
      const free = pacing?.freeBytes
      return free ? `${base} · ${humanSize(free)} free` : base
    }
    case 'needs-space': {
      const base = 'This device is almost out of space. Free up space to continue importing'
      const free = pacing?.freeBytes
      return free ? `${base} · ${humanSize(free)} free` : base
    }
    case 'retry-wait':
      return summary.soonestNextAttemptAt == null
        ? 'Waiting to retry a few files'
        : `Waiting to retry a few files. Next try ${retryCountdownLabel(summary.soonestNextAttemptAt, now)}`
    case 'idle-open':
      return 'New photos are added here as they arrive'
    case 'importing':
      return null
  }
}

export function activityColor(activity: Exclude<ImportActivity, null>): string {
  switch (activity) {
    case 'importing':
      return palette.blue[400]
    case 'needs-space':
    case 'retry-wait':
      return palette.yellow[400]
    case 'idle-open':
    case 'waiting-space':
    case 'waiting-uploads':
      return palette.gray[400]
  }
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
 * N is the row's reason-specific attempt cap, not a hardcoded max. `paused`
 * (the import is in a wait state) turns plain pending rows into "Waiting"
 * without a spinner for the same reason; backoff rows keep their retry label,
 * since their wait has its own cause and countdown.
 */
export function fileRowStyle(
  row: Pick<ImportFileRow, 'state' | 'attempts' | 'nextAttemptAt' | 'reason'>,
  now: number,
  paused = false,
): FileStateStyle {
  if (isRetryingRow(row, now)) {
    const cap = isImportReasonCode(row.reason) ? IMPORT_REASONS[row.reason].cap : undefined
    const label = cap ? `Retrying (${row.attempts}/${cap})` : `Retrying (${row.attempts})`
    return { label, color: palette.yellow[400], spinner: false }
  }
  if (paused && row.state === 'pending') {
    return { label: 'Waiting', color: palette.gray[400], spinner: false }
  }
  return fileStateStyle(row.state)
}

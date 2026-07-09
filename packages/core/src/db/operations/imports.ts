/*
 * Operations on the imports and import_files tables: an `imports` row is one user
 * action that brings files in, each `import_files` row one asset being copied. A
 * row moves from pending to active under a claim, then to a terminal state; a
 * sealed import whose rows are all terminal is done.
 */
import type { DatabaseAdapter, SQLParam } from '../../adapters/db'
import { IMPORT_MAX_ATTEMPTS } from '../../config'
import { minutesInMs } from '../../lib/time'
import { UNRETRYABLE_REASONS } from './importReasons'
import { insert, insertMany } from '../sql'

export type ImportSource = 'picker' | 'camera' | 'share' | 'new-photos' | 'library-scan' | 'legacy'

// In-flight: pending | active. Terminal (state IS the outcome): added | duplicate | unavailable
// | failed | cancelled. "Terminal" = state NOT IN ('pending','active').
export type ImportFileState =
  | 'pending'
  | 'active'
  | 'added'
  | 'duplicate'
  | 'unavailable'
  | 'failed'
  | 'cancelled'

export type ImportStatus = 'queued' | 'importing' | 'done'

// How an import_files row resolves to copyable bytes: explicit, never inferred
// from which source columns are null. resolveSource switches on it.
// bookmark: own durable OS ref in `sourceRef` (iOS security-scoped bookmark / Android grant)
// dir-child: inherits the import's one `dirSourceRef`; `sourceUri` is the child key under it
// staged: app-owned durable copy in `sourceUri` (camera, copied-in share); may be moved
// media: re-resolves from the media library by `mediaAssetId`
// ephemeral: session-only `sourceUri`: readable this run, `unavailable` on restart
// (Android grant overflow, a bookmark that could not be created, a legacy placeholder)
// path: desktop: durable user-owned absolute path in `sourceUri`; copy-only, never moved
export type ImportSourceKind = 'bookmark' | 'dir-child' | 'staged' | 'media' | 'ephemeral' | 'path'

// A background source is automated (new-photos, library-scan, the legacy adoption) rather
// than interactive (picker/camera/share, where the user is waiting on the import), so the
// scanner may defer a background source's durable rows under pressure.
const BACKGROUND_SOURCES: ReadonlySet<ImportSource> = new Set<ImportSource>([
  'new-photos',
  'library-scan',
  'legacy',
])
/**
 * Whether the scanner may defer this row's copy under storage/upload pressure.
 *
 * Both stored facts are needed, and neither substitutes for the other:
 *   - `sourceKind` is durability. An `ephemeral` row has no durable source to
 *     re-resolve, so deferring it loses the file; it must copy this session even
 *     under a background source.
 *   - `source` is who started it. An automated source has nobody waiting, so its
 *     copies can yield; a row the user picked stays prompt.
 *
 * Eligibility only - whether to actually defer is decided per tick against live
 * free space and upload backlog, which no stored field could hold.
 */
export function isPaceable(source: ImportSource, sourceKind: ImportSourceKind): boolean {
  return sourceKind !== 'ephemeral' && BACKGROUND_SOURCES.has(source)
}

// Cap on the exponential retry backoff window (also the clock-skew clamp).
const IMPORT_MAX_BACKOFF_MS = minutesInMs(60) // 1 hour

const IN_FLIGHT_STATES: ImportFileState[] = ['pending', 'active']

export type ImportRow = {
  id: string
  source: ImportSource
  directoryId: string | null
  pendingTags: string | null
  expectedCount: number
  dedupByHash: number
  dirSourceRef: string | null
  sealed: number
  startedAt: number
  updatedAt: number
}

export type ImportFileRow = {
  id: string
  importId: string
  state: ImportFileState
  reason: string | null
  name: string
  type: string
  size: number
  hash: string | null
  createdAt: number
  updatedAt: number
  addedAt: number
  directoryId: string | null
  mediaAssetId: string | null
  sourceKind: ImportSourceKind
  sourceUri: string | null
  sourceRef: string | null
  copyBytes: number
  attempts: number
  nextAttemptAt: number
  claimedAt: number | null
  claimToken: string | null
}

export type ImportSummary = {
  importId: string
  status: ImportStatus
  added: number
  duplicate: number
  unavailable: number
  failed: number
  cancelled: number
  inFlight: number
  total: number
  /** Rows with a known (>0) size. Byte progress is trustworthy only when this equals `total`. */
  sizedCount: number
  /** Cumulative processed bytes: terminal rows count their full size (failures
   * included, since the bar measures progress through the whole import, like the
   * count bar), in-flight rows their copyBytes heartbeat. */
  copiedBytes: number
  /** Sum of known sizes over all rows; sizes are hints until the copy measures them. */
  totalBytes: number
}

export async function insertImport(db: DatabaseAdapter, row: ImportRow): Promise<void> {
  await insert(db, 'imports', row)
}

export async function queryImports(
  db: DatabaseAdapter,
  opts?: { source?: ImportSource; limit?: number },
): Promise<ImportRow[]> {
  const where = opts?.source ? 'WHERE source = ?' : ''
  const params = opts?.source ? [opts.source] : []
  const limit = opts?.limit ? ` LIMIT ${Math.floor(opts.limit)}` : ''
  return db.getAllAsync<ImportRow>(
    `SELECT * FROM imports ${where} ORDER BY startedAt DESC${limit}`,
    ...params,
  )
}

export async function queryImportById(db: DatabaseAdapter, id: string): Promise<ImportRow | null> {
  return db.getFirstAsync<ImportRow>('SELECT * FROM imports WHERE id = ?', id)
}

/**
 * The one non-`done` import of a source: still feeding (`sealed=0`) or still draining
 * (`sealed=1` with a non-terminal child). Gates the library-scan button and the
 * new-photos accrue/wait/create choice. At most one exists per photo source.
 */
export async function queryInProgressImport(
  db: DatabaseAdapter,
  source: ImportSource,
): Promise<ImportRow | null> {
  const ph = IN_FLIGHT_STATES.map(() => '?').join(',')
  return db.getFirstAsync<ImportRow>(
    `SELECT * FROM imports
     WHERE source = ?
       AND (sealed = 0 OR EXISTS (
         SELECT 1 FROM import_files f WHERE f.importId = imports.id AND f.state IN (${ph})
       ))
     ORDER BY startedAt ASC LIMIT 1`,
    source,
    ...IN_FLIGHT_STATES,
  )
}

export async function sealImport(db: DatabaseAdapter, id: string, now: number): Promise<void> {
  await db.runAsync('UPDATE imports SET sealed = 1, updatedAt = ? WHERE id = ?', now, id)
}

/**
 * Delete an import (CASCADE drops its `import_files`). Returns the still-held source refs of
 * its rows, plus the import's folder tree grant when one exists, so the platform layer can
 * release the underlying OS grants (Android `releasePersistableUriPermission`; a no-op for
 * iOS bookmarks). The refs are collected before the delete; once CASCADE runs the rows, and
 * their refs, are gone.
 */
export async function deleteImport(db: DatabaseAdapter, id: string): Promise<string[]> {
  const grants = await db.getAllAsync<{ sourceRef: string }>(
    `SELECT sourceRef FROM import_files WHERE importId = ? AND sourceRef IS NOT NULL`,
    id,
  )
  // The folder pick's one tree grant lives on the import row itself.
  const imp = await db.getFirstAsync<{ dirSourceRef: string | null }>(
    'SELECT dirSourceRef FROM imports WHERE id = ?',
    id,
  )
  await db.runAsync('DELETE FROM imports WHERE id = ?', id)
  const refs = grants.map((g) => g.sourceRef)
  if (imp?.dirSourceRef) refs.push(imp.dirSourceRef)
  return refs
}

/**
 * Seal every `sealed=0` import of a source that hasn't been fed in `idleMs` (compared against
 * `updatedAt`, which `addFiles`/`create` bump). new-photos seals its open import after
 * IMPORT_IDLE_SEAL_MS with no new asset rather than on the first empty poll; an empty poll
 * mid-capture would seal the session's import early and make the next batch wait behind its
 * drain. Seal-leftover-on-init uses `idleMs=0` to seal any open import left by a previous run.
 * Seals ALL matching imports in one pass, not just one.
 */
export async function sealIdleImports(
  db: DatabaseAdapter,
  source: ImportSource,
  idleMs: number,
  now: number,
): Promise<void> {
  await db.runAsync(
    `UPDATE imports SET sealed = 1, updatedAt = ?
     WHERE source = ? AND sealed = 0 AND updatedAt < ?`,
    now,
    source,
    now - idleMs,
  )
}

export type AppendToOpenImportResult = {
  action: 'appended' | 'waited' | 'created'
  importId: string | null
}

/**
 * Stage more files onto an existing import and grow its `expectedCount` by the
 * rows added, in one transaction. The `sealed = 0` guard makes a racing seal
 * safe: once sealed, a late batch must create a new import instead.
 */
export async function addFilesToImport(
  db: DatabaseAdapter,
  importId: string,
  files: ImportFileRow[],
  now: number,
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await insertManyImportFiles(db, files)
    await db.runAsync(
      `UPDATE imports SET expectedCount = expectedCount + ?, updatedAt = ?
       WHERE id = ? AND sealed = 0`,
      files.length,
      now,
      importId,
    )
  })
}

/**
 * new-photos get-or-create: append the new assets to the open import, wait if the open
 * import is sealed but still draining, or create a fresh one. Runs in one transaction so
 * two concurrent polls can't both create an open import; there is at most one open import
 * per photo source.
 *
 * - open (`sealed === 0`): insert the files and grow `expectedCount`; `{action:'appended'}`.
 * The UPDATE's `WHERE sealed = 0` guard is the safety net if a racing seal sealed it mid-txn.
 * - sealed but still draining: `{action:'waited'}`, do nothing; the assets are still in the
 * library and get re-detected next poll (an open import fully finishes before the next starts).
 * - no in-progress import: insert the import and its files; `{action:'created'}`.
 */
export async function appendToOpenImportOrCreate(
  db: DatabaseAdapter,
  source: ImportSource,
  newImport: ImportRow,
  files: ImportFileRow[],
  now: number,
): Promise<AppendToOpenImportResult> {
  let result: AppendToOpenImportResult = { action: 'waited', importId: null }
  await db.withTransactionAsync(async () => {
    const inProg = await queryInProgressImport(db, source)
    if (inProg && inProg.sealed === 0) {
      // Re-point the candidate rows at the open import: the caller built them
      // against a fresh open import id (it can't know inside-txn whether this poll
      // would append or create), so an append must retarget them or they'd
      // reference a non-existent import and never drain.
      await insertManyImportFiles(
        db,
        files.map((f) => (f.importId === inProg.id ? f : { ...f, importId: inProg.id })),
      )
      await db.runAsync(
        `UPDATE imports SET expectedCount = expectedCount + ?, updatedAt = ?
         WHERE id = ? AND sealed = 0`,
        files.length,
        now,
        inProg.id,
      )
      result = { action: 'appended', importId: inProg.id }
      return
    }
    if (inProg) {
      result = { action: 'waited', importId: inProg.id }
      return
    }
    await insertImport(db, newImport)
    await insertManyImportFiles(db, files)
    result = { action: 'created', importId: newImport.id }
  })
  return result
}

function deriveStatus(sealed: number, active: number, pending: number): ImportStatus {
  if (active > 0 || sealed === 0) return 'importing'
  if (pending > 0) return 'queued'
  return 'done'
}

export async function queryImportSummary(
  db: DatabaseAdapter,
  ids: string[],
): Promise<ImportSummary[]> {
  if (ids.length === 0) return []
  const ph = ids.map(() => '?').join(',')
  const rows = await db.getAllAsync<{
    importId: string
    sealed: number
    state: ImportFileState | null
    n: number
    bytes: number
    size: number
    sized: number
  }>(
    `SELECT i.id AS importId, i.sealed AS sealed, f.state AS state,
            COUNT(f.id) AS n, COALESCE(SUM(f.copyBytes), 0) AS bytes, COALESCE(SUM(f.size), 0) AS size,
            COALESCE(SUM(CASE WHEN f.size > 0 THEN 1 ELSE 0 END), 0) AS sized
     FROM imports i LEFT JOIN import_files f ON f.importId = i.id
     WHERE i.id IN (${ph})
     GROUP BY i.id, f.state`,
    ...ids,
  )
  const byId = new Map<string, ImportSummary>()
  const sealedById = new Map<string, number>()
  const activeById = new Map<string, number>()
  const pendingById = new Map<string, number>()
  for (const id of ids) {
    byId.set(id, {
      importId: id,
      status: 'done',
      added: 0,
      duplicate: 0,
      unavailable: 0,
      failed: 0,
      cancelled: 0,
      inFlight: 0,
      total: 0,
      sizedCount: 0,
      copiedBytes: 0,
      totalBytes: 0,
    })
  }
  for (const r of rows) {
    const s = byId.get(r.importId)
    if (!s) continue
    sealedById.set(r.importId, r.sealed)
    if (r.state == null) continue // import with no children yet
    s.total += r.n
    s.sizedCount += r.sized
    s.totalBytes += r.size
    if (r.state === 'pending' || r.state === 'active') {
      s.inFlight += r.n
      // In-flight rows contribute their live copyBytes heartbeat; finalized
      // rows their full measured size, so a row finishing never drops the sum
      // to zero for the next in-flight window.
      s.copiedBytes += r.bytes
      if (r.state === 'active') activeById.set(r.importId, r.n)
      if (r.state === 'pending') pendingById.set(r.importId, r.n)
    } else {
      s[r.state] += r.n
      s.copiedBytes += r.size
    }
  }
  for (const s of byId.values()) {
    s.status = deriveStatus(
      sealedById.get(s.importId) ?? 1,
      activeById.get(s.importId) ?? 0,
      pendingById.get(s.importId) ?? 0,
    )
  }
  return [...byId.values()]
}

export async function countInFlight(db: DatabaseAdapter): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM import_files WHERE state IN ('pending','active')`,
  )
  return row?.n ?? 0
}

/**
 * "Retry now" for backed-off rows: clear `nextAttemptAt` so the scanner claims
 * them on its next tick. With no ids, retries every backed-off row. Leaves
 * `attempts` intact (the UI still surfaces the attempt count).
 */
export async function retryImportFiles(db: DatabaseAdapter, ids?: string[]): Promise<void> {
  if (ids && ids.length === 0) return
  if (ids) {
    const ph = ids.map(() => '?').join(',')
    await db.runAsync(
      `UPDATE import_files SET nextAttemptAt = 0
       WHERE id IN (${ph}) AND state = 'pending' AND attempts > 0`,
      ...ids,
    )
    return
  }
  await db.runAsync(
    `UPDATE import_files SET nextAttemptAt = 0 WHERE state = 'pending' AND attempts > 0`,
  )
}

/**
 * "Retry failed" for one import: return its terminal failures (`failed` and
 * `unavailable`) to a fresh `pending` (attempts=0, no backoff, claim/reason
 * cleared) so the scanner reprocesses them. Doing so to a sealed import makes
 * it drain again (queryInProgressImport returns it). Targets the import's own
 * rows only, unlike the global `retryImportFiles`, which only re-arms backoff
 * on `pending` rows with attempts>0, a disjoint set.
 */
export async function rependTerminalImportFiles(
  db: DatabaseAdapter,
  importId: string,
  now: number,
): Promise<void> {
  // Unretryable codes are excluded: retrying a deleted source or an expired
  // session is a guaranteed bounce straight back to terminal.
  await db.runAsync(
    `UPDATE import_files
     SET state = 'pending', attempts = 0, nextAttemptAt = 0, reason = NULL,
         claimedAt = NULL, claimToken = NULL, updatedAt = ?
     WHERE importId = ? AND state IN ('failed','unavailable')
       AND (reason IS NULL OR reason NOT IN (${UNRETRYABLE_REASONS.map(() => '?').join(',')}))`,
    now,
    importId,
    ...UNRETRYABLE_REASONS,
  )
}

/**
 * Cancel a whole import: its in-flight (`pending`/`active`) rows become
 * `cancelled`, clearing any claim so an orphaned native op no-ops.
 * Already-terminal rows (added/duplicate/...) are untouched. One UPDATE, no
 * unbounded client read of the import's children. Bytes for the now-cancelled
 * rows are reclaimed by the eviction backstop / orphan scanner.
 */
export async function cancelInFlightImportFiles(
  db: DatabaseAdapter,
  importId: string,
  now: number,
): Promise<void> {
  await db.runAsync(
    `UPDATE import_files SET state = 'cancelled', claimedAt = NULL, claimToken = NULL, updatedAt = ?
     WHERE importId = ? AND state IN ('pending','active')`,
    now,
    importId,
  )
}

export async function insertManyImportFiles(
  db: DatabaseAdapter,
  rows: ImportFileRow[],
): Promise<void> {
  if (rows.length === 0) return
  await insertMany(db, 'import_files', rows)
}

export async function queryImportFiles(
  db: DatabaseAdapter,
  opts: { importId: string; limit?: number; search?: string },
): Promise<ImportFileRow[]> {
  const limit = opts.limit ? ` LIMIT ${Math.floor(opts.limit)}` : ''
  const params: SQLParam[] = [opts.importId]
  let search = ''
  if (opts.search) {
    // Substring match on name. A leading-wildcard LIKE can't use an index, but
    // the importId index bounds the scan to one import's rows first.
    search = ` AND name LIKE ? ESCAPE '\\'`
    params.push(`%${opts.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
  }
  return db.getAllAsync<ImportFileRow>(
    `SELECT * FROM import_files WHERE importId = ?${search} ORDER BY addedAt DESC, id DESC${limit}`,
    ...params,
  )
}

/** Scanner candidate pool: ready pending rows, newest-first (LIFO). */
export async function queryPendingImportFiles(
  db: DatabaseAdapter,
  opts: { limit: number; now: number },
): Promise<ImportFileRow[]> {
  return db.getAllAsync<ImportFileRow>(
    `SELECT * FROM import_files
     WHERE state = 'pending' AND nextAttemptAt <= ?
     ORDER BY addedAt DESC, id DESC LIMIT ?`,
    opts.now,
    Math.floor(opts.limit),
  )
}

/**
 * Identity dedup: which of `mediaAssetIds` are already imported into `directoryId`.
 * Checks both tables (the durable anchor `files.mediaAssetId`, tombstoned included,
 * plus in-flight `import_files` rows), scoped to the destination directory.
 */
export async function queryImportFilesByMediaAssetIds(
  db: DatabaseAdapter,
  mediaAssetIds: string[],
  directoryId: string | null,
): Promise<Set<string>> {
  if (mediaAssetIds.length === 0) return new Set()
  const ph = mediaAssetIds.map(() => '?').join(',')
  const dirEq = directoryId === null ? 'directoryId IS NULL' : 'directoryId = ?'
  const dirParam = directoryId === null ? [] : [directoryId]
  // import_files: pending/active/added/duplicate suppress; unavailable/failed/cancelled allow re-import.
  const rows = await db.getAllAsync<{ mediaAssetId: string }>(
    `SELECT mediaAssetId FROM import_files
       WHERE mediaAssetId IN (${ph}) AND ${dirEq}
         AND state IN ('pending','active','added','duplicate')
     UNION
     SELECT mediaAssetId FROM files
       WHERE mediaAssetId IN (${ph}) AND ${dirEq} AND kind = 'file'`,
    ...mediaAssetIds,
    ...dirParam,
    ...mediaAssetIds,
    ...dirParam,
  )
  return new Set(rows.map((r) => r.mediaAssetId))
}

/** Claim a pending row: flip it to `active`, stamping claimedAt and a fresh
 * claimToken. Returns true if this caller won the claim. */
export async function claimImportFile(
  db: DatabaseAdapter,
  id: string,
  now: number,
  token: string,
): Promise<boolean> {
  const r = await db.runAsync(
    `UPDATE import_files SET state = 'active', claimedAt = ?, claimToken = ?
     WHERE id = ? AND state = 'pending'`,
    now,
    token,
    id,
  )
  return r.changes > 0
}

/**
 * Copy-progress write; also bumps `claimedAt` as a claim heartbeat, because a
 * copy longer than IMPORT_STALE_CLAIM_MS (native iCloud pulls) must not be
 * swept and double-claimed by resetStale mid-flight.
 */
export async function markImportFileProgress(
  db: DatabaseAdapter,
  id: string,
  bytes: number,
  token: string,
  now: number,
): Promise<void> {
  await db.runAsync(
    `UPDATE import_files SET copyBytes = ?, claimedAt = ? WHERE id = ? AND claimToken = ?`,
    bytes,
    now,
    id,
    token,
  )
}

/**
 * Persist the computed hash/size/type onto the claimed row (no-op if the claim
 * token no longer matches). Finalizing reads these columns back off the row,
 * so they must be written first. The write only lands if the claim token still matches and the
 * row is still `active`, so a swept-then-reclaimed row's late write no-ops. copyBytes is set to
 * size so the byte bar reflects the completed copy.
 */
export async function recordImportFileHash(
  db: DatabaseAdapter,
  id: string,
  token: string,
  meta: { hash: string; size: number; type: string },
): Promise<void> {
  await db.runAsync(
    `UPDATE import_files SET hash = ?, size = ?, type = ?, copyBytes = ?, updatedAt = ?
     WHERE id = ? AND claimToken = ? AND state = 'active'`,
    meta.hash,
    meta.size,
    meta.type,
    meta.size,
    Date.now(),
    id,
    token,
  )
}

/**
 * Set state='added' under the claim (called by the finalize transaction). Nulls `sourceRef`:
 * once the bytes are local the source is never touched again, so a success terminal releases
 * the source handle. The Android grant for that ref is released natively by the scanner's
 * terminal hook; `failed`/`unavailable` instead retain the ref so Retry can re-open the
 * source. `cancelled` keeps its ref too, but only until the import is deleted (there is
 * no retry path from cancel).
 */
export async function markImportFileAdded(
  db: DatabaseAdapter,
  id: string,
  token: string,
): Promise<void> {
  await db.runAsync(
    `UPDATE import_files SET state = 'added', sourceRef = NULL, claimedAt = NULL, claimToken = NULL
     WHERE id = ? AND claimToken = ?`,
    id,
    token,
  )
}

/** Success terminal (content dup of a finalized sibling); releases `sourceRef` like `added`. */
export async function markImportFileDuplicate(
  db: DatabaseAdapter,
  id: string,
  token: string,
  reason?: string,
): Promise<void> {
  await db.runAsync(
    `UPDATE import_files SET state = 'duplicate', sourceRef = NULL, reason = ?, claimedAt = NULL, claimToken = NULL
     WHERE id = ? AND claimToken = ?`,
    reason ?? null,
    id,
    token,
  )
}

/**
 * Refresh a stale bookmark and save it to the row (or null it). The write only
 * lands if the row's claim token still matches and the row is still `active`,
 * so a refresh left over from a swept-then-reclaimed row can't overwrite the
 * new owner's ref.
 */
export async function updateImportSourceRef(
  db: DatabaseAdapter,
  id: string,
  token: string,
  ref: string | null,
): Promise<void> {
  await db.runAsync(
    `UPDATE import_files SET sourceRef = ? WHERE id = ? AND claimToken = ? AND state = 'active'`,
    ref,
    id,
    token,
  )
}

export async function markImportFileUnavailable(
  db: DatabaseAdapter,
  id: string,
  token: string,
  reason: string,
): Promise<void> {
  await db.runAsync(
    `UPDATE import_files SET state = 'unavailable', reason = ?, claimedAt = NULL, claimToken = NULL
     WHERE id = ? AND claimToken = ?`,
    reason,
    id,
    token,
  )
}

/**
 * Transient failure under a claim: attempts++, persisted backoff (clamped to MAX_BACKOFF_MS so a
 * forward clock jump can't strand the row), back to `pending`. At the attempt cap the row goes
 * terminal instead.
 */
export async function markImportFileFailure(
  db: DatabaseAdapter,
  id: string,
  token: string,
  reason: string,
  now: number,
  // The terminal state at exhaustion depends on the failure category: a
  // transient *source* unavailability (iCloud-not-downloaded) exhausts to
  // `unavailable`; a processing error (copy/hash/unexpected) exhausts to
  // `failed`. Intermediate retries are always `pending` regardless.
  exhaustedState: 'failed' | 'unavailable' = 'failed',
  // Per-code cap (registry-driven): deterministic failures exhaust early
  // instead of burning the full schedule.
  maxAttempts: number = IMPORT_MAX_ATTEMPTS,
): Promise<void> {
  const cur = await db.getFirstAsync<{ attempts: number }>(
    `SELECT attempts FROM import_files WHERE id = ? AND claimToken = ?`,
    id,
    token,
  )
  if (!cur) return // claim no longer ours (swept + reclaimed); the new owner drives the row
  const attempts = cur.attempts + 1
  if (attempts >= maxAttempts) {
    await db.runAsync(
      `UPDATE import_files SET state = ?, reason = ?, attempts = ?, claimedAt = NULL, claimToken = NULL
       WHERE id = ? AND claimToken = ?`,
      exhaustedState,
      reason,
      attempts,
      id,
      token,
    )
    return
  }
  const delay = Math.min(5 * 60_000 * 3 ** (attempts - 1), IMPORT_MAX_BACKOFF_MS)
  await db.runAsync(
    `UPDATE import_files SET state = 'pending', reason = ?, attempts = ?, nextAttemptAt = ?,
                            claimedAt = NULL, claimToken = NULL
     WHERE id = ? AND claimToken = ?`,
    reason,
    attempts,
    now + delay,
    id,
    token,
  )
}

/** Cancel specific rows without checking any claim: in-flight rows become `cancelled`,
 * clearing the claim so an orphaned native op no-ops. Used by single-file cancel. */
export async function cancelImportFiles(db: DatabaseAdapter, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const ph = ids.map(() => '?').join(',')
  await db.runAsync(
    `UPDATE import_files SET state = 'cancelled', claimedAt = NULL, claimToken = NULL
     WHERE id IN (${ph}) AND state IN ('pending','active')`,
    ...ids,
  )
}

/** Resolve a directory's in-flight import files to `failed` before the directory is dropped. */
export async function failImportFilesInDirectory(
  db: DatabaseAdapter,
  directoryId: string,
  reason: string,
): Promise<{ id: string; type: string }[]> {
  // Returns id+type so the caller can delete the in-flight bytes at each id slot
  // (the slot path is keyed by type). Only in-flight rows are resolved; terminal
  // rows already settled.
  const rows = await db.getAllAsync<{ id: string; type: string }>(
    `SELECT id, type FROM import_files WHERE directoryId = ? AND state IN ('pending','active')`,
    directoryId,
  )
  if (rows.length === 0) return []
  const ph = rows.map(() => '?').join(',')
  await db.runAsync(
    `UPDATE import_files SET state = 'failed', reason = ?, claimedAt = NULL, claimToken = NULL
     WHERE id IN (${ph})`,
    reason,
    ...rows.map((r) => r.id),
  )
  return rows
}

/**
 * Startup/periodic sweep: release `active` rows whose claim is stale back to `pending`; reset a
 * `pending` row whose `nextAttemptAt` is implausibly far in the future (clock skew); seal a
 * `sealed=0` import that stopped being fed, so an abandoned open import can't block
 * its source's next import. Claim release and idle-seal take separate windows: cold
 * start zeroes only the claim window, so a just-created open import isn't sealed at
 * launch.
 */
export async function resetStaleImportFiles(
  db: DatabaseAdapter,
  claimOlderThanMs: number,
  sealOlderThanMs: number,
  now: number,
): Promise<void> {
  await db.runAsync(
    `UPDATE import_files SET state = 'pending', claimedAt = NULL, claimToken = NULL
     WHERE state = 'active' AND (claimedAt IS NULL OR claimedAt < ?)`,
    now - claimOlderThanMs,
  )
  await db.runAsync(
    `UPDATE import_files SET nextAttemptAt = ?
     WHERE state = 'pending' AND nextAttemptAt > ?`,
    now,
    now + IMPORT_MAX_BACKOFF_MS,
  )
  await db.runAsync(
    `UPDATE imports SET sealed = 1 WHERE sealed = 0 AND updatedAt < ?`,
    now - sealOlderThanMs,
  )
}

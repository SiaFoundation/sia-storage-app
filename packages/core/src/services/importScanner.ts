import { logger } from '@siastorage/logger'
import { createWeightedPool } from '../lib/weightedPool'
import {
  IMPORT_CRITICAL_FREE_BYTES,
  IMPORT_MAX_PER_TICK,
  IMPORT_PACED_BACKLOG_BYTES,
  IMPORT_PACED_STORAGE_HEADROOM_BYTES,
  IMPORT_STALE_CLAIM_MS,
} from '../config'
import type { AppService } from '../app/service'
import { type ImportFileRow, type ImportRow, isPaceable } from '../db/operations/imports'
import {
  type ImportReasonCode,
  importReasonRule,
  isImportReasonCode,
} from '../db/operations/importReasons'
import { uniqueId } from '../lib/uniqueId'
import { raceWithAbort } from '../lib/timeout'

// Copy pool: total in-flight bytes across concurrent copies (an idle pool always
// admits one item regardless, so a lone huge file still runs).
const IMPORT_COPY_BUDGET_BYTES = 256 * 1024 ** 2 // 256 MB
const IMPORT_MAX_CONCURRENT_COPIES = 4
// Cost for a copy whose size hint is unknown; never scheduled as free.
const IMPORT_DEFAULT_COPY_COST = 8 * 1024 ** 2 // 8 MB
// Abort a copy whose native side reports no progress for this long. runScan
// awaits every pool job, so a copy that never settles would otherwise freeze
// the scanner until the next app launch.
const IMPORT_COPY_STALL_MS = 120_000 // 2 minutes
// Give up on a source resolve (bookmark open, verify probe) that never
// settles; the row backs off as a transient resolver failure.
const IMPORT_RESOLVE_TIMEOUT_MS = 30_000
// Throttle for saving copy progress to the import_files row (independent of
// the native event throttle): write at most once per second or per 5% of the file.
const IMPORT_PROGRESS_WRITE_MIN_MS = 1000
const IMPORT_PROGRESS_WRITE_MIN_DELTA = 0.05

/**
 * Progress writer for one copy: forwards native progress events into the row,
 * throttled to one sqlite write per IMPORT_PROGRESS_WRITE_MIN_MS or per
 * IMPORT_PROGRESS_WRITE_MIN_DELTA of the file, whichever gate opens first
 * (unknown totals use the time gate alone). The write throttle is independent
 * of any native event throttle. Each write also heartbeats the claim, so a
 * multi-minute copy outlives the stale sweep. Writes are best-effort:
 * token-guarded, and a teardown-race rejection (sign-out mid-copy) must not
 * surface as unhandled.
 */
function createProgressWriter(
  app: AppService,
  row: ImportFileRow,
  token: string,
): (bytes: number) => void {
  let lastWriteAt = 0
  let lastBytes = 0
  return (bytes) => {
    const now = Date.now()
    const deltaGate =
      row.size > 0 && bytes - lastBytes >= row.size * IMPORT_PROGRESS_WRITE_MIN_DELTA
    if (now - lastWriteAt < IMPORT_PROGRESS_WRITE_MIN_MS && !deltaGate) return
    lastWriteAt = now
    lastBytes = bytes
    void app.imports.markProgress(row.id, bytes, token).catch(() => {})
  }
}

export type ImportScannerResult = {
  /** Files finalized into `files` this tick. */
  finalized: number
  /** Files that hit a transient failure (hash/copy error, content unavailable) and backed off. */
  failed: number
  /** Files whose source is permanently gone, now `unavailable`. */
  lost: number
  /** Files dropped as content `duplicate` (fs bytes cleaned). */
  duplicate: number
  /** Finalizes that no-oped: the claim was lost mid-flight, or the row was an orphan. */
  skipped: number
  /**
   * Durable rows left untouched this tick: background-source rows under
   * storage pressure or upload backlog, and any durable row below the
   * critical free-space floor. Not claimed, not marked failed; re-evaluated
   * next tick, and their import stays `importing` until space frees.
   */
  deferred: number
}

/**
 * Re-resolves an import file's source to a copyable URI. The platform resolver
 * switches on `row.sourceKind` and owns all OS-handle access; the scanner only
 * consumes the resolved result.
 *
 * - `resolved`: copy from `uri`. `release` (optional) drops any OS access scope the
 *   resolver opened; only iOS security-scoped bookmarks carry one. The scanner runs
 *   it in a `finally` after the copy and before hashing; the hash reads the local
 *   id slot, never the source, so a scope is held only for the copy window.
 * - `deleted`: source permanently gone; the row goes `unavailable`, re-importable
 *   only by re-picking.
 * - `unavailable`: content temporarily unavailable (iCloud not downloaded, an
 *   unmounted volume); transient backoff.
 */
export type ResolveSourceResult =
  | { status: 'resolved'; uri: string; release?: () => Promise<void> }
  | { status: 'deleted'; code?: ImportReasonCode }
  | { status: 'unavailable'; code?: ImportReasonCode }
/**
 * `claimToken` is the row's current active claim. When a bookmark resolved but
 * reported stale, the resolver refreshes it and saves it to the row via
 * `app.imports.updateSourceRef`, which only writes if the token still matches,
 * so a refresh left over from a reclaimed row can't clobber the new owner's ref.
 */
export type ResolveSource = (
  row: ImportFileRow,
  imp: ImportRow,
  claimToken: string,
  /** verify: existence re-check for failure classification. Resolve the REAL
   * source and probe it; never fabricate a shortcut uri (asset://) that skips
   * the probe, or the re-verify is vacuous. */
  opts?: { verify?: boolean },
) => Promise<ResolveSourceResult>

export type CalculateContentHash = (uri: string) => Promise<string | null>
export type GetMimeType = (opts: { name?: string; uri?: string }) => Promise<string>

/**
 * Releases the OS grant backing a row's source at its success terminal (added/duplicate):
 * Android `releasePersistableUriPermission`; a no-op for iOS bookmarks and kinds with no
 * grant. Best-effort: the bytes are already local, so a failure here is logged, not fatal,
 * and `deleteImport` collects any miss. Failed/unavailable rows are NOT released; they retain
 * their ref so Retry can re-open the source. Cancelled rows keep their ref too, released only
 * when the import is deleted (cancel has no retry path).
 */
export type ReleaseSourceGrant = (row: ImportFileRow) => Promise<void>

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/**
 * Drains `import_files` as a single claim-loop. Each tick recovers stale
 * claims, loads pending rows newest-first, then per row: claim, resolve the
 * source, copy to the id slot, hash, record the hash, finalize. A file's
 * "id slot" is the one local path its bytes live at, derived from its id.
 *
 * Scanner state is fully columnar (claimedAt/copyBytes/attempts/nextAttemptAt/state/hash),
 * so a suspend-then-resume is recovered by resetStale; there is no in-memory retry
 * state. On suspend the signal fires and the loop exits fast mid-file without
 * awaiting the in-flight copy; the row is left `active` and recovered by
 * resetStale next tick.
 */
export class ImportScanner {
  private app: AppService | null = null
  // No claim survives its process: batched pool claims can strand up to a full
  // tick's rows `active` after a kill, and the 10-minute sweep is too slow a
  // recovery for a fresh launch. First tick reclaims them all.
  private coldStart = true
  private _calculateContentHash: CalculateContentHash | null = null
  private _getMimeType: GetMimeType | null = null
  private _resolveSource: ResolveSource | null = null
  private _releaseSourceGrant: ReleaseSourceGrant | null = null

  initialize(
    app: AppService,
    calculateContentHash: CalculateContentHash,
    getMimeType: GetMimeType,
    resolveSource: ResolveSource,
    // Optional: platforms with no OS grant store (iOS-only builds, node/tests) omit it.
    releaseSourceGrant?: ReleaseSourceGrant,
  ): void {
    this.app = app
    this._calculateContentHash = calculateContentHash
    this._getMimeType = getMimeType
    this._resolveSource = resolveSource
    this._releaseSourceGrant = releaseSourceGrant ?? null
  }

  reset(): void {
    this.coldStart = true
    this.app = null
    this._calculateContentHash = null
    this._getMimeType = null
    this._resolveSource = null
    this._releaseSourceGrant = null
  }

  isInitialized(): boolean {
    return this.app !== null
  }

  private getApp(): AppService {
    if (!this.app) throw new Error('ImportScanner not initialized')
    return this.app
  }

  async runScan(signal?: AbortSignal): Promise<ImportScannerResult> {
    const app = this.getApp()
    const resolveSource = this._resolveSource
    const result: ImportScannerResult = {
      finalized: 0,
      failed: 0,
      lost: 0,
      duplicate: 0,
      skipped: 0,
      deferred: 0,
    }
    if (!resolveSource) throw new Error('ImportScanner not initialized')

    try {
      const now = Date.now()

      // Top-of-tick recovery: release `active` rows with stale claims back to `pending`,
      // clamp clock-skewed backoffs, seal abandoned open imports. A row left `active` by a
      // suspended raceWithAbort is recoverable ONLY here, so this must run first. Cold
      // start zeroes only the claim window; the seal window stays put so an open import
      // created moments ago isn't sealed at launch.
      await app.imports.resetStale(
        this.coldStart ? 0 : IMPORT_STALE_CLAIM_MS,
        IMPORT_STALE_CLAIM_MS,
        now,
      )
      this.coldStart = false

      const pending = await app.imports.pendingFiles(IMPORT_MAX_PER_TICK, now)
      // Ephemeral rows drain first within the tick: durable kinds survive a
      // kill, session-only uris don't. The partition is stable, so newest-first
      // order holds inside each half.
      const candidates = [
        ...pending.filter((r) => r.sourceKind === 'ephemeral'),
        ...pending.filter((r) => r.sourceKind !== 'ephemeral'),
      ]
      if (candidates.length === 0) {
        logger.debug('importScanner', 'tick_complete', result)
        return result
      }

      // Batch-load the distinct imports for the candidate rows (one get per distinct id).
      const imports = new Map<string, ImportRow>()
      for (const row of candidates) {
        if (imports.has(row.importId)) continue
        const imp = await app.imports.get(row.importId)
        if (imp) imports.set(row.importId, imp)
      }

      // Deferral signals, computed ONCE per tick (not per row): device free
      // space always (the critical floor binds every source), the upload
      // backlog only when a paceable candidate is present, since only a
      // background source's re-resolvable rows yield to backlog pressure.
      const hasPaceable = candidates.some((row) => {
        const imp = imports.get(row.importId)
        return !!imp && isPaceable(imp.source, row.sourceKind)
      })
      const pressure = await this.readPressure(app, hasPaceable)
      const { pacedUnderPressure, belowCriticalFloor } = pressure

      logger.debug('importScanner', 'tick_start', { candidates: candidates.length })

      // Copies run concurrently through the pool; a row with unknown size
      // stores 0 and is charged the default cost. Finalize needs no extra
      // serialization: it runs in its own DB transaction and the adapter
      // serializes transactions.
      const copyPool = createWeightedPool({
        budget: IMPORT_COPY_BUDGET_BYTES,
        maxConcurrent: IMPORT_MAX_CONCURRENT_COPIES,
        defaultCost: IMPORT_DEFAULT_COPY_COST,
      })
      // A suspend observed by any in-flight row stops further claims; rows
      // already claimed stay `active` and resetStale recovers them.
      let suspending = false

      const processRow = async (row: ImportFileRow, imp: ImportRow, token: string) => {
        // Jobs queued behind the pool when a suspend lands must not start work:
        // resolving would open OS scopes in the dying window, and a transient
        // probe failure there would burn attempts on rows that were merely
        // suspended. Claimed-but-unstarted rows stay `active`; resetStale
        // recovers them.
        if (signal?.aborted || suspending) return
        try {
          // Fast path FIRST, before touching the source: bytes already at the
          // id slot from a prior interrupted-after-copy tick hash as-is. A
          // moved `staged` origin no longer exists, so resolving it would
          // misclassify a recoverable row as deleted.
          const preMeta = await app.fs.readMeta(row.id)
          if (preMeta) {
            const fileUri = app.fs.uri({ id: row.id, type: row.type })
            const hashRaced = await raceWithAbort(this.hashFile(row, fileUri), signal)
            if (!hashRaced.ok) {
              suspending = true
              return
            }
            const outcome = hashRaced.value
            if (outcome.action === 'failed') {
              await this.recordFailure(app, row, token, 'hash-failed', now)
              result.failed++
              return
            }
            await this.finalizeHashed(app, row, token, outcome, result)
            return
          }

          let resolved: ResolveSourceResult
          try {
            resolved = await withTimeout(resolveSource(row, imp, token), IMPORT_RESOLVE_TIMEOUT_MS)
          } catch {
            // A resolver that never settles (a native photo-library or grant
            // call can hang) must not wedge this pool job; back the row off as
            // a transient resolver failure and let the tick finish.
            await this.recordFailure(app, row, token, 'resolver-error', now)
            result.failed++
            return
          }
          if (resolved.status === 'deleted') {
            // Immediate terminal: the source is verifiably gone (or a
            // session-expired ephemeral). Re-importable only by re-picking.
            await app.imports.markUnavailable(row.id, token, resolved.code ?? 'deleted')
            result.lost++
            return
          }
          if (resolved.status === 'unavailable') {
            // Transient source unavailability backs off via the row's columns;
            // the code's registry rule sets the attempt cap and the exhausted
            // terminal.
            await this.recordFailure(app, row, token, resolved.code ?? 'resolver-error', now)
            result.failed++
            return
          }

          // Copy bytes off the source, then drop any resolver access scope
          // (`release`) before hashing.
          let suspended = false
          let hashedInCopy: { sha256: string; size: number; mime?: string } | null = null
          // A copy whose native side stops reporting progress is aborted through
          // the normal cancel path after IMPORT_COPY_STALL_MS; without this, one
          // wedged native copy holds its pool job open and runScan never returns,
          // freezing the scanner until the next launch. Every progress event
          // re-arms the timer, so a slow multi-minute copy is never cut off.
          const copyController = new AbortController()
          const onTickAbort = () => copyController.abort()
          signal?.addEventListener('abort', onTickAbort)
          let stalled = false
          const onStall = () => {
            stalled = true
            copyController.abort()
          }
          let stallTimer = setTimeout(onStall, IMPORT_COPY_STALL_MS)
          try {
            const writeProgress = createProgressWriter(app, row, token)
            const onProgress = (bytes: number) => {
              clearTimeout(stallTimer)
              stallTimer = setTimeout(onStall, IMPORT_COPY_STALL_MS)
              writeProgress(bytes)
            }
            // usedAt:0 keeps the imported copy evictable once uploaded; do NOT bump
            // it after finalize. claimToken scopes the copy to a temp path so a
            // stale-then-reclaimed row's native copy can't corrupt the id slot.
            const copyRaced = await raceWithAbort(
              app.fs.importCopy({ id: row.id, type: row.type }, resolved.uri, {
                usedAt: 0,
                claimToken: token,
                // A staged source is app-owned: consume it (one byte-write)
                // instead of copying. Every other kind is user/OS-owned and
                // strictly read-only.
                move: row.sourceKind === 'staged',
                signal: copyController.signal,
                onProgress,
              }),
              signal,
            )
            if (!copyRaced.ok) {
              suspended = true // on suspend the row stays active; resetStale recovers
            } else {
              if (copyRaced.value.sha256) {
                hashedInCopy = {
                  sha256: copyRaced.value.sha256,
                  size: copyRaced.value.size,
                  mime: copyRaced.value.mime,
                }
              }
              // Record the completed copy's bytes so the byte bar always completes.
              await app.imports.markProgress(row.id, copyRaced.value.size, token)
            }
          } catch (e) {
            if ((e as { code?: string })?.code === 'cancelled') {
              if (stalled) {
                // The watchdog aborted a no-progress copy: a transient failure
                // that backs off and retries, not a suspend.
                await this.recordFailure(app, row, token, 'io-error', now)
                result.failed++
                return
              }
              // A native `cancelled` rejection is the suspend path, not a failure:
              // the row stays active with its claim and resetStale recovers it, the
              // same as a raced abort that exits the loop before the cancellation lands.
              suspended = true
            } else {
              throw e
            }
          } finally {
            clearTimeout(stallTimer)
            signal?.removeEventListener('abort', onTickAbort)
            await resolved.release?.()
          }
          if (suspended) {
            suspending = true
            return
          }

          let outcome:
            | { action: 'finalized'; hash: string; size: number; type: string }
            | { action: 'failed' }
          if (hashedInCopy) {
            // The adapter hashed during the copy's one read, so no second pass.
            // Only a non-generic mime from that read upgrades the type;
            // octet-stream sniffing stays a hash-pass concern.
            outcome = {
              action: 'finalized',
              hash: hashedInCopy.sha256,
              size: hashedInCopy.size,
              type:
                hashedInCopy.mime && hashedInCopy.mime !== 'application/octet-stream'
                  ? hashedInCopy.mime
                  : row.type,
            }
          } else {
            const fileUri = app.fs.uri({ id: row.id, type: row.type })
            const hashRaced = await raceWithAbort(this.hashFile(row, fileUri), signal)
            if (!hashRaced.ok) {
              // On suspend the row stays active; resetStale recovers.
              suspending = true
              return
            }
            outcome = hashRaced.value
          }
          if (outcome.action === 'failed') {
            await this.recordFailure(app, row, token, 'hash-failed', now)
            result.failed++
            return
          }

          await this.finalizeHashed(app, row, token, outcome, result)
        } catch (e) {
          logger.error('importScanner', 'process_error', {
            fileId: row.id,
            error: e as Error,
          })
          const code = await this.classifyCopyError(e, row, imp, token, resolveSource)
          if (importReasonRule(code).kind === 'immediate') {
            await app.imports.markUnavailable(row.id, token, code)
            result.lost++
          } else {
            await this.recordFailure(app, row, token, code, now)
            result.failed++
          }
        }
      }

      const jobs: Promise<void>[] = []
      for (const row of candidates) {
        if (signal?.aborted || suspending) break
        const imp = imports.get(row.importId)
        if (!imp) continue // import vanished (deleted between query and now); skip its rows

        // Below the critical floor no copy may START, whatever the source. A row
        // whose bytes already sit at the id slot (a crash between copy and
        // finalize) allocates nothing to hash and finalize, so it falls through.
        // A durable row waits - its source re-resolves next tick. An `ephemeral`
        // row cannot wait past its session, so it records a not-enough-space
        // attempt and backs off, reaching `unavailable` once the cap exhausts.
        if (belowCriticalFloor) {
          const copied = await app.fs.readMeta(row.id).catch(() => null)
          if (!copied || copied.size <= 0) {
            if (row.sourceKind !== 'ephemeral') {
              result.deferred++
              continue
            }
            const floorToken = uniqueId()
            if (!(await app.imports.claim(row.id, now, floorToken))) continue
            await this.recordFailure(app, row, floorToken, 'not-enough-space', now)
            result.failed++
            continue
          }
        }

        // Under pressure, skip paceable rows without claiming or failing them; leave
        // them `pending` for re-evaluation next tick. The open import stays `importing`
        // until space frees. Interactive-source and ephemeral rows never defer.
        if (isPaceable(imp.source, row.sourceKind) && pacedUnderPressure) {
          result.deferred++
          continue
        }

        const token = uniqueId()
        // A false result means another tick already owns this row.
        if (!(await app.imports.claim(row.id, now, token))) continue
        jobs.push(copyPool.run(row.size, () => processRow(row, imp, token)))
      }
      // allSettled: a job whose terminal write itself throws (DB fast-reject on
      // suspend) must not detach its siblings mid-copy; the row stays `active`
      // and resetStale recovers it.
      await Promise.allSettled(jobs)

      if (result.deferred > 0) {
        // Once per tick: paced rows yielded to storage/upload pressure.
        logger.info('importScanner', 'paced_deferred', { deferred: result.deferred })
      }
      logger.debug('importScanner', 'tick_complete', result)
    } catch (e) {
      logger.error('importScanner', 'scan_error', { error: e as Error })
    }

    return result
  }

  /** Backoff via the code's registry rule: per-code attempt cap + exhausted terminal. */
  private async recordFailure(
    app: AppService,
    row: ImportFileRow,
    token: string,
    code: ImportReasonCode,
    now: number,
  ): Promise<void> {
    const rule = importReasonRule(code)
    await app.imports.markFailure(row.id, token, code, now, rule.exhausted, rule.cap)
  }

  /**
   * Persist the hashed outcome and finalize the claimed row: record the hash,
   * finalize, tally, then release the grant at success terminals.
   */
  private async finalizeHashed(
    app: AppService,
    row: ImportFileRow,
    token: string,
    outcome: { hash: string; size: number; type: string },
    result: ImportScannerResult,
  ): Promise<void> {
    // Persist hash/size/type onto the row BEFORE finalize; finalizeImportFile
    // reads them from its own ownership SELECT (it takes only (id, token)).
    await app.imports.recordHash(row.id, token, {
      hash: outcome.hash,
      size: outcome.size,
      type: outcome.type,
    })
    const fin = await app.imports.finalize(row.id, token)
    if (fin.outcome === 'added') {
      // Bytes are already at the id slot (id reused); usedAt:0 stands.
      result.finalized++
    } else if (fin.outcome === 'duplicate') {
      // Content dup of an existing finalized file in the same directory: clean
      // the now-redundant bytes by this id (the original lives at a different id).
      await app.fs.removeFile({ id: row.id, type: row.type })
      result.duplicate++
    } else {
      // noop: lost the claim mid-flight; do nothing.
      result.skipped++
    }
    // The bytes are local at a success terminal, so release the Android
    // persistable permission now (no-op for iOS / non-grant kinds). Best-effort:
    // a throw here must not undo the finalize; deleteImport is the backstop.
    if (fin.outcome === 'added' || fin.outcome === 'duplicate') {
      try {
        await this._releaseSourceGrant?.(row)
      } catch (e) {
        logger.warn('importScanner', 'release_grant_failed', {
          fileId: row.id,
          error: e as Error,
        })
      }
    }
  }

  /**
   * Maps a copy/processing throw to a reason code. ENOENT is re-verified
   * against the SOURCE before going terminal: a `media` row whose byte path
   * vanished may still exist in the library (stale DATA path, cloud-only
   * bytes), which is `source-missing` backoff, not deleted. An `ephemeral` row
   * hitting a permission error after a restart is the expired session grant,
   * not a real permission problem.
   */
  private async classifyCopyError(
    error: unknown,
    row: ImportFileRow,
    imp: ImportRow,
    token: string,
    resolveSource: ResolveSource,
  ): Promise<ImportReasonCode> {
    const native = (error as { code?: string })?.code
    if (isImportReasonCode(native)) {
      // A coded `deleted` still re-verifies for media rows below; a provider
      // stream can 404 while the asset row exists (stale byte path).
      if (native !== 'deleted') return native
      if (row.sourceKind !== 'media') return native
    }

    const text = `${(error as Error)?.message ?? ''} ${String(native ?? '')}`
    if (
      native === 'deleted' ||
      /ENOENT|No such file|does not exist|could not be found/i.test(text)
    ) {
      if (row.sourceKind === 'media') {
        try {
          const recheck = await resolveSource(row, imp, token, { verify: true })
          if (recheck.status === 'deleted') return recheck.code ?? 'deleted'
          return 'source-missing'
        } catch {
          return 'source-missing'
        }
      }
      return 'deleted'
    }
    if (/EACCES|EPERM|Permission denied|SecurityException/i.test(text)) {
      return row.sourceKind === 'ephemeral' ? 'session-expired' : 'permission-denied'
    }
    if (/ENOSPC|No space left/i.test(text)) return 'not-enough-space'
    return 'io-error'
  }

  /**
   * Reads the tick's storage/backlog signals once and derives both gates from
   * them, since the space probe is a syscall and both compare against it.
   * The floor compares raw free bytes; the paced gate compares free bytes
   * minus the pending-local backlog.
   *
   * `belowCriticalFloor` holds every source; `pacedUnderPressure` only makes
   * paceable rows yield. The backlog half is skipped when nothing paceable is
   * queued, since only the paced gate consults it.
   *
   * A failed read reports no pressure: a transient probe failure must never
   * stall an import.
   */
  private async readPressure(
    app: AppService,
    hasPaceable: boolean,
  ): Promise<{ pacedUnderPressure: boolean; belowCriticalFloor: boolean }> {
    try {
      const [{ freeBytes }, pendingLocalBytes] = await Promise.all([
        app.fs.getDeviceSpace(),
        hasPaceable ? app.files.getUnuploadedBytes() : Promise.resolve(0),
      ])
      const storageHeadroomThin =
        freeBytes - pendingLocalBytes < IMPORT_PACED_STORAGE_HEADROOM_BYTES
      const backlogHigh = pendingLocalBytes > IMPORT_PACED_BACKLOG_BYTES
      return {
        belowCriticalFloor: freeBytes < IMPORT_CRITICAL_FREE_BYTES,
        pacedUnderPressure: hasPaceable && (storageHeadroomThin || backlogHigh),
      }
    } catch (e) {
      // Treat an unreadable signal as no pressure; never block an import on a
      // transient device-space/backlog read failure.
      logger.warn('importScanner', 'pacing_signal_unavailable', { error: e as Error })
      return { pacedUnderPressure: false, belowCriticalFloor: false }
    }
  }

  /**
   * Hashes the file at its id-slot uri and resolves the size/type to persist. Upgrades a
   * generic `application/octet-stream` type via the mime sniffer. Returns `failed`
   * when hashing returns null.
   */
  private async hashFile(
    row: { id: string; name: string; type: string },
    fileUri: string,
  ): Promise<
    { action: 'finalized'; hash: string; size: number; type: string } | { action: 'failed' }
  > {
    const app = this.getApp()

    let type = row.type
    if (type === 'application/octet-stream' && this._getMimeType) {
      const detected = await this._getMimeType({ name: row.name, uri: fileUri })
      if (detected && detected !== 'application/octet-stream') {
        type = detected
      }
    }

    if (!this._calculateContentHash) {
      // A missing hasher is unwired initialization, not a per-row failure; a
      // soft 'failed' here would send every row into retry backoff instead of
      // surfacing the programmer error.
      throw new Error('ImportScanner not initialized: calculateContentHash')
    }

    const hash = await this._calculateContentHash(fileUri)
    if (!hash) {
      logger.warn('importScanner', 'hash_failed', { fileId: row.id })
      return { action: 'failed' }
    }

    let size: number
    try {
      const meta = await app.fs.readMeta(row.id)
      size = meta?.size ?? 0
    } catch {
      size = 0
    }

    logger.debug('importScanner', 'file_complete', { fileId: row.id, hash, size })
    return { action: 'finalized', hash, size, type }
  }
}

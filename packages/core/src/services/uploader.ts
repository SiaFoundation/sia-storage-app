import { logger } from '@siastorage/logger'
import type { Reader } from '../adapters/fs'
import type { PackedUploadRef, PinnedObjectRef, ShardProgress } from '../adapters/sdk'
import type { AppService, AppServiceInternal } from '../app/service'
import {
  PACKER_IDLE_TIMEOUT,
  PACKER_MAX_BATCH_DURATION,
  PACKER_MAX_SLABS,
  PACKER_POLL_INTERVAL,
  SAVE_BATCH_CONCURRENCY,
  SAVE_REMOVAL_DELAY_MS,
  SECTOR_SIZE,
  SLAB_FILL_THRESHOLD,
  SLAB_SIZE,
  STORAGE_FULL_POLL_INTERVAL,
  UPLOAD_DATA_SHARDS,
  UPLOAD_MAX_INFLIGHT,
  UPLOAD_PARITY_SHARDS,
} from '../config'
import { encodeFileMetadata } from '../encoding/fileMetadata'
import type { LocalObjectWithSlabs } from '../encoding/localObject'
import { sealPinnedObject } from '../lib/localObjects'
import { retry } from '../lib/retry'
import { SlotPool } from '../lib/slotPool'
import { uniqueId } from '../lib/uniqueId'
import type { FileRecordRow } from '../types/files'

export type BatchFile = {
  fileId: string
  size: number
}

export type BatchInfo = {
  files: BatchFile[]
  totalSize: number
}

export function calculateFileProgress(
  batch: BatchInfo,
  batchProgress: number,
  fileId: string,
): number {
  const fileExists = batch.files.some((f) => f.fileId === fileId)
  if (!fileExists) return 0
  return batchProgress
}

export function calculateAllFileProgress(
  batch: BatchInfo,
  batchProgress: number,
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const file of batch.files) {
    result[file.fileId] = batchProgress
  }
  return result
}

/** Platform-specific adapters for the upload system. */
export interface UploaderAdapters {
  createFileReader: (uri: string) => Reader
  progressScheduler?: (cb: () => void) => void
}

/** A file queued for upload with its resolved URI and size. */
export type FileEntry = {
  fileId: string
  fileUri: string
  file: FileRecordRow
  size: number
}

/**
 * Mutable state for the current batch being packed.
 *
 * A batch accumulates files until a flush trigger fires:
 * - slab_threshold: current slab >=90% full and next file crosses boundary
 * - max_slabs: total slabs in batch reached PACKER_MAX_SLABS
 * - max_duration: batch has been open longer than PACKER_MAX_BATCH_DURATION
 * - idle_timeout: no new files for PACKER_IDLE_TIMEOUT after DB re-poll
 */
type BatchState = {
  batchId: string
  files: FileEntry[]
  /** Running total of all file sizes in this batch. */
  totalSize: number
  /** Number of complete slabs: floor(totalSize / SLAB_SIZE). */
  slabsFilled: number
  startedAt: number
  /** Timestamp of last successful packer.add(). */
  lastProcessedAt: number
  /** Accumulated wall-clock time spent suspended by iOS, excluded from duration checks. */
  suspendedMs: number
  /** Cumulative time spent in packer.add() calls (encoding + any mid-add slab uploads). */
  totalAddMs: number
  /** Number of packer.add() calls that triggered a slab upload (slabs increased). */
  slabUploadAdds: number
  /**
   * Running sum of uploaded-shard byte counts reported by the SDK's
   * per-shard progress callback. Divided by expected encoded size to
   * compute batch-level progress.
   */
  uploadedShardBytes: number
}

/** Recorded after each flush for efficiency analysis and testing. */
export type FlushRecord = {
  batchId: string
  reason: string
  fileCount: number
  totalSize: number
  slabsFilled: number
  /** Percentage of allocated slab capacity used: round(totalSize / ((slabsFilled+1) * SLAB_SIZE) * 100). */
  fillPercent: number
}

/**
 * Manages packing files into slab-aligned batches and uploading them.
 *
 * Files arrive via two paths:
 * 1. enqueue() — explicit queue from user actions (share sheet, manual upload)
 * 2. pollDB() — background scan of local-only files (camera roll sync)
 *
 * The async loop (runLoop) pulls files from both sources and feeds them to
 * processEntry(), which packs them into the current batch. Each packer.add()
 * call packs data into the current slab and uploads full slabs to the
 * network as they fill. When a flush trigger fires, finalize() uploads
 * the last partial slab and returns pinned objects.
 *
 * DB polling returns files ordered by createdAt ASC so files are processed
 * in the order they were added to the library. Photos arrive before their
 * thumbnails (which are generated asynchronously), naturally mixing large
 * and small files for efficient slab packing.
 */
export class UploadManager {
  private app!: AppService
  private internal!: AppServiceInternal
  private adapters!: UploaderAdapters
  private progressThrottle: ((fileId: string, progress: number) => void) | null = null
  /** Native packed upload handle; null when no batch is open. */
  private packer: PackedUploadRef | null = null
  /** The batch currently being packed (accumulating files). */
  private batch: BatchState | null = null
  /** The batch currently being finalized/uploaded (after flush, before pin). */
  private uploadingBatch: BatchState | null = null
  /** Native packed upload handle for the batch being finalized; used by shutdown() to cancel. */
  private uploadingPacker: PackedUploadRef | null = null
  /** Files added via enqueue() — processed before polled files. */
  private explicitQueue: FileEntry[] = []
  /** Files discovered by pollDB() — processed after explicit queue. */
  private polledFiles: FileEntry[] = []
  /** Whether the async loop is running; set false by shutdown() to exit. */
  private active = false
  /** Whether the loop is parked waiting for DB to become available. */
  private _suspended = false
  /** Resolves to unblock the loop when resume() is called. */
  private _resumeResolve: (() => void) | null = null
  /** Resolves to signal the caller of suspend() that the loop has parked. */
  private _parkedResolve: (() => void) | null = null
  /** Resolves the waitForWorkOrTimeout promise when wake() is called. */
  private wakeResolver: (() => void) | null = null
  /** Whether saveBatchObjects succeeded and invalidation is pending. */
  private _needsInvalidation = false
  /** Recorded flush events for efficiency analysis and testing. */
  private _flushHistory: FlushRecord[] = []
  /** Cumulative count of files passed to packer.add(). */
  private _packedCount = 0
  /** Cumulative bytes passed to packer.add(). */
  private _packedBytes = 0
  /** Cumulative count of files successfully pinned and saved. */
  private _uploadedCount = 0
  /** Cumulative bytes successfully pinned and saved. */
  private _uploadedBytes = 0

  /** Connect dependencies and start the async processing loop. */
  initialize(app: AppService, internal: AppServiceInternal, adapters: UploaderAdapters): void {
    this.app = app
    this.internal = internal
    this.adapters = adapters
    this.progressThrottle = adapters.progressScheduler
      ? (() => {
          const pending = new Map<string, number>()
          let scheduled = false
          return (fileId: string, progress: number) => {
            pending.set(fileId, progress)
            if (!scheduled) {
              scheduled = true
              adapters.progressScheduler!(() => {
                scheduled = false
                for (const [id, p] of pending) {
                  this.app.uploads.update(id, { progress: p })
                }
                pending.clear()
              })
            }
          }
        })()
      : null
    this.startLoop()
  }

  /** Add files to the explicit queue and wake the loop. */
  enqueue(files: FileEntry[]): void {
    this.app.uploads.registerMany(files.map((f) => ({ id: f.fileId, size: f.size })))
    this.explicitQueue.push(...files)
    this.wake()
  }

  /**
   * Finalize the current batch: upload the last partial slab and pin objects.
   *
   * Full slabs are already uploaded during packer.add() calls, so finalize
   * only handles the remaining partial slab. Between the first add() and
   * pinObject there is a risk window where data is uploaded but not yet
   * pinned. Smaller batches reduce this exposure.
   *
   * Computes fillPercent — the fraction of allocated slab capacity used —
   * and records it in flushHistory. Higher fillPercent means less wasted
   * slab space (each partial slab is paid for in full on the Sia network).
   */
  async flush(
    reason: 'idle_timeout' | 'max_duration' | 'max_slabs' | 'slab_threshold' | 'manual' = 'manual',
  ): Promise<void> {
    if (!this.packer || !this.batch) {
      logger.debug('uploadManager', 'no_packer_to_flush')
      return
    }

    const batch = this.batch
    const packer = this.packer

    // Move batch/packer to uploading* so shutdown() can cancel them separately
    this.uploadingBatch = batch
    this.uploadingPacker = packer
    this.packer = null
    this.batch = null

    const durationMs = Date.now() - batch.startedAt
    const activeDurationMs = durationMs - batch.suspendedMs
    const slabCapacity = (batch.slabsFilled + 1) * SLAB_SIZE
    const fillPercent = Math.round((batch.totalSize / slabCapacity) * 100)

    this._flushHistory.push({
      batchId: batch.batchId,
      reason,
      fileCount: batch.files.length,
      totalSize: batch.totalSize,
      slabsFilled: batch.slabsFilled,
      fillPercent,
    })

    logger.info('uploadManager', 'batch_flush', {
      reason,
      batchId: batch.batchId,
      files: batch.files.length,
      totalSize: batch.totalSize,
      slabsFilled: batch.slabsFilled,
      fillPercent,
      durationMs,
      activeDurationMs,
      totalAddMs: batch.totalAddMs,
      slabUploadAdds: batch.slabUploadAdds,
    })

    try {
      const fileIds = batch.files.map((f) => f.fileId)
      this.app.uploads.setBatchUploading(fileIds, batch.batchId)

      const finalizeStart = Date.now()
      const pinnedObjects = await packer.finalize()
      logger.info('uploadManager', 'batch_finalized', {
        batchId: batch.batchId,
        objects: pinnedObjects.length,
        finalizeMs: Date.now() - finalizeStart,
      })

      const saveStart = Date.now()
      const successfulFileIds = await this.saveBatchObjects(batch, pinnedObjects)
      if (successfulFileIds.length > 0) {
        this._needsInvalidation = true
      }
      logger.info('uploadManager', 'batch_completed', {
        batchId: batch.batchId,
        files: successfulFileIds.length,
        saveMs: Date.now() - saveStart,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      logger.error('uploadManager', 'batch_finalize_error', {
        batchId: batch.batchId,
        error: e as Error,
      })

      for (const entry of batch.files) {
        this.app.uploads.setError(entry.fileId, message)
      }
    } finally {
      this.uploadingBatch = null
      this.uploadingPacker = null
    }
  }

  /** Stop the loop, cancel in-flight uploads, and clean up upload state. */
  async shutdown(): Promise<void> {
    this.active = false
    if (this._resumeResolve) {
      this._resumeResolve()
      this._resumeResolve = null
    }
    if (this._parkedResolve) {
      this._parkedResolve()
      this._parkedResolve = null
    }

    if (this.packer) {
      logger.info('uploadManager', 'batch_cancel', {
        batchId: this.batch?.batchId,
      })
      try {
        await this.packer.cancel()
      } catch (e) {
        logger.debug('uploadManager', 'batch_cancel_error', {
          error: e as Error,
        })
      }
    }
    if (this.uploadingPacker) {
      logger.info('uploadManager', 'uploading_batch_cancel', {
        batchId: this.uploadingBatch?.batchId,
      })
      try {
        await this.uploadingPacker.cancel()
      } catch (e) {
        logger.debug('uploadManager', 'uploading_batch_cancel_error', {
          error: e as Error,
        })
      }
    }

    const idsToRemove: string[] = []
    if (this.batch) {
      for (const entry of this.batch.files) idsToRemove.push(entry.fileId)
    }
    if (this.uploadingBatch) {
      for (const entry of this.uploadingBatch.files) idsToRemove.push(entry.fileId)
    }
    for (const entry of this.explicitQueue) idsToRemove.push(entry.fileId)

    if (idsToRemove.length > 0) {
      this.app.uploads.removeMany(idsToRemove)
    }
    this.explicitQueue = []
    this.polledFiles = []

    this.packer = null
    this.batch = null

    this.wake()
  }

  /** Cached promise so multiple suspend() calls return the same promise
   * instead of overwriting _parkedResolve and leaving earlier callers hanging. */
  private _suspendPromise: Promise<void> | null = null

  suspend(): Promise<void> {
    if (this._suspendPromise) return this._suspendPromise
    logger.info('uploadManager', 'suspending')
    this._suspended = true
    this.wake()
    if (!this.active) return Promise.resolve()
    this._suspendPromise = new Promise<void>((resolve) => {
      this._parkedResolve = resolve
    })
    return this._suspendPromise
  }

  resume(): void {
    if (!this._suspended) return
    logger.info('uploadManager', 'resuming')
    this._suspended = false
    this._suspendPromise = null // Allow future suspend() calls to create a new promise.
    if (this._resumeResolve) {
      this._resumeResolve()
      this._resumeResolve = null
    }
  }

  get isSuspended(): boolean {
    return this._suspended
  }

  private async waitForResume(): Promise<void> {
    if (!this._suspended) return
    return new Promise<void>((resolve) => {
      this._resumeResolve = resolve
    })
  }

  get flushHistory(): FlushRecord[] {
    return this._flushHistory
  }

  get packedCount(): number {
    return this._packedCount
  }

  get packedBytes(): number {
    return this._packedBytes
  }

  get uploadedCount(): number {
    return this._uploadedCount
  }

  get uploadedBytes(): number {
    return this._uploadedBytes
  }

  /** Full state reset for test isolation. */
  reset(): void {
    this.active = false
    this.wake()
    this.packer = null
    this.batch = null
    this.uploadingBatch = null
    this.uploadingPacker = null
    this.explicitQueue = []
    this.polledFiles = []
    this.app = null!
    this.internal = null!
    this._needsInvalidation = false
    this._flushHistory = []
    this._packedCount = 0
    this._packedBytes = 0
    this._uploadedCount = 0
    this._uploadedBytes = 0
  }

  /**
   * Test-only: feed files directly into processEntry(), bypassing the
   * async loop. Allows deterministic control over file order and timing.
   */
  async __testProcessFiles(files: FileEntry[]): Promise<void> {
    this.app.uploads.registerMany(files.map((f) => ({ id: f.fileId, size: f.size })))
    for (const file of files) {
      await this.processEntry(file)
    }
  }

  /**
   * Adjust the current batch for time spent suspended by iOS. Called when
   * AppState transitions to 'active'. Adds the gap since the last activity
   * to suspendedMs so it is excluded from the max_duration check.
   */
  adjustBatchForSuspension(): void {
    if (!this.batch) return
    const now = Date.now()
    const ref = this.batch.lastProcessedAt > 0 ? this.batch.lastProcessedAt : this.batch.startedAt
    const gap = now - ref
    this.batch.suspendedMs += gap
    this.batch.lastProcessedAt = now
  }

  private drainQueues(first: FileEntry): FileEntry[] {
    const entries = [first]
    for (;;) {
      const next = this.explicitQueue.shift() ?? this.polledFiles.shift() ?? undefined
      if (!next) break
      entries.push(next)
    }
    return entries
  }

  private startLoop(): void {
    if (this.active) return
    this.active = true
    this.runLoop().catch((e) => {
      logger.error('uploadManager', 'loop_error', { error: e as Error })
    })
  }

  /**
   * Main async loop. Pulls files from explicitQueue (priority) then
   * polledFiles, packing each into the current batch via processEntry().
   *
   * When both queues are empty:
   * - If a batch exists: poll DB, then idle-wait. On timeout, re-poll
   *   once more (to catch files created during the wait), then flush.
   * - If no batch: wait for PACKER_POLL_INTERVAL before re-polling.
   *
   * The idle-wait is cancelable via wake() so new enqueue() calls
   * or shutdown() take effect immediately.
   */
  private async runLoop(): Promise<void> {
    while (this.active) {
      if (this._suspended) {
        if (this._parkedResolve) {
          this._parkedResolve()
          this._parkedResolve = null
        }
        await this.waitForResume()
        if (!this.active) break
        continue
      }

      const next = this.explicitQueue.shift() ?? this.polledFiles.shift() ?? null

      if (next) {
        await this.processEntries(this.drainQueues(next))
        continue
      }

      if (this._needsInvalidation) {
        this._needsInvalidation = false
        this.app.caches.library.invalidateAll()
        this.app.caches.libraryVersion.invalidate()
      }

      if (await this.isStorageFull()) {
        await this.waitForWorkOrTimeout(STORAGE_FULL_POLL_INTERVAL)
        continue
      }

      const newFiles = await this.pollDB()
      if (newFiles > 0) {
        continue
      }

      if (this.batch) {
        const result = await this.waitForWorkOrTimeout(PACKER_IDLE_TIMEOUT)
        if (result === 'timeout') {
          // Re-poll before flushing — other services (syncNewPhotos, etc.)
          // may have created file records during the idle wait.
          const newFilesBeforeFlush = await this.pollDB()
          if (newFilesBeforeFlush > 0) continue
          await this.flush('idle_timeout')
        }
      } else {
        await this.waitForWorkOrTimeout(PACKER_POLL_INTERVAL)
      }
    }
  }

  /**
   * Pack a single file into the current batch.
   *
   * Before adding, two pre-flush checks run:
   * 1. Threshold flush: if the current slab is >=90% full and this file
   *    would cross into a new slab, flush now to avoid wasting the
   *    well-filled slab by continuing to accumulate.
   * 2. Oversized pre-flush: if this file is larger than SLAB_SIZE and
   *    adding it would push the batch past PACKER_MAX_SLABS, flush the
   *    existing batch first so the oversized file gets its own batch.
   *
   * After adding, if slabsFilled >= PACKER_MAX_SLABS, flush immediately.
   */
  private async processEntry(entry: FileEntry): Promise<void> {
    let needsRollback = false
    try {
      if (this.batch && this.shouldFlushBeforeAdding(entry.size)) {
        await this.flush('slab_threshold')
      }

      // Oversized file pre-flush: if the batch already has files and adding
      // this large file would exceed max slabs, flush the existing batch first.
      // Only triggers for files > SLAB_SIZE to avoid splitting normal accumulation.
      if (this.batch && this.batch.files.length > 0 && entry.size > SLAB_SIZE) {
        const projectedSlabs = Math.floor((this.batch.totalSize + entry.size) / SLAB_SIZE)
        if (projectedSlabs >= PACKER_MAX_SLABS) {
          await this.flush('max_slabs')
        }
      }

      if (!this.packer) {
        const sdk = this.internal.requireSdk()
        const batchId = uniqueId()
        logger.info('uploadManager', 'packer_create', { batchId })
        const batch: BatchState = {
          batchId,
          files: [],
          totalSize: 0,
          slabsFilled: 0,
          startedAt: Date.now(),
          lastProcessedAt: 0,
          suspendedMs: 0,
          totalAddMs: 0,
          slabUploadAdds: 0,
          uploadedShardBytes: 0,
        }
        this.batch = batch
        this.packer = await sdk.uploadPacked({
          maxInflight: UPLOAD_MAX_INFLIGHT,
          dataShards: UPLOAD_DATA_SHARDS,
          parityShards: UPLOAD_PARITY_SHARDS,
          shardUploaded: {
            progress: (p) => this.onShardUploaded(batch, p),
          },
        })
      }

      this.app.uploads.setStatus(entry.fileId, 'packing')
      logger.debug('uploadManager', 'file_packing', {
        fileId: entry.fileId,
        size: entry.size,
        batchId: this.batch!.batchId,
      })

      // Add to batch state BEFORE packer.add() so onProgress can
      // distribute progress to this file while data streams to the network.
      this.batch!.files.push(entry)
      this.batch!.totalSize += entry.size
      needsRollback = true

      const t0 = Date.now()
      const reader = this.adapters.createFileReader(entry.fileUri)
      const t1 = Date.now()
      await this.packer.add(reader)
      needsRollback = false
      const t2 = Date.now()
      const addMs = t2 - t1
      const slabsBefore = this.batch!.slabsFilled
      this.recordAdd(entry, addMs)
      logger.debug('uploadManager', 'file_added', {
        fileId: entry.fileId,
        size: entry.size,
        batchId: this.batch!.batchId,
        readerMs: t1 - t0,
        addMs,
        slabsBefore,
        slabsAfter: this.batch!.slabsFilled,
      })

      if (this.shouldFlushDueToLimits()) {
        await this.flush('max_slabs')
      }
    } catch (e) {
      if (needsRollback && this.batch) {
        const idx = this.batch.files.indexOf(entry)
        if (idx !== -1) {
          this.batch.files.splice(idx, 1)
          this.batch.totalSize -= entry.size
        }
      }
      const message = e instanceof Error ? e.message : String(e)
      logger.error('uploadManager', 'file_process_error', {
        fileId: entry.fileId,
        error: e as Error,
      })
      this.app.uploads.setError(entry.fileId, message)
      // Keep this.packer / this.batch alive — the SDK leaves the packer
      // usable after add() errors, so subsequent entries continue in the
      // same batch instead of orphaning already-successful adds.
    }
  }

  /**
   * Process entries with pipelined packer.add() calls. The SDK serializes
   * the actual pack+upload work, but firing multiple adds overlaps reader
   * creation and FFI call setup with the previous call's I/O.
   *
   * Each iteration either:
   * - Falls back to processEntry (creates packer, runs pre-flush checks)
   * - Fires a window of adds concurrently, awaiting in order
   *
   * computeWindowEnd simulates adding files to determine how many can
   * be added before a threshold/max_slabs flush would trigger.
   */
  private async processEntries(entries: FileEntry[]): Promise<void> {
    let i = 0

    while (i < entries.length && this.active && !this._suspended) {
      // computeWindowEnd needs a packer+batch — when neither exists or
      // when the next file would trigger a pre-flush, fall back to
      // processEntry which handles packer creation and pre-flush checks.
      const windowEnd = this.packer && this.batch ? this.computeWindowEnd(entries, i) : i

      if (windowEnd === i) {
        await this.processEntry(entries[i])
        i++
      } else {
        await this.processWindow(entries, i, windowEnd)
        i = windowEnd
      }

      if (this.batchExceedsDuration()) {
        await this.flush('max_duration')
      }
    }

    // Re-queue unprocessed entries so they're picked up on resume.
    // drainQueues() already removed them from the original queues.
    if (this._suspended && i < entries.length) {
      this.explicitQueue.unshift(...entries.slice(i))
    }
  }

  /**
   * Fire packer.add() for entries[from..end) concurrently, then await
   * each in order updating batch state after each completes.
   */
  private async processWindow(entries: FileEntry[], from: number, end: number): Promise<void> {
    const packer = this.packer!

    const inflight = []
    for (let j = from; j < end; j++) {
      // Stop launching new packer.add() calls on shutdown or suspension.
      if (!this.active || this._suspended) break
      const entry = entries[j]
      this.app.uploads.setStatus(entry.fileId, 'packing')
      logger.debug('uploadManager', 'file_packing', {
        fileId: entry.fileId,
        size: entry.size,
        batchId: this.batch!.batchId,
      })
      // Add to batch state before packer.add() so onProgress can
      // distribute progress while data streams to the network.
      this.batch!.files.push(entry)
      this.batch!.totalSize += entry.size
      const t0 = Date.now()
      const reader = this.adapters.createFileReader(entry.fileUri)
      inflight.push({
        entry,
        t0,
        readerMs: Date.now() - t0,
        promise: packer.add(reader),
      })
    }

    // Await each add in order. The SDK serializes the actual work, so
    // t1->t2 measures this file's queue wait + processing + any slab upload.
    for (const { entry, readerMs, promise } of inflight) {
      try {
        const t1 = Date.now()
        await promise
        // Exit after current add completes if shutting down or suspending.
        if (!this.active || !this.batch || this._suspended) break
        const t2 = Date.now()
        const addMs = t2 - t1
        const slabsBefore = this.batch.slabsFilled
        this.recordAdd(entry, addMs)
        logger.debug('uploadManager', 'file_added', {
          fileId: entry.fileId,
          size: entry.size,
          batchId: this.batch.batchId,
          readerMs,
          addMs,
          slabsBefore,
          slabsAfter: this.batch.slabsFilled,
        })

        if (this.shouldFlushDueToLimits()) {
          await this.flush('max_slabs')
        }
      } catch (e) {
        if (!this.active) break
        if (this.batch) {
          const idx = this.batch.files.indexOf(entry)
          if (idx !== -1) {
            this.batch.files.splice(idx, 1)
            this.batch.totalSize -= entry.size
          }
        }
        const message = e instanceof Error ? e.message : String(e)
        logger.error('uploadManager', 'file_process_error', {
          fileId: entry.fileId,
          error: e as Error,
        })
        this.app.uploads.setError(entry.fileId, message)
        // Abandon the rest of this window on first error; the loop below
        // attaches .catch so skipped in-flight promises don't surface as
        // unhandled rejections. Keep this.packer / this.batch alive — the
        // SDK leaves the packer usable after add() errors, so the next
        // entry continues in the same batch instead of orphaning its
        // already-successful adds.
        break
      }
    }

    // Prevent uncaught rejections on promises skipped due to early break
    for (const item of inflight) {
      item.promise.catch((e) => {
        logger.warn('uploadManager', 'abandoned_add_rejected', {
          fileId: item.entry.fileId,
          error: e as Error,
        })
      })
    }
  }

  /**
   * How many entries starting at `from` can be added to the current batch
   * without triggering a threshold or max_slabs flush. Returns the
   * exclusive end index, capped at from + 200.
   */
  private computeWindowEnd(entries: FileEntry[], from: number): number {
    let simulatedSize = this.batch!.totalSize
    const cap = Math.min(from + 200, entries.length)

    for (let j = from; j < cap; j++) {
      const size = entries[j].size
      const currentSlabs = Math.floor(simulatedSize / SLAB_SIZE)
      const newSlabs = Math.floor((simulatedSize + size) / SLAB_SIZE)
      const fillPct = (simulatedSize % SLAB_SIZE) / SLAB_SIZE

      // Would trigger threshold flush
      if (fillPct >= SLAB_FILL_THRESHOLD && newSlabs > currentSlabs) return j
      // Would trigger oversized pre-flush
      if (size > SLAB_SIZE && newSlabs >= PACKER_MAX_SLABS) return j

      simulatedSize += size

      // Hit max_slabs — include this file but stop the window
      if (Math.floor(simulatedSize / SLAB_SIZE) >= PACKER_MAX_SLABS) return j + 1
    }

    return cap
  }

  /**
   * Query DB for local-only files not yet being uploaded. Excludes files
   * already registered as active uploads at the SQL level so the LIMIT
   * returns actually-available files rather than re-fetching active ones.
   * Returns files ordered by createdAt ASC so photos are processed before
   * their thumbnails, naturally mixing sizes for efficient slab packing.
   *
   * @returns Number of new files added to the polledFiles queue.
   */
  private async isStorageFull(): Promise<boolean> {
    if (!this.app.connection.getState().isConnected) return false
    try {
      const account = await this.app.account()
      if (account.remainingStorage === 0n) {
        logger.warn('uploadManager', 'storage_full')
        return true
      }
      return false
    } catch {
      return false
    }
  }

  private async pollDB(): Promise<number> {
    if (!this.app.connection.getState().isConnected) return 0

    const autoScan = await this.app.settings.getAutoScanUploads()
    if (!autoScan) return 0

    try {
      const activeIds = this.app.uploads.getActiveIds()
      const indexerURL = await this.app.settings.getIndexerURL()
      const candidateFiles = await this.app.files.query({
        limit: 200,
        order: 'ASC',
        pinned: { indexerURL, isPinned: false },
        fileExistsLocally: true,
        hashNotEmpty: true,
        excludeIds: activeIds.length > 0 ? activeIds : undefined,
        activeOnly: true,
      })

      const newEntries: FileEntry[] = []
      for (const file of candidateFiles) {
        const fileUri = await this.app.fs.getFileUri(file)
        if (!fileUri) continue
        newEntries.push({ fileId: file.id, fileUri, file, size: file.size })
      }

      if (newEntries.length > 0) {
        this.app.uploads.registerMany(newEntries.map((e) => ({ id: e.fileId, size: e.size })))
        this.polledFiles.push(...newEntries)
      }

      return this.polledFiles.length
    } catch (e) {
      logger.error('uploadManager', 'db_poll_error', { error: e as Error })
      return 0
    }
  }

  /** Signal the loop to stop waiting and check queues immediately. */
  private wake(): void {
    if (this.wakeResolver) {
      this.wakeResolver()
      this.wakeResolver = null
    }
  }

  /**
   * Block until either wake() is called or the timeout elapses.
   * Used by the loop to idle-wait between poll cycles or before flushing.
   */
  private waitForWorkOrTimeout(ms: number): Promise<'woken' | 'timeout'> {
    return new Promise<'woken' | 'timeout'>((resolve) => {
      const timer = setTimeout(() => {
        this.wakeResolver = null
        resolve('timeout')
      }, ms)

      this.wakeResolver = () => {
        clearTimeout(timer)
        resolve('woken')
      }
    })
  }

  /** Update batch state after a successful packer.add(). */
  private recordAdd(entry: FileEntry, addMs: number): void {
    this.batch!.lastProcessedAt = Date.now()
    this._packedCount++
    this._packedBytes += entry.size
    this.app.uploads.setStatus(entry.fileId, 'packed')
    const slabsBefore = this.batch!.slabsFilled
    this.batch!.slabsFilled = Math.floor(this.batch!.totalSize / SLAB_SIZE)
    this.batch!.totalAddMs += addMs
    if (this.batch!.slabsFilled > slabsBefore) this.batch!.slabUploadAdds++
  }

  private batchExceedsDuration(): boolean {
    if (!this.batch) return false
    const elapsed = Date.now() - this.batch.startedAt - this.batch.suspendedMs
    return elapsed >= PACKER_MAX_BATCH_DURATION
  }

  /** True when the batch has filled enough slabs to warrant flushing. */
  private shouldFlushDueToLimits(): boolean {
    if (!this.batch) return false
    return this.batch.slabsFilled >= PACKER_MAX_SLABS
  }

  /**
   * True when the current slab is well-filled (>= SLAB_FILL_THRESHOLD) and
   * adding fileSize bytes would cross into a new slab. Flushing at this
   * point preserves the efficient packing of the current slab rather than
   * letting the new file straddle a boundary and waste the remaining space.
   */
  private shouldFlushBeforeAdding(fileSize: number): boolean {
    if (!this.batch) return false

    const currentFill = this.getCurrentSlabFillPercent()
    const currentSlabs = Math.floor(this.batch.totalSize / SLAB_SIZE)
    const newSlabs = Math.floor((this.batch.totalSize + fileSize) / SLAB_SIZE)
    const wouldCrossBoundary = newSlabs > currentSlabs

    return currentFill >= SLAB_FILL_THRESHOLD && wouldCrossBoundary
  }

  /** How full the current (partial) slab is, as a fraction 0-1. */
  private getCurrentSlabFillPercent(): number {
    if (!this.batch) return 0
    return (this.batch.totalSize % SLAB_SIZE) / SLAB_SIZE
  }

  /**
   * Per-shard progress from the SDK. Each callback reports one uploaded
   * shard's size; we accumulate into batch.uploadedShardBytes and divide
   * by the expected encoded size (slabs × (data+parity) shards × SECTOR_SIZE)
   * to produce a batch-level progress fraction, then distribute across
   * files by size weight.
   */
  private onShardUploaded(batch: BatchState, p: ShardProgress): void {
    batch.uploadedShardBytes += Number(p.shardSize)
    const slabs = Math.ceil(batch.totalSize / SLAB_SIZE)
    const expectedEncoded = slabs * (UPLOAD_DATA_SHARDS + UPLOAD_PARITY_SHARDS) * SECTOR_SIZE
    const batchProgress = expectedEncoded > 0 ? batch.uploadedShardBytes / expectedEncoded : 0

    const batchInfo: BatchInfo = {
      files: batch.files.map((f) => ({
        fileId: f.fileId,
        size: f.size,
      })),
      totalSize: batch.totalSize,
    }

    for (const entry of batch.files) {
      const fileProgress = calculateFileProgress(batchInfo, batchProgress, entry.fileId)
      if (this.progressThrottle) {
        this.progressThrottle(entry.fileId, fileProgress)
      } else {
        this.app.uploads.update(entry.fileId, { progress: fileProgress })
      }
    }
  }

  /**
   * After finalize, pin each object and save it locally. Files deleted
   * during upload are skipped (their upload entry is still cleaned up).
   *
   * Three phases:
   * 1. Parallel pin — up to SAVE_BATCH_CONCURRENCY concurrent pinObject calls
   * 2. Batch DB write — single transaction for all local objects
   * 3. Remove completed uploads
   */
  private async saveBatchObjects(
    batch: BatchState,
    pinnedObjects: PinnedObjectRef[],
  ): Promise<string[]> {
    if (pinnedObjects.length !== batch.files.length) {
      logger.warn('uploadManager', 'object_count_mismatch', {
        objects: pinnedObjects.length,
        files: batch.files.length,
      })
    }

    const sdk = this.internal.requireSdk()
    const indexerURL = await this.app.settings.getIndexerURL()

    type PinResult =
      | {
          type: 'success'
          fileId: string
          size: number
          localObject: LocalObjectWithSlabs
        }
      | { type: 'deleted'; fileId: string }
      | { type: 'error'; fileId: string }
      | { type: 'missing'; fileId: string }

    // Phase 1: Parallel pin
    const pool = new SlotPool(SAVE_BATCH_CONCURRENCY)
    const results = await Promise.all(
      batch.files.map((entry, i) =>
        pool.withSlot(async (): Promise<PinResult> => {
          const pinnedObject = pinnedObjects[i]
          if (!pinnedObject) {
            logger.error('uploadManager', 'no_pinned_object', {
              fileId: entry.fileId,
              index: i,
            })
            this.app.uploads.setError(entry.fileId, 'No pinned object returned')
            return { type: 'missing', fileId: entry.fileId }
          }

          try {
            const metadata = await this.app.files.getMetadata(entry.fileId)
            if (!metadata) {
              logger.warn('uploadManager', 'file_deleted_during_upload', {
                fileId: entry.fileId,
              })
              return { type: 'deleted', fileId: entry.fileId }
            }
            pinnedObject.updateMetadata(encodeFileMetadata(metadata))
            await retry('pinObject', () => sdk.pinObject(pinnedObject), 3, 1000)

            const appKey = sdk.appKey()
            const localObject = sealPinnedObject(entry.fileId, indexerURL, pinnedObject, appKey)
            logger.debug('uploadManager', 'object_saved', {
              fileId: entry.fileId,
            })
            return {
              type: 'success',
              fileId: entry.fileId,
              size: entry.size,
              localObject,
            }
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e)
            logger.error('uploadManager', 'object_save_error', {
              fileId: entry.fileId,
              error: e as Error,
            })
            this.app.uploads.setError(entry.fileId, message)
            return { type: 'error', fileId: entry.fileId }
          }
        }),
      ),
    )

    // Phase 2: Batch DB write
    const localObjects = results
      .filter((r): r is Extract<PinResult, { type: 'success' }> => r.type === 'success')
      .map((r) => r.localObject)
    await this.app.localObjects.upsertMany(localObjects, {
      skipInvalidation: true,
    })

    for (const r of results) {
      if (r.type === 'success') {
        this._uploadedCount++
        this._uploadedBytes += r.size
      }
    }

    // Bump updatedAt on successfully uploaded files so sync-up picks them
    // up even if the cursor already advanced past their previous updatedAt
    // (e.g., file was assigned to a directory before upload finished).
    const successfulFileIds = results
      .filter((r) => r.type !== 'error' && r.type !== 'missing')
      .map((r) => r.fileId)
    if (successfulFileIds.length > 0) {
      const now = Date.now()
      await this.app.files.updateMany(
        successfulFileIds.map((id) => ({ id, updatedAt: now })),
        { includeUpdatedAt: true, skipCurrentRecalc: true },
      )
    }

    // Phase 3: Invalidate cache then remove completed uploads.
    // Invalidation must happen before removal so the file record refreshes
    // with the sealed object before the uploading state clears — otherwise
    // the UI briefly shows a "needs upload" icon.
    if (successfulFileIds.length > 0) {
      this.app.caches.library.invalidateAll()
      this.app.caches.libraryVersion.invalidate()
      this._needsInvalidation = false
      if (SAVE_REMOVAL_DELAY_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, SAVE_REMOVAL_DELAY_MS))
      }
      this.app.uploads.removeMany(successfulFileIds)
    }

    return successfulFileIds
  }
}

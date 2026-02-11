import { useCallback } from 'react'
import type {
  PackedUploadInterface,
  PinnedObjectInterface,
  SdkInterface,
} from 'react-native-sia'
import {
  PACKER_IDLE_TIMEOUT,
  PACKER_MAX_BATCH_DURATION,
  PACKER_MAX_SLABS,
  PACKER_POLL_INTERVAL,
  SLAB_FILL_THRESHOLD,
  SLAB_SIZE,
  UPLOAD_DATA_SHARDS,
  UPLOAD_MAX_INFLIGHT,
  UPLOAD_PARITY_SHARDS,
} from '../config'
import { encodeFileMetadata } from '../encoding/fileMetadata'
import { createFileReader } from '../lib/fileReader'
import { pinnedObjectToLocalObject } from '../lib/localObjects'
import { logger } from '../lib/logger'
import { uniqueId } from '../lib/uniqueId'
import { calculateFileProgress } from '../lib/uploadProgress'
import {
  type FileRecordRow,
  getFilesLocalOnly,
  readFileRecord,
} from '../stores/files'
import { getFsFileUri } from '../stores/fs'
import { upsertLocalObject } from '../stores/localObjects'
import { getIsConnected, getSdk, useSdk } from '../stores/sdk'
import { getAutoScanUploads } from '../stores/settings'
import {
  getActiveUploads,
  registerUpload,
  removeUpload,
  setUploadBatchInfo,
  setUploadError,
  setUploadStatus,
  updateUploadProgress,
} from '../stores/uploads'

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
 * - slab_threshold: current slab ≥90% full and next file crosses boundary
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
  /** Timestamp of last successful packer.add() — used to detect suspension gaps. */
  lastProcessedAt: number
  abortController: AbortController
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
class UploadManager {
  /** SDK handle for network operations; set by initialize(). */
  private sdk: SdkInterface | null = null
  /** Native packed upload handle; null when no batch is open. */
  private packer: PackedUploadInterface | null = null
  /** The batch currently being packed (accumulating files). */
  private batch: BatchState | null = null
  /** The batch currently being finalized/uploaded (after flush, before pin). */
  private uploadingBatch: BatchState | null = null
  /** Base URL for the indexer service; used when saving pinned objects. */
  private indexerURL: string = ''
  /** Files added via enqueue() — processed before polled files. */
  private explicitQueue: FileEntry[] = []
  /** Files discovered by pollDB() — processed after explicit queue. */
  private polledFiles: FileEntry[] = []
  /** Whether the async loop is running; set false by shutdown() to exit. */
  private active = false
  /** Resolves the waitForWorkOrTimeout promise when wake() is called. */
  private wakeResolver: (() => void) | null = null
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

  /** Connect to the SDK and start the async processing loop. */
  initialize(sdk: SdkInterface, indexerURL: string): void {
    this.sdk = sdk
    this.indexerURL = indexerURL
    this.startLoop()
  }

  /** Add files to the explicit queue and wake the loop. */
  enqueue(files: FileEntry[]): void {
    for (const file of files) {
      registerUpload(file.fileId)
    }
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
    reason:
      | 'idle_timeout'
      | 'max_duration'
      | 'max_slabs'
      | 'slab_threshold'
      | 'manual' = 'manual',
  ): Promise<void> {
    if (!this.packer || !this.batch) {
      logger.debug('uploadManager', 'no_packer_to_flush')
      return
    }

    const batch = this.batch
    const packer = this.packer

    // Move batch to uploadingBatch so shutdown() can cancel it separately
    this.uploadingBatch = batch
    this.packer = null
    this.batch = null

    const durationMs = Date.now() - batch.startedAt
    const durationSec = (durationMs / 1000).toFixed(1)
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
      fillPercent: `${fillPercent}%`,
      durationSec,
    })

    try {
      const fileCount = batch.files.length
      for (const entry of batch.files) {
        setUploadBatchInfo(entry.fileId, batch.batchId, fileCount)
        setUploadStatus(entry.fileId, 'uploading')
      }

      const finalizeStart = Date.now()
      const pinnedObjects = await packer.finalize({
        signal: batch.abortController.signal,
      })
      logger.info('uploadManager', 'batch_finalized', {
        batchId: batch.batchId,
        objects: pinnedObjects.length,
        finalizeMs: Date.now() - finalizeStart,
      })

      const saveStart = Date.now()
      const successfulFileIds = await this.saveBatchObjects(
        batch,
        pinnedObjects,
      )
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
        setUploadError(entry.fileId, message)
      }
    } finally {
      this.uploadingBatch = null
    }
  }

  /** Stop the loop, abort in-flight batches, and clean up upload state. */
  shutdown(): void {
    this.active = false

    if (this.batch) {
      logger.info('uploadManager', 'batch_cancel', {
        batchId: this.batch.batchId,
      })
      this.batch.abortController.abort()
      for (const entry of this.batch.files) {
        removeUpload(entry.fileId)
      }
    }

    if (this.uploadingBatch) {
      logger.info('uploadManager', 'uploading_batch_cancel', {
        batchId: this.uploadingBatch.batchId,
      })
      this.uploadingBatch.abortController.abort()
      for (const entry of this.uploadingBatch.files) {
        removeUpload(entry.fileId)
      }
    }

    for (const entry of this.explicitQueue) {
      removeUpload(entry.fileId)
    }
    this.explicitQueue = []
    this.polledFiles = []

    this.packer = null
    this.batch = null

    this.wake()
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
    this.explicitQueue = []
    this.polledFiles = []
    this.sdk = null
    this.indexerURL = ''
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
    for (const file of files) {
      registerUpload(file.fileId)
      await this.processEntry(file)
    }
  }

  private drainQueues(first: FileEntry): FileEntry[] {
    const entries = [first]
    for (;;) {
      const next =
        this.explicitQueue.shift() ?? this.polledFiles.shift() ?? undefined
      if (!next) break
      entries.push(next)
    }
    return entries
  }

  private startLoop(): void {
    if (this.active) return
    this.active = true
    this.runLoop()
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
      const next =
        this.explicitQueue.shift() ?? this.polledFiles.shift() ?? null

      if (next) {
        await this.processEntries(this.drainQueues(next))
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
   * 1. Threshold flush: if the current slab is ≥90% full and this file
   *    would cross into a new slab, flush now to avoid wasting the
   *    well-filled slab by continuing to accumulate.
   * 2. Oversized pre-flush: if this file is larger than SLAB_SIZE and
   *    adding it would push the batch past PACKER_MAX_SLABS, flush the
   *    existing batch first so the oversized file gets its own batch.
   *
   * After adding, if slabsFilled >= PACKER_MAX_SLABS, flush immediately.
   */
  private async processEntry(entry: FileEntry): Promise<void> {
    if (!this.sdk) {
      logger.error('uploadManager', 'sdk_not_initialized')
      setUploadError(entry.fileId, 'SDK not initialized')
      return
    }

    try {
      if (this.batch && this.shouldFlushBeforeAdding(entry.size)) {
        await this.flush('slab_threshold')
      }

      // Oversized file pre-flush: if the batch already has files and adding
      // this large file would exceed max slabs, flush the existing batch first.
      // Only triggers for files > SLAB_SIZE to avoid splitting normal accumulation.
      if (this.batch && this.batch.files.length > 0 && entry.size > SLAB_SIZE) {
        const projectedSlabs = Math.floor(
          (this.batch.totalSize + entry.size) / SLAB_SIZE,
        )
        if (projectedSlabs >= PACKER_MAX_SLABS) {
          await this.flush('max_slabs')
        }
      }

      if (!this.packer) {
        logger.info('uploadManager', 'packer_create')
        const batch: BatchState = {
          batchId: uniqueId(),
          files: [],
          totalSize: 0,
          slabsFilled: 0,
          startedAt: Date.now(),
          lastProcessedAt: 0,
          abortController: new AbortController(),
        }
        this.batch = batch
        this.packer = await this.sdk.uploadPacked(
          {
            maxInflight: UPLOAD_MAX_INFLIGHT,
            dataShards: UPLOAD_DATA_SHARDS,
            parityShards: UPLOAD_PARITY_SHARDS,
            progressCallback: {
              progress: (uploaded, total) =>
                this.onProgress(batch, uploaded, total),
            },
          },
          { signal: batch.abortController.signal },
        )
      }

      setUploadStatus(entry.fileId, 'packing')
      logger.debug('uploadManager', 'file_packing', {
        fileId: entry.fileId,
        size: entry.size,
      })

      const t0 = Date.now()
      const reader = createFileReader(entry.fileUri)
      const t1 = Date.now()
      await this.packer.add(reader, {
        signal: this.batch!.abortController.signal,
      })
      const t2 = Date.now()
      const slabsBefore = this.batch!.slabsFilled
      this.recordAdd(entry)
      logger.info('uploadManager', 'file_added', {
        fileId: entry.fileId,
        size: entry.size,
        batchId: this.batch!.batchId,
        readerMs: t1 - t0,
        addMs: t2 - t1,
        slabsBefore,
        slabsAfter: this.batch!.slabsFilled,
      })

      if (this.shouldFlushDueToLimits()) {
        await this.flush('max_slabs')
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      logger.error('uploadManager', 'file_process_error', {
        fileId: entry.fileId,
        error: e as Error,
      })
      setUploadError(entry.fileId, message)
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

    while (i < entries.length && this.active) {
      // computeWindowEnd needs a packer+batch — when neither exists or
      // when the next file would trigger a pre-flush, fall back to
      // processEntry which handles packer creation and pre-flush checks.
      const windowEnd =
        this.packer && this.batch ? this.computeWindowEnd(entries, i) : i

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
  }

  /**
   * Fire packer.add() for entries[from..end) concurrently, then await
   * each in order updating batch state after each completes.
   */
  private async processWindow(
    entries: FileEntry[],
    from: number,
    end: number,
  ): Promise<void> {
    const packer = this.packer!
    const signal = this.batch!.abortController.signal

    const inflight = []
    for (let j = from; j < end; j++) {
      if (!this.active) break
      const entry = entries[j]
      setUploadStatus(entry.fileId, 'packing')
      logger.debug('uploadManager', 'file_packing', {
        fileId: entry.fileId,
        size: entry.size,
      })
      const t0 = Date.now()
      const reader = createFileReader(entry.fileUri)
      inflight.push({
        entry,
        t0,
        readerMs: Date.now() - t0,
        promise: packer.add(reader, { signal }),
      })
    }

    // Await each add in order. The SDK serializes the actual work, so
    // t1→t2 measures this file's queue wait + processing + any slab upload.
    for (const { entry, readerMs, promise } of inflight) {
      try {
        const t1 = Date.now()
        await promise
        if (!this.active || !this.batch) break
        const t2 = Date.now()
        const slabsBefore = this.batch.slabsFilled
        this.recordAdd(entry)
        logger.info('uploadManager', 'file_added', {
          fileId: entry.fileId,
          size: entry.size,
          batchId: this.batch.batchId,
          readerMs,
          addMs: t2 - t1,
          slabsBefore,
          slabsAfter: this.batch.slabsFilled,
        })

        if (this.shouldFlushDueToLimits()) {
          await this.flush('max_slabs')
        }
      } catch (e) {
        if (!this.active) break
        const message = e instanceof Error ? e.message : String(e)
        logger.error('uploadManager', 'file_process_error', {
          fileId: entry.fileId,
          error: e as Error,
        })
        setUploadError(entry.fileId, message)
      }
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
      if (Math.floor(simulatedSize / SLAB_SIZE) >= PACKER_MAX_SLABS)
        return j + 1
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
  private async pollDB(): Promise<number> {
    if (!this.sdk) return 0

    const isConnected = getIsConnected()
    if (!isConnected) return 0

    const autoScan = await getAutoScanUploads()
    if (!autoScan) return 0

    try {
      const activeUploads = getActiveUploads()
      const activeIds = activeUploads.map((u) => u.id)

      const candidateFiles = await getFilesLocalOnly({
        limit: 200,
        order: 'ASC',
        excludeIds: activeIds.length > 0 ? activeIds : undefined,
      })

      for (const file of candidateFiles) {
        const fileUri = await getFsFileUri(file)
        if (!fileUri) continue
        const entry: FileEntry = {
          fileId: file.id,
          fileUri,
          file,
          size: file.size,
        }
        registerUpload(entry.fileId)
        this.polledFiles.push(entry)
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

  /**
   * Update batch state after a successful packer.add(). Detects suspension
   * gaps (time between adds exceeding PACKER_IDLE_TIMEOUT) and adjusts
   * startedAt so suspended time doesn't count toward max_duration.
   */
  private recordAdd(entry: FileEntry): void {
    const now = Date.now()
    if (this.batch!.lastProcessedAt > 0) {
      const gap = now - this.batch!.lastProcessedAt
      if (gap > PACKER_IDLE_TIMEOUT) {
        this.batch!.startedAt += gap
      }
    }
    this.batch!.lastProcessedAt = now

    this.batch!.files.push(entry)
    this.batch!.totalSize += entry.size
    this._packedCount++
    this._packedBytes += entry.size
    setUploadStatus(entry.fileId, 'packed')
    this.batch!.slabsFilled = Math.floor(this.batch!.totalSize / SLAB_SIZE)
  }

  private batchExceedsDuration(): boolean {
    if (!this.batch) return false
    return Date.now() - this.batch.startedAt >= PACKER_MAX_BATCH_DURATION
  }

  /** True when the batch has filled enough slabs to warrant flushing. */
  private shouldFlushDueToLimits(): boolean {
    if (!this.batch) return false
    return this.batch.slabsFilled >= PACKER_MAX_SLABS
  }

  /**
   * True when the current slab is well-filled (≥ SLAB_FILL_THRESHOLD) and
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

  /** How full the current (partial) slab is, as a fraction 0–1. */
  private getCurrentSlabFillPercent(): number {
    if (!this.batch) return 0
    return (this.batch.totalSize % SLAB_SIZE) / SLAB_SIZE
  }

  /** Distribute batch upload progress across individual files by size weight. */
  private onProgress(
    batch: BatchState,
    uploaded: bigint,
    encodedTotal: bigint,
  ): void {
    const batchProgress =
      encodedTotal > 0n ? Number(uploaded) / Number(encodedTotal) : 0

    const batchInfo = {
      files: batch.files.map((f) => ({
        fileId: f.fileId,
        size: f.size,
      })),
      totalSize: batch.totalSize,
    }

    for (const entry of batch.files) {
      const fileProgress = calculateFileProgress(
        batchInfo,
        batchProgress,
        entry.fileId,
      )
      updateUploadProgress(entry.fileId, fileProgress)
    }
  }

  /**
   * After finalize, pin each object and save it locally. Files deleted
   * during upload are skipped (their upload entry is still cleaned up).
   */
  private async saveBatchObjects(
    batch: BatchState,
    pinnedObjects: PinnedObjectInterface[],
  ): Promise<string[]> {
    const successfulFileIds: string[] = []

    if (pinnedObjects.length !== batch.files.length) {
      logger.warn('uploadManager', 'object_count_mismatch', {
        objects: pinnedObjects.length,
        files: batch.files.length,
      })
    }

    for (let i = 0; i < batch.files.length; i++) {
      const entry = batch.files[i]
      const pinnedObject = pinnedObjects[i]

      if (!pinnedObject) {
        logger.error('uploadManager', 'no_pinned_object', {
          fileId: entry.fileId,
          index: i,
        })
        setUploadError(entry.fileId, 'No pinned object returned')
        continue
      }

      try {
        const fileRecord = await readFileRecord(entry.fileId)
        if (!fileRecord) {
          logger.warn('uploadManager', 'file_deleted_during_upload', {
            fileId: entry.fileId,
          })
          removeUpload(entry.fileId)
          successfulFileIds.push(entry.fileId)
          continue
        }

        pinnedObject.updateMetadata(encodeFileMetadata(entry.file))
        await this.sdk!.pinObject(pinnedObject)

        const localObject = await pinnedObjectToLocalObject(
          entry.fileId,
          this.indexerURL,
          pinnedObject,
        )
        await upsertLocalObject(localObject)
        removeUpload(entry.fileId)

        logger.debug('uploadManager', 'object_saved', { fileId: entry.fileId })
        this._uploadedCount++
        this._uploadedBytes += entry.size
        successfulFileIds.push(entry.fileId)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        logger.error('uploadManager', 'object_save_error', {
          fileId: entry.fileId,
          error: e as Error,
        })
        setUploadError(entry.fileId, message)
      }
    }

    return successfulFileIds
  }
}

let uploadManager: UploadManager | null = null

/** Returns the singleton UploadManager, creating it on first access. */
export function getUploadManager(): UploadManager {
  if (!uploadManager) {
    uploadManager = new UploadManager()
  }
  return uploadManager
}

/** React hook: returns a callback that enqueues files for upload. */
export function useUploader() {
  const sdk = useSdk()

  return useCallback(
    async (files: FileRecordRow[]) => {
      if (!sdk) {
        logger.warn('useUploader', 'sdk_not_initialized')
        return
      }

      const entries: FileEntry[] = []
      for (const file of files) {
        const fileUri = await getFsFileUri(file)
        if (!fileUri) {
          logger.warn('useUploader', 'file_not_local', { fileId: file.id })
          continue
        }
        entries.push({ fileId: file.id, fileUri, file, size: file.size })
      }

      if (entries.length > 0) {
        getUploadManager().enqueue(entries)
      }
    },
    [sdk],
  )
}

/** Re-enqueue a single file for upload (e.g. after a previous failure). */
export async function reuploadFile(fileId: string): Promise<void> {
  const sdk = getSdk()
  if (!sdk) throw new Error('SDK not initialized')

  const file = await readFileRecord(fileId)
  if (!file) throw new Error('File not found')

  const fileUri = await getFsFileUri(file)
  if (!fileUri) throw new Error('File not available locally')

  getUploadManager().enqueue([
    { fileId: file.id, fileUri, file, size: file.size },
  ])
}

/** React hook wrapper for reuploadFile. */
export function useReuploadFile() {
  return useCallback(async (fileId: string) => {
    await reuploadFile(fileId)
  }, [])
}

/** Enqueue a file by ID if it exists locally and SDK is available. */
export async function queueUploadForFileId(fileId: string): Promise<void> {
  const sdk = getSdk()
  if (!sdk) return

  const file = await readFileRecord(fileId)
  if (!file) return

  const fileUri = await getFsFileUri(file)
  if (!fileUri) return

  getUploadManager().enqueue([
    { fileId: file.id, fileUri, file, size: file.size },
  ])
}

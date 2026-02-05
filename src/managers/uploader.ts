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
import { type FileRecordRow, readFileRecord } from '../stores/files'
import { getFsFileUri } from '../stores/fs'
import { upsertLocalObject } from '../stores/localObjects'
import { getSdk, useSdk } from '../stores/sdk'
import {
  registerUpload,
  removeUpload,
  removeUploads,
  setUploadBatchInfo,
  setUploadError,
  setUploadStatus,
  updateUploadProgress,
} from '../stores/uploads'

export type FileEntry = {
  fileId: string
  fileUri: string
  file: FileRecordRow
  size: number
}

type BatchState = {
  batchId: string
  files: FileEntry[]
  totalSize: number
  slabsFilled: number // Number of slabs filled so far in this batch
  startedAt: number // Timestamp when batch was created
  abortController: AbortController // For cancelling batch operations
}

class UploadManager {
  private sdk: SdkInterface | null = null
  private packer: PackedUploadInterface | null = null
  private currentBatch: BatchState | null = null
  private uploadingBatch: BatchState | null = null // Batch currently being uploaded
  private idleTimer: NodeJS.Timeout | null = null
  private durationTimer: NodeJS.Timeout | null = null // Max duration timer
  private isProcessing = false
  private indexerURL: string = ''
  private pendingFiles: FileEntry[] = [] // Files queued while a batch is finalizing

  /**
   * Set SDK instance and indexer URL
   */
  initialize(sdk: SdkInterface, indexerURL: string): void {
    this.sdk = sdk
    this.indexerURL = indexerURL
  }

  /**
   * Queue multiple files at once (smart batching).
   * If a batch is currently finalizing, files are queued and processed after.
   */
  async queueFiles(files: FileEntry[]): Promise<void> {
    if (!this.sdk) {
      logger.warn('uploadManager', 'SDK not initialized, cannot queue files')
      return
    }

    // Register all files as queued
    for (const file of files) {
      registerUpload(file.fileId)
    }

    // If currently finalizing a batch, queue files for later to avoid concurrent uploads
    if (this.isProcessing) {
      logger.info(
        'uploadManager',
        `Batch finalizing, queuing ${files.length} files for later`,
      )
      this.pendingFiles.push(...files)
      return
    }

    // Process each file sequentially
    for (const entry of files) {
      await this.processFile(entry)
    }
  }

  /**
   * Internal: process a single file
   */
  private async processFile(entry: FileEntry): Promise<void> {
    if (!this.sdk) {
      logger.error('uploadManager', 'SDK not initialized')
      setUploadError(entry.fileId, 'SDK not initialized')
      return
    }

    try {
      // Check if we should flush before adding this file.
      // Flush if: current slab is >= threshold full AND adding this file would overflow.
      if (this.currentBatch && this.shouldFlushBeforeAdding(entry.size)) {
        await this.flush('slab_threshold')
      }

      // Initialize packer if needed
      if (!this.packer) {
        logger.info('uploadManager', 'Creating new packer')
        const batch: BatchState = {
          batchId: uniqueId(),
          files: [],
          totalSize: 0,
          slabsFilled: 0,
          startedAt: Date.now(),
          abortController: new AbortController(),
        }
        this.currentBatch = batch
        this.startDurationTimer()
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

      // Add file to packer
      setUploadStatus(entry.fileId, 'packing')
      logger.info(
        'uploadManager',
        `Adding file ${entry.fileId} to packer (${entry.size} bytes)`,
      )

      const reader = createFileReader(entry.fileUri)
      await this.packer.add(reader, {
        signal: this.currentBatch!.abortController.signal,
      })

      // Update batch state
      this.currentBatch?.files.push(entry)
      this.currentBatch!.totalSize += entry.size

      // Update batch info for all files in the batch
      const batchFileCount = this.currentBatch!.files.length
      for (const file of this.currentBatch?.files ?? []) {
        setUploadBatchInfo(
          file.fileId,
          this.currentBatch!.batchId,
          batchFileCount,
        )
      }

      setUploadStatus(entry.fileId, 'packed')

      // Check how many complete slabs we've filled
      const slabsFilled = Math.floor(this.currentBatch!.totalSize / SLAB_SIZE)
      this.currentBatch!.slabsFilled = slabsFilled

      logger.info(
        'uploadManager',
        `File ${
          entry.fileId
        } packed. Batch: ${batchFileCount} files, ${slabsFilled} slab(s), ${Math.round(
          this.getCurrentSlabFillPercent() * 100,
        )}% of current slab`,
      )

      // Check if we've hit max slabs limit
      if (this.shouldFlushDueToLimits()) {
        await this.flush('max_slabs')
        return
      }

      // Reset idle timer
      this.resetIdleTimer()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      logger.error('uploadManager', `Error processing file ${entry.fileId}`, e)
      setUploadError(entry.fileId, message)
    }
  }

  /**
   * Check if batch limits have been exceeded (max slabs).
   */
  private shouldFlushDueToLimits(): boolean {
    if (!this.currentBatch) return false
    return this.currentBatch.slabsFilled >= PACKER_MAX_SLABS
  }

  /**
   * Check if we should flush before adding a file of the given size.
   * Returns true if current slab is >= threshold full AND adding would overflow.
   */
  private shouldFlushBeforeAdding(fileSize: number): boolean {
    if (!this.currentBatch) return false

    const currentFill = this.getCurrentSlabFillPercent()
    const currentSlabs = Math.floor(this.currentBatch.totalSize / SLAB_SIZE)
    const newSlabs = Math.floor(
      (this.currentBatch.totalSize + fileSize) / SLAB_SIZE,
    )
    const wouldCrossBoundary = newSlabs > currentSlabs

    return currentFill >= SLAB_FILL_THRESHOLD && wouldCrossBoundary
  }

  /**
   * Get the fill percentage of the current partial slab (0.0 - 1.0).
   */
  private getCurrentSlabFillPercent(): number {
    if (!this.currentBatch) return 0
    return (this.currentBatch.totalSize % SLAB_SIZE) / SLAB_SIZE
  }

  /**
   * Progress callback for the packer. Takes batch as parameter to avoid stale
   * closure issues when this.currentBatch is set to null during flush.
   */
  private onProgress(
    batch: BatchState,
    uploaded: bigint,
    encodedTotal: bigint,
  ): void {
    // Calculate batch progress as a ratio
    const batchProgress =
      encodedTotal > 0n ? Number(uploaded) / Number(encodedTotal) : 0

    // Calculate batch info for progress calculation
    const batchInfo = {
      files: batch.files.map((f) => ({
        fileId: f.fileId,
        size: f.size,
      })),
      totalSize: batch.totalSize,
    }

    // Update progress for each file
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
   * Reset the idle timer
   */
  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
    }
    this.idleTimer = setTimeout(async () => {
      try {
        await this.flush('idle_timeout')
      } catch (error) {
        logger.error(
          'uploadManager',
          'Error flushing batch after idle timeout',
          error,
        )
      }
    }, PACKER_IDLE_TIMEOUT)
  }

  /**
   * Start the max duration timer for the current batch
   */
  private startDurationTimer(): void {
    if (this.durationTimer) {
      clearTimeout(this.durationTimer)
    }
    this.durationTimer = setTimeout(async () => {
      try {
        await this.flush('max_duration')
      } catch (error) {
        logger.error(
          'uploadManager',
          'Error flushing batch after duration timeout',
          error,
        )
      }
    }, PACKER_MAX_BATCH_DURATION)
  }

  /**
   * Flush current packer (finalize and save objects)
   * @param reason - What triggered the flush (for logging)
   */
  async flush(
    reason:
      | 'idle_timeout'
      | 'max_duration'
      | 'max_slabs'
      | 'slab_threshold'
      | 'manual' = 'manual',
  ): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    if (this.durationTimer) {
      clearTimeout(this.durationTimer)
      this.durationTimer = null
    }

    if (!this.packer || !this.currentBatch) {
      logger.debug('uploadManager', 'No packer to flush')
      return
    }

    if (this.isProcessing) {
      logger.debug('uploadManager', 'Already processing, skipping flush')
      return
    }

    this.isProcessing = true
    const batch = this.currentBatch
    const packer = this.packer

    // Track uploading batch so it can be cancelled
    this.uploadingBatch = batch

    // Clear state immediately so new files go to a new batch
    this.packer = null
    this.currentBatch = null

    // Calculate efficiency metrics
    const durationMs = Date.now() - batch.startedAt
    const durationSec = (durationMs / 1000).toFixed(1)
    const slabCapacity = (batch.slabsFilled + 1) * SLAB_SIZE
    const fillPercent = Math.round((batch.totalSize / slabCapacity) * 100)

    logger.info('uploadManager', 'Flushing batch', {
      reason,
      batchId: batch.batchId,
      files: batch.files.length,
      totalSize: batch.totalSize,
      slabsFilled: batch.slabsFilled,
      fillPercent: `${fillPercent}%`,
      durationSec,
    })

    try {
      // Set all files to uploading status
      for (const entry of batch.files) {
        setUploadStatus(entry.fileId, 'uploading')
      }

      // Finalize the packer - completes any partial slab upload and waits for all uploads
      const pinnedObjects = await packer.finalize({
        signal: batch.abortController.signal,
      })

      logger.info(
        'uploadManager',
        `Batch ${batch.batchId} finalized with ${pinnedObjects.length} objects`,
      )

      // Match objects to files and save, returns IDs of successfully saved files
      const successfulFileIds = await this.saveBatchObjects(
        batch,
        pinnedObjects,
      )

      // Remove only successful uploads from store
      // Files that errored during saveBatchObjects remain visible with error state
      removeUploads(successfulFileIds)

      logger.info(
        'uploadManager',
        `Batch ${batch.batchId} completed successfully`,
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      logger.error(
        'uploadManager',
        `Error finalizing batch ${batch.batchId}`,
        e,
      )

      // Mark all files in the batch as errored
      for (const entry of batch.files) {
        setUploadError(entry.fileId, message)
      }
    } finally {
      this.isProcessing = false
      this.uploadingBatch = null
      // Process any files that were queued while we were finalizing
      await this.processPendingFiles()
    }
  }

  /**
   * Process any files that were queued while a batch was finalizing.
   * This ensures uploads are serialized - only one packer uploads at a time.
   */
  private async processPendingFiles(): Promise<void> {
    if (this.pendingFiles.length === 0) {
      return
    }

    const files = this.pendingFiles
    this.pendingFiles = []

    logger.info(
      'uploadManager',
      `Processing ${files.length} files queued during finalize`,
    )

    for (const entry of files) {
      await this.processFile(entry)
    }
  }

  /**
   * Save all objects from a batch. Returns array of file IDs that were saved successfully.
   */
  private async saveBatchObjects(
    batch: BatchState,
    pinnedObjects: PinnedObjectInterface[],
  ): Promise<string[]> {
    const successfulFileIds: string[] = []

    // Objects are returned in add-order
    if (pinnedObjects.length !== batch.files.length) {
      logger.warn(
        'uploadManager',
        `Object count mismatch: ${pinnedObjects.length} objects for ${batch.files.length} files`,
      )
    }

    for (let i = 0; i < batch.files.length; i++) {
      const entry = batch.files[i]
      const pinnedObject = pinnedObjects[i]

      if (!pinnedObject) {
        logger.error(
          'uploadManager',
          `No pinned object for file ${entry.fileId} at index ${i}`,
        )
        setUploadError(entry.fileId, 'No pinned object returned')
        continue
      }

      try {
        // Update metadata on the pinned object
        pinnedObject.updateMetadata(encodeFileMetadata(entry.file))

        // Pin the object to the indexer (this saves slabs + object metadata)
        await this.sdk!.pinObject(pinnedObject)

        // Convert to local object and save
        const localObject = await pinnedObjectToLocalObject(
          entry.fileId,
          this.indexerURL,
          pinnedObject,
        )
        await upsertLocalObject(localObject)

        logger.debug('uploadManager', `Saved object for file ${entry.fileId}`)
        successfulFileIds.push(entry.fileId)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        logger.error(
          'uploadManager',
          `Error saving object for file ${entry.fileId}`,
          e,
        )
        setUploadError(entry.fileId, message)
      }
    }

    return successfulFileIds
  }

  /**
   * Shutdown the upload manager, cancelling all uploads.
   * Called when SDK is replaced or reset.
   */
  shutdown(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    if (this.durationTimer) {
      clearTimeout(this.durationTimer)
      this.durationTimer = null
    }

    // Cancel batch being packed
    if (this.currentBatch) {
      logger.info(
        'uploadManager',
        `Cancelling batch ${this.currentBatch.batchId}`,
      )
      this.currentBatch.abortController.abort()
      for (const entry of this.currentBatch.files) {
        removeUpload(entry.fileId)
      }
    }

    // Cancel batch being uploaded
    if (this.uploadingBatch) {
      logger.info(
        'uploadManager',
        `Cancelling uploading batch ${this.uploadingBatch.batchId}`,
      )
      this.uploadingBatch.abortController.abort()
      for (const entry of this.uploadingBatch.files) {
        removeUpload(entry.fileId)
      }
    }

    // Clear pending files
    for (const entry of this.pendingFiles) {
      removeUpload(entry.fileId)
    }
    this.pendingFiles = []

    this.packer = null
    this.currentBatch = null
  }

  /**
   * Get bytes remaining in current slab
   */
  async getSlabRemaining(): Promise<bigint> {
    if (!this.packer) {
      return BigInt(SLAB_SIZE)
    }
    return this.packer.remaining()
  }

  /**
   * Reset manager state (for testing)
   */
  reset(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    if (this.durationTimer) {
      clearTimeout(this.durationTimer)
      this.durationTimer = null
    }
    this.packer = null
    this.currentBatch = null
    this.uploadingBatch = null
    this.isProcessing = false
    this.pendingFiles = []
    this.sdk = null
    this.indexerURL = ''
  }
}

// Singleton instance
let uploadManager: UploadManager | null = null

export function getUploadManager(): UploadManager {
  if (!uploadManager) {
    uploadManager = new UploadManager()
  }
  return uploadManager
}

/**
 * Hook to provide an upload function.
 * Uploader is initialized when SDK is created (in sdk.ts).
 */
export function useUploader() {
  const sdk = useSdk()

  return useCallback(
    async (files: FileRecordRow[]) => {
      if (!sdk) {
        logger.warn('useUploader', 'SDK not initialized')
        return
      }

      const entries: FileEntry[] = []
      for (const file of files) {
        const fileUri = await getFsFileUri(file)
        if (!fileUri) {
          logger.warn('useUploader', `File not available locally: ${file.id}`)
          continue
        }
        entries.push({ fileId: file.id, fileUri, file, size: file.size })
      }

      if (entries.length > 0) {
        await getUploadManager().queueFiles(entries)
      }
    },
    [sdk],
  )
}

/**
 * Re-upload a single file
 */
export async function reuploadFile(fileId: string): Promise<void> {
  const sdk = getSdk()
  if (!sdk) throw new Error('SDK not initialized')

  const file = await readFileRecord(fileId)
  if (!file) throw new Error('File not found')

  const fileUri = await getFsFileUri(file)
  if (!fileUri) throw new Error('File not available locally')

  await getUploadManager().queueFiles([
    { fileId: file.id, fileUri, file, size: file.size },
  ])
}

/**
 * Hook to re-upload a single file by ID
 */
export function useReuploadFile() {
  return useCallback(async (fileId: string) => {
    await reuploadFile(fileId)
  }, [])
}

/**
 * Queue upload for a single file ID (used by scanner)
 */
export async function queueUploadForFileId(fileId: string): Promise<void> {
  const sdk = getSdk()
  if (!sdk) return

  const file = await readFileRecord(fileId)
  if (!file) return

  const fileUri = await getFsFileUri(file)
  if (!fileUri) return

  await getUploadManager().queueFiles([
    { fileId: file.id, fileUri, file, size: file.size },
  ])
}

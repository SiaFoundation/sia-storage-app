import { useCallback, useEffect } from 'react'
import type {
  PackedUploadInterface,
  PinnedObjectInterface,
  SdkInterface,
} from 'react-native-sia'
import {
  PACKER_IDLE_TIMEOUT,
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
import { getIndexerURL, useIndexerURL } from '../stores/settings'
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
}

class UploadManager {
  private sdk: SdkInterface | null = null
  private packer: PackedUploadInterface | null = null
  private currentBatch: BatchState | null = null
  private idleTimer: NodeJS.Timeout | null = null
  private isProcessing = false
  private indexerURL: string = ''

  /**
   * Set SDK instance and indexer URL
   */
  initialize(sdk: SdkInterface, indexerURL: string): void {
    this.sdk = sdk
    this.indexerURL = indexerURL
  }

  /**
   * Queue multiple files at once (smart batching)
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
        const fillPercent = this.getCurrentSlabFillPercent()
        logger.info(
          'uploadManager',
          `Slab ${Math.round(
            fillPercent * 100,
          )}% full, flushing before adding ${entry.size} byte file`,
        )
        await this.flush()
      }

      // Initialize packer if needed
      if (!this.packer) {
        logger.info('uploadManager', 'Creating new packer')
        this.packer = await this.sdk.uploadPacked({
          maxInflight: UPLOAD_MAX_INFLIGHT,
          dataShards: UPLOAD_DATA_SHARDS,
          parityShards: UPLOAD_PARITY_SHARDS,
          progressCallback: { progress: this.onProgress },
        })
        this.currentBatch = {
          batchId: uniqueId(),
          files: [],
          totalSize: 0,
          slabsFilled: 0,
        }
      }

      // Add file to packer
      setUploadStatus(entry.fileId, 'packing')
      logger.info(
        'uploadManager',
        `Adding file ${entry.fileId} to packer (${entry.size} bytes)`,
      )

      const reader = createFileReader(entry.fileUri)
      await this.packer.add(reader)

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

      // Reset idle timer
      this.resetIdleTimer()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      logger.error('uploadManager', `Error processing file ${entry.fileId}`, e)
      setUploadError(entry.fileId, message)
    }
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
   * Progress callback for the packer
   */
  private onProgress = (uploaded: bigint, encodedTotal: bigint) => {
    if (!this.currentBatch) return

    // Calculate batch progress as a ratio
    const batchProgress =
      encodedTotal > 0n ? Number(uploaded) / Number(encodedTotal) : 0

    // Calculate batch info for progress calculation
    const batchInfo = {
      files: this.currentBatch.files.map((f) => ({
        fileId: f.fileId,
        size: f.size,
      })),
      totalSize: this.currentBatch.totalSize,
    }

    // Update progress for each file
    for (const entry of this.currentBatch.files) {
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
    this.idleTimer = setTimeout(() => {
      logger.info('uploadManager', 'Idle timeout reached, flushing batch')
      this.flush()
    }, PACKER_IDLE_TIMEOUT)
  }

  /**
   * Flush current packer (finalize and save objects)
   */
  async flush(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
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

    // Clear state immediately so new files go to a new batch
    this.packer = null
    this.currentBatch = null

    logger.info(
      'uploadManager',
      `Flushing batch ${batch.batchId} with ${batch.files.length} files`,
    )

    try {
      // Set all files to uploading status
      for (const entry of batch.files) {
        setUploadStatus(entry.fileId, 'uploading')
      }

      // Finalize the packer - this uploads all slabs to the network
      const pinnedObjects = await packer.finalize()

      logger.info(
        'uploadManager',
        `Batch ${batch.batchId} finalized with ${pinnedObjects.length} objects`,
      )

      // Match objects to files and save
      await this.saveBatchObjects(batch, pinnedObjects)

      // Remove all uploads from store atomically (success)
      // This ensures all files in the batch show as complete at the same time
      removeUploads(batch.files.map((entry) => entry.fileId))

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
    }
  }

  /**
   * Save all objects from a batch
   */
  private async saveBatchObjects(
    batch: BatchState,
    pinnedObjects: PinnedObjectInterface[],
  ): Promise<void> {
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

        // Convert to local object and save
        const localObject = await pinnedObjectToLocalObject(
          entry.fileId,
          this.indexerURL,
          pinnedObject,
        )
        await upsertLocalObject(localObject)

        logger.debug('uploadManager', `Saved object for file ${entry.fileId}`)
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
  }

  /**
   * Cancel current batch
   */
  cancelBatch(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }

    if (this.currentBatch) {
      logger.info(
        'uploadManager',
        `Cancelling batch ${this.currentBatch.batchId}`,
      )
      for (const entry of this.currentBatch.files) {
        removeUpload(entry.fileId)
      }
    }

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
    this.packer = null
    this.currentBatch = null
    this.isProcessing = false
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
 * Hook to initialize the upload manager and provide an upload function
 */
export function useUploader() {
  const sdk = useSdk()
  const indexerURL = useIndexerURL()

  useEffect(() => {
    if (sdk && indexerURL.data) {
      getUploadManager().initialize(sdk, indexerURL.data)
    }
  }, [sdk, indexerURL.data])

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

  const indexerURL = await getIndexerURL()
  getUploadManager().initialize(sdk, indexerURL)

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

  const indexerURL = await getIndexerURL()
  getUploadManager().initialize(sdk, indexerURL)

  await getUploadManager().queueFiles([
    { fileId: file.id, fileUri, file, size: file.size },
  ])
}

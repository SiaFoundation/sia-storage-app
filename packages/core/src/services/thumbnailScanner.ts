import { logger } from '@siastorage/logger'
import type { AppService } from '../app/service'
import { uniqueId } from '../lib/uniqueId'
import { yieldToEventLoop } from '../lib/yieldToEventLoop'
import type { FileRecord, ThumbSize } from '../types/files'
import { ThumbSizes } from '../types/files'

export type ThumbnailCandidateRow = {
  id: string
  hash: string
  type: string
  localId: string | null
  createdAt: number
}

export type ThumbnailAttempt = {
  originalId: string
  originalHash: string
  size: ThumbSize
}

export type ProducedThumbnail = ThumbnailAttempt & {
  thumbId: string
}

export type ThumbnailGenerationError = ThumbnailAttempt & {
  error: unknown
}

export type ThumbnailScannerResult = {
  processedCandidates: number
  attempts: ThumbnailAttempt[]
  produced: ProducedThumbnail[]
  skippedNoSource: Array<{ fileId: string; hash: string }>
  skippedFullyCovered: Array<{ fileId: string; hash: string }>
  skippedErrorCooldown: Array<{ fileId: string; hash: string }>
  errors: ThumbnailGenerationError[]
}

export type EnsureThumbnailParams = {
  fileId: string
  fileHash: string
  fileType: string
  fileLocalId: string | null
  size: ThumbSize
  sourceUri: string
}

export type EnsureResult =
  | { status: 'exists' }
  | {
      status: 'produced'
      thumbId: string
      width: number | null
      height: number | null
    }
  | { status: 'error'; error: unknown }

const MAX_THUMBS_PER_TICK = 20
const ERROR_COOLDOWN_MS = 60 * 60 * 1000 // 1 hour

export function computeTargetDimensions(
  sourceWidth: number | null | undefined,
  sourceHeight: number | null | undefined,
  size: ThumbSize,
): { targetWidth?: number; targetHeight?: number } {
  if (
    typeof sourceWidth === 'number' &&
    typeof sourceHeight === 'number' &&
    sourceWidth > 0 &&
    sourceHeight > 0
  ) {
    const landscape = sourceWidth >= sourceHeight
    if (landscape) {
      return {
        targetWidth: size,
        targetHeight: Math.max(1, Math.round((sourceHeight * size) / sourceWidth)),
      }
    }
    return {
      targetHeight: size,
      targetWidth: Math.max(1, Math.round((sourceWidth * size) / sourceHeight)),
    }
  }
  return { targetWidth: size, targetHeight: undefined }
}

/**
 * Generates and stores thumbnails for files lacking them, prioritized
 * by recency and bounded per tick to avoid starving other services.
 *
 * Suspension signal policy: accepts AbortSignal. DB-holding loop — each
 * tick queries candidate files and writes thumbnails via app().files /
 * app().thumbs. Checks signal at loop boundaries so straggler workers
 * don't issue queries after the gate and hit DatabaseSuspendedError.
 */
export class ThumbnailScanner {
  private app: AppService | null = null
  private processingFiles = new Set<string>()
  private erroredFiles = new Map<string, number>()

  initialize(app: AppService): void {
    this.app = app
  }

  reset(): void {
    this.app = null
    this.processingFiles.clear()
    this.erroredFiles.clear()
  }

  isInitialized(): boolean {
    return this.app !== null
  }

  isFileBeingProcessed(fileId: string): boolean {
    return this.processingFiles.has(fileId)
  }

  isFileInErrorCooldown(fileId: string): boolean {
    const lastError = this.erroredFiles.get(fileId)
    if (!lastError) return false
    const elapsed = Date.now() - lastError
    if (elapsed >= ERROR_COOLDOWN_MS) {
      this.erroredFiles.delete(fileId)
      return false
    }
    return true
  }

  private markFileErrored(fileId: string): void {
    this.erroredFiles.set(fileId, Date.now())
  }

  private getApp(): AppService {
    if (!this.app) throw new Error('ThumbnailScanner not initialized')
    return this.app
  }

  async generateThumbnailsForFile(fileRecord: FileRecord): Promise<void> {
    if (!fileRecord.type?.startsWith('image/') && !fileRecord.type?.startsWith('video/')) {
      return
    }

    const app = this.getApp()
    this.processingFiles.add(fileRecord.id)
    try {
      const sourceUri = await app.fs.getFileUri({
        id: fileRecord.id,
        type: fileRecord.type,
      })
      if (!sourceUri) {
        logger.warn('generateThumbnailsForFile', 'no_source_uri', {
          fileId: fileRecord.id,
        })
        return
      }

      const existingSizes = await app.thumbnails.getSizesForFile(fileRecord.id)
      const missingSizes = ThumbSizes.filter((s) => !existingSizes.includes(s))
      if (missingSizes.length === 0) {
        logger.debug('generateThumbnailsForFile', 'all_exist', {
          fileId: fileRecord.id,
        })
        return
      }

      logger.debug('generateThumbnailsForFile', 'generating', {
        fileId: fileRecord.id,
        missingSizes,
      })

      if (fileRecord.type?.startsWith('image/') && missingSizes.length > 1) {
        await this.ensureThumbnailsBatch({
          fileId: fileRecord.id,
          fileHash: fileRecord.hash,
          fileType: fileRecord.type,
          fileLocalId: fileRecord.localId,
          sizes: missingSizes,
          sourceUri,
        })
      } else {
        for (const size of missingSizes) {
          await this.ensureThumbnailForSize({
            fileId: fileRecord.id,
            fileHash: fileRecord.hash,
            fileType: fileRecord.type,
            fileLocalId: fileRecord.localId,
            size,
            sourceUri,
          })
        }
      }
    } finally {
      this.processingFiles.delete(fileRecord.id)
    }
  }

  async ensureThumbnailForSize(params: EnsureThumbnailParams): Promise<EnsureResult> {
    const app = this.getApp()
    const { fileId, fileHash, fileType, size, sourceUri } = params

    const exactExists = await app.thumbnails.existsForFileAndSize(fileId, size)
    if (exactExists) {
      return { status: 'exists' }
    }

    const detectedType = await app.fs.detectMimeType(sourceUri)
    const actualType = detectedType ?? fileType

    if (detectedType && detectedType !== fileType) {
      logger.warn('thumbnailer', 'type_mismatch', {
        fileId,
        storedType: fileType,
        detectedType,
        sourceUri,
      })
    }

    if (!actualType?.startsWith('image/') && !actualType?.startsWith('video/')) {
      logger.error('thumbnailer', 'unsupported_format', {
        fileId,
        fileHash,
        size,
        storedType: fileType,
        detectedType,
        sourceUri,
      })
      this.markFileErrored(fileId)
      return { status: 'error', error: new Error('Unsupported format') }
    }

    logger.debug('thumbnailer', 'source_uri', {
      fileId,
      uri: sourceUri,
      storedType: fileType,
      detectedType,
    })

    let result: { data: ArrayBuffer; mimeType: string }
    try {
      if (actualType?.startsWith('video/')) {
        result = await app.thumbnails.generateVideo(sourceUri, size)
      } else {
        result = await app.thumbnails.generate(sourceUri, size)
      }
    } catch (e) {
      logger.error('thumbnailer', 'source_prepare_error', {
        fileId,
        fileHash,
        size,
        storedType: fileType,
        detectedType,
        sourceUri,
        error: e as Error,
      })
      this.markFileErrored(fileId)
      return { status: 'error', error: e }
    }

    try {
      const thumbId = uniqueId()
      const thumbFileInfo = {
        id: thumbId,
        type: result.mimeType,
      }
      const copied = await app.fs.writeFileData(thumbFileInfo, result.data)

      const now = Date.now()
      await app.files.create({
        id: thumbId,
        name: 'thumbnail.webp',
        type: result.mimeType,
        kind: 'thumb',
        size: copied.size,
        hash: `sha256:${copied.hash}`,
        createdAt: now,
        updatedAt: now,
        addedAt: now,
        localId: null,
        thumbForId: fileId,
        thumbSize: size,
        trashedAt: null,
        deletedAt: null,
      })
      logger.debug('thumbnailer', 'record_created', {
        thumbId,
        hash: fileHash,
        size,
      })

      await app.caches.thumbnails.byFileId.invalidate(fileId)
      await app.caches.thumbnails.best.invalidate(fileId, String(size))

      return {
        status: 'produced',
        thumbId,
        width: null,
        height: null,
      }
    } catch (e) {
      logger.error('thumbnailer', 'generation_error', {
        fileId,
        fileHash,
        size,
        storedType: fileType,
        detectedType,
        sourceUri,
        error: e as Error,
      })
      this.markFileErrored(fileId)
      return { status: 'error', error: e }
    }
  }

  private async ensureThumbnailsBatch(params: {
    fileId: string
    fileHash: string
    fileType: string
    fileLocalId: string | null
    sizes: ThumbSize[]
    sourceUri: string
  }): Promise<void> {
    const app = this.getApp()
    const { fileId, fileHash, fileType, sizes, sourceUri } = params

    const detectedType = await app.fs.detectMimeType(sourceUri)
    const actualType = detectedType ?? fileType

    if (!actualType?.startsWith('image/') && !actualType?.startsWith('video/')) {
      this.markFileErrored(fileId)
      return
    }

    let thumbnails: Map<number, { data: ArrayBuffer; mimeType: string }>
    try {
      thumbnails = await app.thumbnails.generateBatch(sourceUri, sizes)
    } catch (e) {
      logger.error('thumbnailer', 'batch_generate_error', {
        fileId,
        fileHash,
        sizes,
        error: e as Error,
      })
      this.markFileErrored(fileId)
      return
    }

    for (const size of sizes) {
      const result = thumbnails.get(size)
      if (!result) continue
      try {
        const thumbId = uniqueId()
        const copied = await app.fs.writeFileData(
          { id: thumbId, type: result.mimeType },
          result.data,
        )
        const now = Date.now()
        await app.files.create({
          id: thumbId,
          name: 'thumbnail.webp',
          type: result.mimeType,
          kind: 'thumb',
          size: copied.size,
          hash: `sha256:${copied.hash}`,
          createdAt: now,
          updatedAt: now,
          addedAt: now,
          localId: null,
          thumbForId: fileId,
          thumbSize: size,
          trashedAt: null,
          deletedAt: null,
        })
        logger.debug('thumbnailer', 'record_created', {
          thumbId,
          hash: fileHash,
          size,
        })
        await app.caches.thumbnails.byFileId.invalidate(fileId)
        await app.caches.thumbnails.best.invalidate(fileId, String(size))
      } catch (e) {
        logger.error('thumbnailer', 'batch_save_error', {
          fileId,
          fileHash,
          size,
          error: e as Error,
        })
        this.markFileErrored(fileId)
      }
    }
  }

  private async queryCandidateOriginals(
    limit: number,
    excludeIds?: Set<string>,
  ): Promise<ThumbnailCandidateRow[]> {
    const app = this.getApp()
    const results: ThumbnailCandidateRow[] = []
    const seenIds = excludeIds ?? new Set<string>()
    let cursor: { createdAt: number; id: string } | undefined
    const pageSize = Math.max(limit, 25)

    while (results.length < limit) {
      const batch = await app.thumbnails.queryCandidatePage(pageSize, cursor)

      if (batch.length === 0) break

      for (const row of batch) {
        if (seenIds.has(row.id)) continue
        results.push(row)
        if (results.length >= limit) break
      }

      const last = batch[batch.length - 1]
      cursor = { createdAt: last.createdAt, id: last.id }

      if (batch.length < pageSize) break
    }

    return results
  }

  private async logOverallProgress(): Promise<void> {
    const app = this.getApp()
    try {
      const { originals, thumbs } = await app.thumbnails.queryProgress()
      const targetThumbs = originals * ThumbSizes.length
      const remaining = Math.max(targetThumbs - thumbs, 0)
      const percent = targetThumbs > 0 ? Math.min(1, thumbs / targetThumbs) : 1
      logger.debug('thumbnailScanner', 'progress', {
        originals,
        thumbs,
        targetThumbs,
        remaining,
        percent: Math.round(percent * 100),
      })
    } catch (e) {
      logger.error('thumbnailScanner', 'progress_error', {
        error: e as Error,
      })
    }
  }

  async runScan(signal?: AbortSignal): Promise<ThumbnailScannerResult> {
    const app = this.getApp()
    const summary: ThumbnailScannerResult = {
      processedCandidates: 0,
      attempts: [],
      produced: [],
      skippedNoSource: [],
      skippedFullyCovered: [],
      skippedErrorCooldown: [],
      errors: [],
    }
    let producedCount = 0
    try {
      logger.debug('thumbnailScanner', 'tick')
      const skippedNoSourceUri = new Set<string>()
      const processedThisRun = new Set<string>()

      while (producedCount < MAX_THUMBS_PER_TICK) {
        if (signal?.aborted) break
        const batch = await this.queryCandidateOriginals(25, processedThisRun)
        if (batch.length === 0) break

        for (const c of batch) {
          if (signal?.aborted) break
          if (producedCount >= MAX_THUMBS_PER_TICK) break
          processedThisRun.add(c.id)

          // Skip files currently being processed by generateThumbnailsForFile.
          if (this.isFileBeingProcessed(c.id)) continue

          // Skip files that recently errored (cooldown period).
          if (this.isFileInErrorCooldown(c.id)) {
            summary.skippedErrorCooldown.push({ fileId: c.id, hash: c.hash })
            continue
          }

          summary.processedCandidates += 1
          // Determine missing sizes for this original so we don't attempt existing ones.
          const existingSizes = await app.thumbnails.getSizesForFile(c.id)
          const missingSizes = ThumbSizes.filter((s) => !existingSizes.includes(s))
          if (missingSizes.length === 0) {
            summary.skippedFullyCovered.push({ fileId: c.id, hash: c.hash })
            continue
          }

          // Check if we can get source URI before attempting sizes.
          const sourceUri = await app.fs.getFileUri({
            id: c.id,
            type: c.type,
          })
          if (!sourceUri) {
            if (!skippedNoSourceUri.has(c.id)) {
              skippedNoSourceUri.add(c.id)
              summary.skippedNoSource.push({ fileId: c.id, hash: c.hash })
            }
            continue
          }

          logger.debug('thumbnailScanner', 'candidate', {
            id: c.id,
            hash: c.hash,
            existingSizes: existingSizes.join(','),
            missingSizes: missingSizes.join(','),
          })

          for (const size of missingSizes) {
            // Exit early on suspension so the DB can close promptly.
            if (signal?.aborted || producedCount >= MAX_THUMBS_PER_TICK) break
            logger.debug('thumbnailScanner', 'attempt', { id: c.id, size })
            summary.attempts.push({
              originalId: c.id,
              originalHash: c.hash,
              size,
            })
            const outcome = await this.ensureThumbnailForSize({
              fileId: c.id,
              fileHash: c.hash,
              fileType: c.type,
              fileLocalId: c.localId,
              size,
              sourceUri,
            })
            await yieldToEventLoop()
            if (outcome.status === 'produced') {
              producedCount++
              summary.produced.push({
                originalId: c.id,
                originalHash: c.hash,
                size,
                thumbId: outcome.thumbId,
              })
              logger.info('thumbnailScanner', 'produced', {
                id: c.id,
                size,
              })
            } else if (outcome.status === 'error') {
              summary.errors.push({
                originalId: c.id,
                originalHash: c.hash,
                size,
                error: outcome.error,
              })
            }
          }
        }
      }
      logger.info('thumbnailScanner', 'batch_complete', {
        produced: summary.produced.length,
        skippedNoSource: summary.skippedNoSource.length,
        skippedFullyCovered: summary.skippedFullyCovered.length,
        skippedErrorCooldown: summary.skippedErrorCooldown.length,
        errors: summary.errors.length,
        total: summary.processedCandidates + summary.skippedErrorCooldown.length,
      })
      await this.logOverallProgress()
    } catch (e) {
      logger.error('thumbnailScanner', 'scan_error', { error: e as Error })
    }
    return summary
  }
}

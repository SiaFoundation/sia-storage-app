import { logger } from '@siastorage/logger'
import type { DatabaseAdapter } from '../adapters/db'
import type { ThumbnailAdapter } from '../adapters/thumbnail'
import { insertFileRecord } from '../db/operations/files'
import {
  queryThumbnailExistsForFileIdAndSize,
  queryThumbnailSizesForFileId,
} from '../db/operations/thumbnails'
import { uniqueId } from '../lib/uniqueId'
import { yieldToEventLoop } from '../lib/yieldToEventLoop'
import type { FileRecord, ThumbSize } from '../types/files'
import { ThumbSizes } from '../types/files'

export type ThumbnailDeps = {
  db: DatabaseAdapter
  thumbnailAdapter: ThumbnailAdapter
  detectMimeType(path: string): Promise<string | null>
  getFsFileUri(file: { id: string; type: string }): Promise<string | null>
  copyToFs(
    file: { id: string; type: string },
    data: ArrayBuffer,
  ): Promise<{ uri: string; size: number; hash: string }>
  invalidateCache?(fileId: string): Promise<void>
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

const MAX_THUMBS_PER_TICK = 10
const ERROR_COOLDOWN_MS = 60 * 60 * 1000 // 1 hour

type CandidateRow = {
  id: string
  hash: string
  type: string
  localId: string | null
  createdAt: number
}

type CandidateCursor = {
  createdAt: number
  id: string
}

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
        targetHeight: Math.max(
          1,
          Math.round((sourceHeight * size) / sourceWidth),
        ),
      }
    }
    return {
      targetHeight: size,
      targetWidth: Math.max(1, Math.round((sourceWidth * size) / sourceHeight)),
    }
  }
  return { targetWidth: size, targetHeight: undefined }
}

export class ThumbnailScanner {
  private deps: ThumbnailDeps | null = null
  private processingFiles = new Set<string>()
  private erroredFiles = new Map<string, number>()

  initialize(deps: ThumbnailDeps): void {
    this.deps = deps
  }

  reset(): void {
    this.deps = null
    this.processingFiles.clear()
    this.erroredFiles.clear()
  }

  isInitialized(): boolean {
    return this.deps !== null
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

  private getDeps(): ThumbnailDeps {
    if (!this.deps) throw new Error('ThumbnailScanner not initialized')
    return this.deps
  }

  async generateThumbnailsForFile(fileRecord: FileRecord): Promise<void> {
    if (
      !fileRecord.type?.startsWith('image/') &&
      !fileRecord.type?.startsWith('video/')
    ) {
      return
    }

    const deps = this.getDeps()
    this.processingFiles.add(fileRecord.id)
    try {
      const sourceUri = await deps.getFsFileUri({
        id: fileRecord.id,
        type: fileRecord.type,
      })
      if (!sourceUri) {
        logger.warn('generateThumbnailsForFile', 'no_source_uri', {
          fileId: fileRecord.id,
        })
        return
      }

      const existingSizes = await queryThumbnailSizesForFileId(
        deps.db,
        fileRecord.id,
      )
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
    } finally {
      this.processingFiles.delete(fileRecord.id)
    }
  }

  async ensureThumbnailForSize(
    params: EnsureThumbnailParams,
  ): Promise<EnsureResult> {
    const deps = this.getDeps()
    const { fileId, fileHash, fileType, size, sourceUri } = params

    const exactExists = await queryThumbnailExistsForFileIdAndSize(
      deps.db,
      fileId,
      size,
    )
    if (exactExists) {
      return { status: 'exists' }
    }

    const detectedType = await deps.detectMimeType(sourceUri)
    const actualType = detectedType ?? fileType

    if (detectedType && detectedType !== fileType) {
      logger.warn('thumbnailer', 'type_mismatch', {
        fileId,
        storedType: fileType,
        detectedType,
        sourceUri,
      })
    }

    if (
      !actualType?.startsWith('image/') &&
      !actualType?.startsWith('video/')
    ) {
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
        result = await deps.thumbnailAdapter.generateVideoThumbnail(
          sourceUri,
          size,
        )
      } else {
        result = await deps.thumbnailAdapter.generateImageThumbnail(
          sourceUri,
          size,
        )
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
      const copied = await deps.copyToFs(thumbFileInfo, result.data)

      const now = Date.now()
      await insertFileRecord(deps.db, {
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

      await deps.invalidateCache?.(fileId)

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

  private async queryCandidateOriginals(
    limit: number,
    excludeIds?: Set<string>,
  ): Promise<CandidateRow[]> {
    const deps = this.getDeps()
    const results: CandidateRow[] = []
    const seenIds = excludeIds ?? new Set<string>()
    let cursor: CandidateCursor | undefined
    const pageSize = Math.max(limit, 25)

    while (results.length < limit) {
      const params: (string | number)[] = []
      const cursorClause = cursor
        ? `AND (f.createdAt < ? OR (f.createdAt = ? AND f.id < ?))`
        : ''
      if (cursor) {
        params.push(cursor.createdAt, cursor.createdAt, cursor.id)
      }
      params.push(pageSize)

      const batch = await deps.db.getAllAsync<CandidateRow>(
        `SELECT f.id, f.hash, f.type, f.localId, f.createdAt
         FROM files f
         LEFT JOIN files t
           ON t.thumbForId = f.id
          AND t.thumbSize IN (${ThumbSizes.join(',')})
         WHERE (f.type LIKE 'image/%' OR f.type LIKE 'video/%')
           AND f.kind = 'file'
           AND f.trashedAt IS NULL AND f.deletedAt IS NULL
           ${cursorClause}
         GROUP BY f.id
         HAVING COUNT(DISTINCT t.thumbSize) < ${ThumbSizes.length}
         ORDER BY f.createdAt DESC, f.id DESC
         LIMIT ?`,
        ...params,
      )

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
    const deps = this.getDeps()
    try {
      const originalsRow = await deps.db.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) as count FROM files WHERE (type LIKE 'image/%' OR type LIKE 'video/%') AND kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL`,
      )
      const thumbsRow = await deps.db.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) as count FROM files WHERE kind = 'thumb' AND deletedAt IS NULL AND thumbSize IN (${ThumbSizes.join(',')})`,
      )
      const originals = originalsRow?.count ?? 0
      const thumbs = thumbsRow?.count ?? 0
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
    const deps = this.getDeps()
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
          const existingSizes = await queryThumbnailSizesForFileId(
            deps.db,
            c.id,
          )
          const missingSizes = ThumbSizes.filter(
            (s) => !existingSizes.includes(s),
          )
          if (missingSizes.length === 0) {
            summary.skippedFullyCovered.push({ fileId: c.id, hash: c.hash })
            continue
          }

          // Check if we can get source URI before attempting sizes.
          const sourceUri = await deps.getFsFileUri({
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
            if (producedCount >= MAX_THUMBS_PER_TICK) break
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
        total:
          summary.processedCandidates + summary.skippedErrorCooldown.length,
      })
      await this.logOverallProgress()
    } catch (e) {
      logger.error('thumbnailScanner', 'scan_error', { error: e as Error })
    }
    return summary
  }
}

import { logger } from '../../lib/logger'
import { createServiceInterval } from '../../lib/serviceInterval'
import { db } from '../../db'
import { File } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import {
  readFileRecordByContentHash,
  createFileRecord,
  type ThumbSize,
  ThumbSizes,
} from '../../stores/files'
import {
  readThumbnailSizesForHash,
  thumbnailExistsForHashAndSize,
  thumbnailSwr,
} from '../../stores/thumbnails'
import { getFileUri, copyFileToCache } from '../../stores/fileCache'
import { THUMBNAIL_INTERVAL } from '../../config'
import { calculateContentHash } from '../../lib/contentHash'
import { getMimeType } from '../../lib/fileTypes'
import { uniqueId } from '../../lib/uniqueId'
import {
  prepareImageThumbnail,
  prepareVideoThumbnail,
  ThumbnailInfo,
} from './prepareThumb'

const MAX_THUMBS_PER_TICK = 10

export type ThumbnailAttempt = {
  originalId: string
  originalHash: string
  size: ThumbSize
}

export type ProducedThumbnail = ThumbnailAttempt & {
  thumbId: string
}

export type DeduplicatedThumbnail = ThumbnailAttempt & {
  existingThumbId: string
}

export type ThumbnailGenerationError = ThumbnailAttempt & {
  error: unknown
}

export type ThumbnailerResult = {
  processedCandidates: number
  attempts: ThumbnailAttempt[]
  produced: ProducedThumbnail[]
  deduplicated: DeduplicatedThumbnail[]
  skippedNoSource: Array<{ fileId: string; hash: string }>
  skippedFullyCovered: Array<{ fileId: string; hash: string }>
  errors: ThumbnailGenerationError[]
}

async function logOverallProgress() {
  try {
    const originalsRow = await db().getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM files WHERE (type LIKE 'image/%' OR type LIKE 'video/%') AND thumbForHash IS NULL`
    )
    const thumbsRow = await db().getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM files WHERE thumbForHash IS NOT NULL AND thumbSize IN (${ThumbSizes.join(
        ','
      )})`
    )
    const originals = originalsRow?.count ?? 0
    const thumbs = thumbsRow?.count ?? 0
    const targetThumbs = originals * ThumbSizes.length
    const remaining = Math.max(targetThumbs - thumbs, 0)
    const percent = targetThumbs > 0 ? Math.min(1, thumbs / targetThumbs) : 1
    logger.log(
      `[thumbnailer] overall originals=${originals} thumbs=${thumbs}/${targetThumbs} remaining=${remaining} percent=${Math.round(
        percent * 100
      )}%`
    )
  } catch (e) {
    logger.log('[thumbnailer] progress error', e)
  }
}

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

async function queryCandidateOriginals(
  limit: number,
  excludeIds?: Set<string>
): Promise<CandidateRow[]> {
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

    const batch = await db().getAllAsync<CandidateRow>(
      `SELECT f.id, f.hash, f.type, f.localId, f.createdAt
       FROM files f
       LEFT JOIN files t
         ON t.thumbForHash = f.hash
        AND t.thumbSize IN (${ThumbSizes.join(',')})
       WHERE (f.type LIKE 'image/%' OR f.type LIKE 'video/%')
         AND f.thumbForHash IS NULL
         ${cursorClause}
       GROUP BY f.id
       HAVING COUNT(DISTINCT t.thumbSize) < ${ThumbSizes.length}
       ORDER BY f.createdAt DESC, f.id DESC
       LIMIT ?`,
      ...params
    )

    if (batch.length === 0) {
      break
    }

    for (const row of batch) {
      if (seenIds.has(row.id)) continue
      results.push(row)
      if (results.length >= limit) {
        break
      }
    }

    const last = batch[batch.length - 1]
    cursor = { createdAt: last.createdAt, id: last.id }

    if (batch.length < pageSize) {
      break
    }
  }

  return results
}

type EnsureOutcome =
  | { status: 'exists' }
  | {
      status: 'produced'
      thumbId: string
      width: number | null
      height: number | null
    }
  | { status: 'duplicate'; existingThumbId: string }
  | { status: 'error'; error: unknown }

async function ensureThumbnailForSize(params: {
  fileId: string
  fileHash: string
  fileType: string
  fileLocalId: string | null
  size: ThumbSize
  sourceUri: string
}): Promise<EnsureOutcome> {
  const { fileId, fileHash, fileType, size, sourceUri } = params

  // Fast path: exact size exists.
  const exactExists = await thumbnailExistsForHashAndSize(fileHash, size)
  if (exactExists) {
    return { status: 'exists' }
  }

  logger.log('[thumbnailer] source uri', { fileId, uri: sourceUri })

  // Compute input and target aspect-preserving dimensions for thumb size = size.
  let info: ThumbnailInfo | null = null
  try {
    if (fileType?.startsWith('video/')) {
      info = await prepareVideoThumbnail(sourceUri, size)
      logger.log('[thumbnailer] video base frame prepared', {
        fileId,
        size,
        info,
      })
    } else {
      info = await prepareImageThumbnail(sourceUri, size)
      logger.log('[thumbnailer] image target size prepared', {
        fileId,
        size,
        info,
      })
    }
  } catch (e) {
    logger.log('[thumbnailer] error preparing source', e)
    return { status: 'error', error: e }
  }

  try {
    const ctx = ImageManipulator.manipulate(info.inputUri)
    ctx.resize({ width: info.targetWidth, height: info.targetHeight })
    const ref = await ctx.renderAsync()
    const result = await ref.saveAsync({
      compress: 0.8,
      format: SaveFormat.WEBP,
    })
    logger.log('[thumbnailer] manipulated', {
      fileId,
      hash: fileHash,
      size,
      outWidth: result.width,
      outHeight: result.height,
      uri: result.uri,
    })

    // Copy thumbnail file to cache and calculate hash.
    const thumbId = uniqueId()
    const thumbFileInfo = {
      id: thumbId,
      type: getMimeType({ type: 'image/webp', name: 'thumbnail.webp' }),
      localId: null,
    }
    const cacheUri = await copyFileToCache(thumbFileInfo, new File(result.uri))
    const thumbHash = await calculateContentHash(cacheUri)
    if (!thumbHash) {
      logger.log('[thumbnailer] failed to calculate hash', { fileId, size })
      return { status: 'error', error: new Error('Missing thumbnail hash') }
    }

    // Check if a thumbnail with this hash already exists (dedupe by content hash).
    const existingThumb = await readFileRecordByContentHash(thumbHash)
    if (existingThumb) {
      logger.log('[thumbnailer] thumbnail already exists by hash', {
        thumbId: existingThumb.id,
        hash: fileHash,
        size,
      })
      return { status: 'duplicate', existingThumbId: existingThumb.id }
    }

    // Create file record with thumbForHash set from the start to avoid flicker.
    const fileSize = new File(cacheUri).info().size ?? 0
    const now = Date.now()
    await createFileRecord(
      {
        id: thumbId,
        name: 'thumbnail.webp',
        type: thumbFileInfo.type,
        size: fileSize,
        hash: thumbHash,
        createdAt: now,
        updatedAt: now,
        addedAt: now,
        localId: null,
        thumbForHash: fileHash,
        thumbSize: size,
      },
      true
    )
    logger.log('[thumbnailer] created thumbnail record', {
      thumbId,
      hash: fileHash,
      size,
    })

    // Invalidate thumbnail cache for this original file so gallery items update.
    // This will revalidate all thumb sizes for this hash.
    await thumbnailSwr.triggerChange(fileHash)

    return {
      status: 'produced',
      thumbId,
      width: result.width ?? null,
      height: result.height ?? null,
    }
  } catch (e) {
    logger.log('[thumbnailer] error generating thumbnail', e)
    return { status: 'error', error: e }
  }
}

export async function runThumbnailer(): Promise<ThumbnailerResult> {
  const summary: ThumbnailerResult = {
    processedCandidates: 0,
    attempts: [],
    produced: [],
    deduplicated: [],
    skippedNoSource: [],
    skippedFullyCovered: [],
    errors: [],
  }
  let producedCount = 0
  try {
    logger.log('[thumbnailer] scanning...')
    const skippedNoSourceUri = new Set<string>()
    const processedThisRun = new Set<string>()

    while (producedCount < MAX_THUMBS_PER_TICK) {
      const batch = await queryCandidateOriginals(25, processedThisRun)
      if (batch.length === 0) {
        break
      }

      logger.log('[thumbnailer] candidates', {
        count: batch.length,
        ids: batch.map((c) => c.id).slice(0, 10),
      })

      for (const c of batch) {
        if (producedCount >= MAX_THUMBS_PER_TICK) break
        processedThisRun.add(c.id)
        summary.processedCandidates += 1
        // Determine missing sizes for this original so we don't attempt existing ones.
        const existingSizes = await readThumbnailSizesForHash(c.hash)
        const missingSizes = ThumbSizes.filter(
          (s) => !existingSizes.includes(s)
        )
        if (missingSizes.length === 0) {
          summary.skippedFullyCovered.push({ fileId: c.id, hash: c.hash })
          continue
        }

        // Check if we can get source URI before attempting sizes.
        const sourceUri = await getFileUri({
          id: c.id,
          type: c.type,
          localId: c.localId,
        })
        if (!sourceUri) {
          if (!skippedNoSourceUri.has(c.id)) {
            skippedNoSourceUri.add(c.id)
            summary.skippedNoSource.push({ fileId: c.id, hash: c.hash })
          }
          continue
        }

        logger.log('[thumbnailer] candidate', {
          id: c.id,
          hash: c.hash,
          existingSizes,
          missingSizes,
        })

        for (const size of missingSizes) {
          if (producedCount >= MAX_THUMBS_PER_TICK) break
          logger.log('[thumbnailer] attempt size', { id: c.id, size })
          summary.attempts.push({
            originalId: c.id,
            originalHash: c.hash,
            size,
          })
          const outcome = await ensureThumbnailForSize({
            fileId: c.id,
            fileHash: c.hash,
            fileType: c.type,
            fileLocalId: c.localId,
            size,
            sourceUri,
          })
          if (outcome.status === 'produced') {
            producedCount++
            summary.produced.push({
              originalId: c.id,
              originalHash: c.hash,
              size,
              thumbId: outcome.thumbId,
            })
            logger.log('[thumbnailer] produced', { id: c.id, size })
          } else if (outcome.status === 'duplicate') {
            summary.deduplicated.push({
              originalId: c.id,
              originalHash: c.hash,
              size,
              existingThumbId: outcome.existingThumbId,
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
    logger.log(
      `[thumbnailer] batch produced=${summary.produced.length}/${summary.processedCandidates}` +
        ` skippedNoSource=${summary.skippedNoSource.length}/${summary.processedCandidates}` +
        ` skippedFullyCovered=${summary.skippedFullyCovered.length}/${summary.processedCandidates}` +
        ` errors=${summary.errors.length}/${summary.processedCandidates}` +
        ` deduplicated=${summary.deduplicated.length}/${summary.processedCandidates}`
    )
    await logOverallProgress()
  } catch (e) {
    logger.log('[thumbnailer] scan error', e)
  }
  return summary
}

export const initThumbnailer = createServiceInterval({
  name: 'thumbnailer',
  worker: async () => {
    await runThumbnailer()
  },
  getState: async () => true,
  interval: THUMBNAIL_INTERVAL,
})

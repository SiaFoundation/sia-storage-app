import { THUMBNAIL_SCANNER_INTERVAL } from '../config'
import { db } from '../db'
import { logger } from '../lib/logger'
import { createServiceInterval } from '../lib/serviceInterval'
import { type ThumbSize, ThumbSizes } from '../stores/files'
import { getFsFileUri } from '../stores/fs'
import { readThumbnailSizesForFileId } from '../stores/thumbnails'
import {
  ensureThumbnailForSize,
  isFileBeingProcessed,
  isFileInErrorCooldown,
} from './thumbnailer'

const MAX_THUMBS_PER_TICK = 10

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

async function logOverallProgress() {
  try {
    const originalsRow = await db().getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM files WHERE (type LIKE 'image/%' OR type LIKE 'video/%') AND kind = 'file'`,
    )
    const thumbsRow = await db().getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM files WHERE kind = 'thumb' AND thumbSize IN (${ThumbSizes.join(
        ',',
      )})`,
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
    logger.error('thumbnailScanner', 'progress_error', { error: e as Error })
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
  excludeIds?: Set<string>,
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
         ON t.thumbForId = f.id
        AND t.thumbSize IN (${ThumbSizes.join(',')})
       WHERE (f.type LIKE 'image/%' OR f.type LIKE 'video/%')
         AND f.kind = 'file'
         ${cursorClause}
       GROUP BY f.id
       HAVING COUNT(DISTINCT t.thumbSize) < ${ThumbSizes.length}
       ORDER BY f.createdAt DESC, f.id DESC
       LIMIT ?`,
      ...params,
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

export async function runThumbnailScanner(): Promise<ThumbnailScannerResult> {
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
      const batch = await queryCandidateOriginals(25, processedThisRun)
      if (batch.length === 0) {
        break
      }

      for (const c of batch) {
        if (producedCount >= MAX_THUMBS_PER_TICK) break
        processedThisRun.add(c.id)

        // Skip files currently being processed by generateThumbnailsForFile.
        if (isFileBeingProcessed(c.id)) {
          continue
        }

        // Skip files that recently errored (cooldown period).
        if (isFileInErrorCooldown(c.id)) {
          summary.skippedErrorCooldown.push({ fileId: c.id, hash: c.hash })
          continue
        }

        summary.processedCandidates += 1
        // Determine missing sizes for this original so we don't attempt existing ones.
        const existingSizes = await readThumbnailSizesForFileId(c.id)
        const missingSizes = ThumbSizes.filter(
          (s) => !existingSizes.includes(s),
        )
        if (missingSizes.length === 0) {
          summary.skippedFullyCovered.push({ fileId: c.id, hash: c.hash })
          continue
        }

        // Check if we can get source URI before attempting sizes.
        const sourceUri = await getFsFileUri({
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
            logger.info('thumbnailScanner', 'produced', { id: c.id, size })
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
    await logOverallProgress()
  } catch (e) {
    logger.error('thumbnailScanner', 'scan_error', { error: e as Error })
  }
  return summary
}

export const { init: initThumbnailScanner } = createServiceInterval({
  name: 'thumbnailScanner',
  worker: async () => {
    await runThumbnailScanner()
  },
  getState: async () => true,
  interval: THUMBNAIL_SCANNER_INTERVAL,
})

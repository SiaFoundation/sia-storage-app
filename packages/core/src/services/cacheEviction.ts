import { logger } from '@siastorage/logger'
import type { AppService } from '../app/service'
import { FS_EVICTABLE_MIN_AGE, FS_EVICTABLE_MIN_AGE_NON_CURRENT, FS_MAX_BYTES } from '../config'

export type CacheEvictionConfig = {
  maxBytes?: number
  /** Age gate for the LRU cap-driven pass. Defaults to `FS_EVICTABLE_MIN_AGE`. */
  minAge?: number
  /** Age gate for the non-current pre-pass. Defaults to `FS_EVICTABLE_MIN_AGE_NON_CURRENT`. */
  minAgeNonCurrent?: number
  batchSize?: number
}

export type CacheEvictionResult = {
  processedRows: number
  evicted: number
  evictedFileIds: string[]
  currentSize: number
}

/**
 * Evicts cached files in three passes:
 *   1. Trashed pre-pass: uploaded files the user has trashed, no age gate.
 *   2. Non-current pre-pass: superseded versions past `minAgeNonCurrent`.
 *   3. LRU loop: oldest uploaded files past `minAge`, only while over `maxBytes`.
 * Local-only files (no indexer object) are never evicted.
 *
 * Suspension signal policy: accepts AbortSignal. Each pass holds a sequence
 * of disk + DB writes; checks the signal between batches and between rows
 * so a mid-eviction abort releases promptly before the DB gate closes.
 */
export async function runCacheEviction(
  app: AppService,
  config?: CacheEvictionConfig,
  signal?: AbortSignal,
): Promise<CacheEvictionResult | undefined> {
  const maxBytes = config?.maxBytes ?? FS_MAX_BYTES
  const minAge = config?.minAge ?? FS_EVICTABLE_MIN_AGE
  const minAgeNonCurrent = config?.minAgeNonCurrent ?? FS_EVICTABLE_MIN_AGE_NON_CURRENT
  const batchSize = config?.batchSize ?? 100

  const totalSize = await app.fs.calcTotalSize()

  logger.info('cacheEviction', 'starting', { totalSize, limit: maxBytes })

  let currentSize = totalSize
  let processedRows = 0
  let evicted = 0
  const evictedFileIds: string[] = []

  async function evictBatch(
    rows: { fileId: string; size: number; type: string }[],
    options?: { stopWhenUnderCap?: boolean },
  ): Promise<void> {
    for (const { fileId, size, type } of rows) {
      if (signal?.aborted) return
      if (options?.stopWhenUnderCap && currentSize <= maxBytes) return
      try {
        await app.fs.removeFile({ id: fileId, type })
        currentSize -= size
        evicted++
        evictedFileIds.push(fileId)
      } catch (e) {
        logger.error('cacheEviction', 'remove_failed', {
          fileId,
          error: e as Error,
        })
      }
    }
  }

  // Pass 1: trashed uploaded files. User explicitly trashed them; evict on
  // the next pass with no age gate.
  while (!signal?.aborted) {
    const trashed = await app.fs.trashedCachedFiles(batchSize)
    if (trashed.length === 0) break
    await evictBatch(trashed)
    processedRows += trashed.length
    if (trashed.length < batchSize) break
  }

  // Pass 2: superseded file versions past the short grace. They can never
  // become current again, so keeping them cached wastes space regardless of
  // whether the cap is exceeded.
  while (!signal?.aborted) {
    const thresholdUsedAt = Date.now() - minAgeNonCurrent
    const nonCurrent = await app.fs.nonCurrentCachedFiles(thresholdUsedAt, batchSize)
    if (nonCurrent.length === 0) break
    await evictBatch(nonCurrent)
    processedRows += nonCurrent.length
    if (nonCurrent.length < batchSize) break
  }

  // Pass 3: LRU while over cap.
  while (!signal?.aborted && currentSize > maxBytes) {
    const thresholdUsedAt = Date.now() - minAge
    const candidates = await app.fs.evictionCandidates(thresholdUsedAt, batchSize)
    if (candidates.length === 0) break
    await evictBatch(candidates, { stopWhenUnderCap: true })
    processedRows += candidates.length
    if (candidates.length < batchSize) break
  }

  logger.info('cacheEviction', 'complete', {
    processedRows,
    evicted,
    currentSize,
    aborted: signal?.aborted ?? false,
  })
  return { processedRows, evicted, evictedFileIds, currentSize }
}

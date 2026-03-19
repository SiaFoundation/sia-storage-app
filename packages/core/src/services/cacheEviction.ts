import { logger } from '@siastorage/logger'
import type { AppService } from '../app/service'
import { FS_EVICTABLE_MIN_AGE, FS_MAX_BYTES } from '../config'

export type CacheEvictionConfig = {
  maxBytes?: number
  minAge?: number
  batchSize?: number
}

export type CacheEvictionResult = {
  processedRows: number
  evicted: number
  evictedFileIds: string[]
  currentSize: number
}

/**
 * Evicts cached files from the local filesystem when total size exceeds maxBytes.
 * Only evicts files older than minAge that have been uploaded (have an associated object).
 * Local-only files are never evicted. Processes in batches ordered by least recently used.
 */
export async function runCacheEviction(
  app: AppService,
  config?: CacheEvictionConfig,
): Promise<CacheEvictionResult | undefined> {
  const maxBytes = config?.maxBytes ?? FS_MAX_BYTES
  const minAge = config?.minAge ?? FS_EVICTABLE_MIN_AGE
  const batchSize = config?.batchSize ?? 100

  const totalSize = await app.fs.calcTotalSize()

  if (totalSize <= maxBytes) return undefined

  logger.info('cacheEviction', 'starting', { totalSize, limit: maxBytes })

  let currentSize = totalSize
  let processedRows = 0
  let evicted = 0
  const evictedFileIds: string[] = []

  while (currentSize > maxBytes) {
    const thresholdUsedAt = Date.now() - minAge

    const candidates = await app.fs.evictionCandidates(
      thresholdUsedAt,
      batchSize,
    )

    for (const { fileId, size, type } of candidates) {
      if (currentSize <= maxBytes) break
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

    processedRows += candidates.length

    if (candidates.length < batchSize) break
  }

  logger.info('cacheEviction', 'complete', {
    processedRows,
    evicted,
    currentSize,
  })
  return { processedRows, evicted, evictedFileIds, currentSize }
}

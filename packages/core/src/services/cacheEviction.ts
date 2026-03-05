import { logger } from '@siastorage/logger'
import type { DatabaseAdapter } from '../adapters/db'
import { FS_EVICTABLE_MIN_AGE, FS_MAX_BYTES } from '../config'

export type CacheEvictionDeps = {
  db: DatabaseAdapter
  deleteFile: (fileId: string, fileType: string) => Promise<void>
  maxBytes?: number
  minAge?: number
  batchSize?: number
}

export type CacheEvictionResult = {
  processedRows: number
  evicted: number
  currentSize: number
}

/**
 * Evicts cached files from the local filesystem when total size exceeds maxBytes.
 * Only evicts files older than minAge that have been uploaded (have an associated object).
 * Local-only files are never evicted. Processes in batches ordered by least recently used.
 */
export async function runCacheEviction(
  deps: CacheEvictionDeps,
): Promise<CacheEvictionResult | undefined> {
  const { db, deleteFile } = deps
  const maxBytes = deps.maxBytes ?? FS_MAX_BYTES
  const minAge = deps.minAge ?? FS_EVICTABLE_MIN_AGE
  const batchSize = deps.batchSize ?? 100

  try {
    const totalRow = await db.getFirstAsync<{ total: number }>(
      'SELECT COALESCE(SUM(size), 0) as total FROM fs',
    )
    const totalSize = totalRow?.total ?? 0

    if (totalSize <= maxBytes) return undefined

    logger.info('cacheEviction', 'starting', { totalSize, limit: maxBytes })

    let currentSize = totalSize
    let processedRows = 0
    let evicted = 0

    while (currentSize > maxBytes) {
      const thresholdUsedAt = Date.now() - minAge

      const candidates = await db.getAllAsync<{
        fileId: string
        size: number
        type: string
      }>(
        `SELECT fs.fileId, fs.size, f.type FROM fs
         JOIN files f ON f.id = fs.fileId
         WHERE fs.usedAt <= ?
           AND EXISTS (
             SELECT 1 FROM objects o WHERE o.fileId = fs.fileId
           )
         ORDER BY fs.usedAt ASC, fs.fileId ASC
         LIMIT ?`,
        thresholdUsedAt,
        batchSize,
      )

      for (const { fileId, size, type } of candidates) {
        if (currentSize <= maxBytes) break
        try {
          await deleteFile(fileId, type)
          currentSize -= size
          evicted++
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
    return { processedRows, evicted, currentSize }
  } catch (e) {
    logger.error('cacheEviction', 'failed', { error: e as Error })
    return undefined
  }
}

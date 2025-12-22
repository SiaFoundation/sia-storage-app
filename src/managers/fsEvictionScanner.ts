import {
  FS_MAX_BYTES,
  FS_EVICTION_FREQUENCY,
  FS_EVICTABLE_MIN_AGE,
} from '../config'
import { db } from '../db'
import { logger } from '../lib/logger'
import { createServiceInterval } from '../lib/serviceInterval'
import {
  calcFsFilesMetadataTotalSize,
  removeFsFile,
  type FsFileInfo,
  FsMetaRow,
} from '../stores/fs'
import {
  getAsyncStorageNumber,
  setAsyncStorageNumber,
} from '../stores/asyncStore'

/**
 * fsEvictionScanner evicts stale files from the file system under the following rules:
 * - Local-only files are always retained no matter how much space they take up.
 * - Only start eviction if we are above the FS_MAX_BYTES limit.
 * - Only evict a specific file if it is older than FS_EVICTABLE_MIN_AGE.
 */
export async function runFsEvictionScanner(): Promise<
  | {
      processedRows: number
      evicted: number
      currentSize: number
    }
  | undefined
> {
  const lastRun = await getFsEvictionLastRun()
  if (Date.now() - lastRun < FS_EVICTION_FREQUENCY) {
    return
  }
  try {
    const totalSize = await calcFsFilesMetadataTotalSize()
    if (totalSize <= FS_MAX_BYTES) {
      setFsEvictionLastRun()
      return
    }

    let currentSize = totalSize
    logger.warn(
      'fsEvictionScanner',
      `total size over limit totalSize=${totalSize}`
    )

    let processedRows = 0
    let evicted = 0

    const batchSize = 100
    while (currentSize > FS_MAX_BYTES) {
      const thresholdUsedAt = Date.now() - FS_EVICTABLE_MIN_AGE
      const batch = await readFsEvictionCandidates({
        limit: batchSize,
        maxUsedAt: thresholdUsedAt,
      })

      for (const row of batch) {
        if (currentSize <= FS_MAX_BYTES) break

        const fsInfo: FsFileInfo = {
          id: row.fileId,
          type: row.type,
        }

        try {
          await removeFsFile(fsInfo)
          currentSize -= row.size
          evicted += 1
        } catch (error) {
          logger.error(
            'fsEvictionScanner',
            `failed to remove file fileId=${row.fileId} error=${error}`
          )
        }
      }

      processedRows += batch.length

      if (batch.length < batchSize) {
        break
      }
    }

    const results = {
      processedRows,
      evicted,
      currentSize,
    }
    logger.info(
      'fsEvictionScanner',
      `summary processedRows=${processedRows} evicted=${evicted} currentSize=${currentSize}`
    )
    return results
  } catch (error) {
    logger.error('fsEvictionScanner', 'error during scan', error)
  } finally {
    await setFsEvictionLastRun()
  }
}

type FsEvictionCandidate = FsMetaRow & {
  type: string
}

/**
 * readFsEvictionCandidates reads the files that are eligible for eviction.
 * - Only files that are older than FS_EVICTABLE_MIN_AGE are considered.
 * - Only files that are not local-only are considered (at least one associated object).
 */
export async function readFsEvictionCandidates(params: {
  limit: number
  maxUsedAt: number
}): Promise<FsEvictionCandidate[]> {
  const { limit, maxUsedAt } = params
  return db().getAllAsync<FsEvictionCandidate>(
    `SELECT fs.fileId AS fileId,
            fs.size AS size,
            fs.addedAt AS addedAt,
            fs.usedAt AS usedAt,
            f.type AS type
     FROM fs
     JOIN files f ON f.id = fs.fileId
     WHERE fs.usedAt <= ?
       AND EXISTS (
         SELECT 1 FROM objects o WHERE o.fileId = fs.fileId
       )
     ORDER BY fs.usedAt ASC, fs.fileId ASC
     LIMIT ?`,
    maxUsedAt,
    limit
  )
}

export const initFsEvictionScanner = createServiceInterval({
  name: 'fsEvictionScanner',
  worker: async () => {
    await runFsEvictionScanner()
  },
  getState: async () => true,
  interval: 30_000,
})

export async function setFsEvictionLastRun(): Promise<void> {
  await setAsyncStorageNumber('fsEvictionLastRun', Date.now())
}

export async function getFsEvictionLastRun(): Promise<number> {
  return await getAsyncStorageNumber('fsEvictionLastRun', 0)
}

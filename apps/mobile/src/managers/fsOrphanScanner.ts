import { FS_ORPHAN_FREQUENCY } from '@siastorage/core/config'
import { logger } from '@siastorage/logger'
import type { File } from 'expo-file-system'
import { db } from '../db'
import {
  getAsyncStorageNumber,
  setAsyncStorageNumber,
} from '../stores/asyncStore'
import {
  deleteFsFileMetadataBatch,
  fsFileUriCache,
  listFilesInFsStorageDirectory,
} from '../stores/fs'

const BATCH_SIZE = 50

function extractFileIdFromName(name: string): string | null {
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex === -1) return name || null
  return name.slice(0, dotIndex) || null
}

/**
 * fsOrphanScanner scans the file system for files that are not indexed in the database.
 * - If a file is not indexed, it is deleted from the file system.
 * Files may be orphaned if they are from a different account, previous version of app,
 * left after an error, or other edge cases.
 */
export async function runFsOrphanScanner(options?: {
  onProgress?: (removed: number, total: number) => void
}): Promise<{ removed: number } | undefined> {
  const lastRun = await getFsOrphanLastRun()
  if (Date.now() - lastRun < FS_ORPHAN_FREQUENCY) {
    return
  }

  try {
    const files = listFilesInFsStorageDirectory()
    if (files.length === 0) return

    let removed = 0

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE)

      const entries = batch
        .map((f) => ({ file: f, fileId: extractFileIdFromName(f.name) }))
        .filter((e): e is { file: File; fileId: string } => e.fileId !== null)

      const orphanedIds = await findOrphanedFileIds(
        entries.map((e) => e.fileId),
      )

      for (const entry of entries) {
        if (!orphanedIds.has(entry.fileId)) continue
        try {
          entry.file.delete()
          removed++
          logger.info('fsOrphanScanner', 'file_removed', {
            fileId: entry.fileId,
            uri: entry.file.uri,
          })
        } catch (error) {
          logger.error('fsOrphanScanner', 'delete_failed', {
            fileId: entry.fileId,
            uri: entry.file.uri,
            error: error as Error,
          })
        }
      }

      if (orphanedIds.size > 0) {
        await deleteFsFileMetadataBatch([...orphanedIds])
      }

      options?.onProgress?.(removed, files.length)

      // Yield to event loop between batches
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    if (removed > 0) {
      await fsFileUriCache.invalidateAll()
      logger.info('fsOrphanScanner', 'summary', { removed })
    }
    return { removed }
  } catch (error) {
    logger.error('fsOrphanScanner', 'scan_error', { error: error as Error })
  } finally {
    await setFsOrphanLastRun()
  }
}

export async function findOrphanedFileIds(
  fileIds: string[],
): Promise<Set<string>> {
  if (fileIds.length === 0) return new Set()
  const rows = await db().getAllAsync<{ fileId: string }>(
    `SELECT value AS fileId FROM json_each(?)
     WHERE NOT EXISTS (
       SELECT 1 FROM fs WHERE fs.fileId = value
     ) OR NOT EXISTS (
       SELECT 1 FROM files WHERE files.id = value AND files.deletedAt IS NULL
     )`,
    JSON.stringify(fileIds),
  )
  return new Set(rows.map((r) => r.fileId))
}

export async function setFsOrphanLastRun(): Promise<void> {
  await setAsyncStorageNumber('fsOrphanLastRun', Date.now())
}

export async function getFsOrphanLastRun(): Promise<number> {
  return await getAsyncStorageNumber('fsOrphanLastRun', 0)
}

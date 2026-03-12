import { logger } from '@siastorage/logger'
import type { DatabaseAdapter } from '../adapters/db'
import { yieldToEventLoop } from '../lib/yieldToEventLoop'

const BATCH_SIZE = 50

export type FsEntry = {
  name: string
}

export type OrphanScannerDeps<T extends FsEntry = FsEntry> = {
  db: DatabaseAdapter
  listFiles: () => T[] | Promise<T[]>
  deleteFile: (file: T) => void | Promise<void>
  deleteFsMetadataBatch: (fileIds: string[]) => Promise<void>
  invalidateCache?: () => Promise<void>
  onProgress?: (removed: number, total: number) => void
}

export type OrphanScannerResult = {
  removed: number
}

function extractFileIdFromName(name: string): string | null {
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex === -1) return name || null
  return name.slice(0, dotIndex) || null
}

/**
 * Returns the subset of fileIds that are orphaned — i.e. have no corresponding
 * fs row or whose file record is soft-deleted.
 */
export async function findOrphanedFileIds(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<Set<string>> {
  if (fileIds.length === 0) return new Set()
  const rows = await db.getAllAsync<{ fileId: string }>(
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

/**
 * Scans the local file system for files not indexed in the database and deletes them.
 * Files may be orphaned from a different account, previous app version, or interrupted operations.
 * Processes in batches, yielding to the event loop between each.
 */
export async function runOrphanScanner<T extends FsEntry>(
  deps: OrphanScannerDeps<T>,
): Promise<OrphanScannerResult | undefined> {
  const { db, listFiles, deleteFile, deleteFsMetadataBatch } = deps

  try {
    const files = await listFiles()
    if (files.length === 0) return undefined

    let removed = 0

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE)

      const entries = batch
        .map((f) => ({ file: f, fileId: extractFileIdFromName(f.name) }))
        .filter((e): e is { file: T; fileId: string } => e.fileId !== null)

      const orphanedIds = await findOrphanedFileIds(
        db,
        entries.map((e) => e.fileId),
      )

      for (const entry of entries) {
        if (!orphanedIds.has(entry.fileId)) continue
        try {
          await deleteFile(entry.file)
          removed++
          logger.info('orphanScanner', 'file_removed', {
            fileId: entry.fileId,
          })
        } catch (error) {
          logger.error('orphanScanner', 'delete_failed', {
            fileId: entry.fileId,
            error: error as Error,
          })
        }
      }

      if (orphanedIds.size > 0) {
        await deleteFsMetadataBatch([...orphanedIds])
      }

      deps.onProgress?.(removed, files.length)

      await yieldToEventLoop()
    }

    if (removed > 0) {
      await deps.invalidateCache?.()
      logger.info('orphanScanner', 'summary', { removed })
    }
    return { removed }
  } catch (e) {
    logger.error('orphanScanner', 'failed', { error: e as Error })
    return undefined
  }
}

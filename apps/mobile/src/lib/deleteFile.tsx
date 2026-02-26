import { TRASH_AUTO_PURGE_AGE } from '@siastorage/core/config'
import { logger } from '@siastorage/logger'
import { db, withTransactionLock } from '../db'
import type { FileRecord } from '../stores/files'
import { readFileRecordsByIds } from '../stores/files'
import { removeFsFile } from '../stores/fs'
import {
  invalidateCacheLibraryAllStats,
  invalidateCacheLibraryLists,
} from '../stores/librarySwr'
import { removeTempDownloadFile } from '../stores/tempFs'
import { removeUploads } from '../stores/uploads'

/**
 * Move files to trash by setting trashedAt. Trashed files are hidden from
 * the library but can be restored. The updatedAt timestamp is bumped so
 * syncUp pushes the change to the indexer. Associated thumbnails are also
 * trashed.
 */
export async function trashFiles(fileIds: string[]): Promise<void> {
  if (fileIds.length === 0) return
  const now = Date.now()
  const placeholders = fileIds.map(() => '?').join(',')
  await withTransactionLock(async () => {
    await db().runAsync(
      `UPDATE files SET trashedAt = ?, updatedAt = ? WHERE id IN (${placeholders})`,
      now,
      now,
      ...fileIds,
    )
    await db().runAsync(
      `UPDATE files SET trashedAt = ?, updatedAt = ? WHERE thumbForId IN (${placeholders})`,
      now,
      now,
      ...fileIds,
    )
  })
  await invalidateCacheLibraryAllStats()
  invalidateCacheLibraryLists()
}

/**
 * Restore trashed files by clearing trashedAt. The updatedAt timestamp is
 * bumped so syncUp pushes the change to the indexer. Associated thumbnails
 * are also restored.
 */
export async function restoreFiles(fileIds: string[]): Promise<void> {
  if (fileIds.length === 0) return
  const now = Date.now()
  const placeholders = fileIds.map(() => '?').join(',')
  await withTransactionLock(async () => {
    await db().runAsync(
      `UPDATE files SET trashedAt = NULL, updatedAt = ? WHERE id IN (${placeholders})`,
      now,
      ...fileIds,
    )
    await db().runAsync(
      `UPDATE files SET trashedAt = NULL, updatedAt = ? WHERE thumbForId IN (${placeholders})`,
      now,
      ...fileIds,
    )
  })
  await invalidateCacheLibraryAllStats()
  invalidateCacheLibraryLists()
}

export async function permanentlyDeleteFile(file: FileRecord) {
  await permanentlyDeleteFiles([file])
}

/**
 * Permanently delete files by setting the deletedAt tombstone. Tombstoned
 * files are hidden from the UI and will never be resurrected by sync. The
 * actual remote object deletion is handled by syncUp, which calls
 * sdk.deleteObject() for each tombstoned file's objects on the next cycle.
 *
 * Local filesystem files are removed immediately. Any active uploads for
 * the files are cancelled.
 */
export async function permanentlyDeleteFiles(
  files: FileRecord[],
): Promise<void> {
  if (files.length === 0) return

  const ids = files.map((f) => f.id)

  removeUploads(ids)

  const now = Date.now()
  const placeholders = ids.map(() => '?').join(',')
  await withTransactionLock(async () => {
    await db().runAsync(
      `UPDATE files SET deletedAt = ?, trashedAt = COALESCE(trashedAt, ?), updatedAt = ? WHERE id IN (${placeholders})`,
      now,
      now,
      now,
      ...ids,
    )
    await db().runAsync(
      `UPDATE files SET deletedAt = ?, trashedAt = COALESCE(trashedAt, ?), updatedAt = ? WHERE thumbForId IN (${placeholders})`,
      now,
      now,
      now,
      ...ids,
    )
  })
  await invalidateCacheLibraryAllStats()
  invalidateCacheLibraryLists()

  const thumbs = await db().getAllAsync<{
    id: string
    type: string
    localId: string | null
  }>(
    `SELECT id, type, localId FROM files WHERE thumbForId IN (${placeholders})`,
    ...ids,
  )
  await Promise.all(
    [...files, ...thumbs].flatMap((f) => [
      removeFsFile(f),
      removeTempDownloadFile(f),
    ]),
  )
}

/**
 * Permanently delete files that have been in the trash longer than
 * TRASH_AUTO_PURGE_AGE (30 days). Sets the deletedAt tombstone so
 * syncUp will handle remote object cleanup on the next tick.
 */
export async function autoPurgeOldTrashedFiles() {
  try {
    const cutoff = Date.now() - TRASH_AUTO_PURGE_AGE
    const rows = await db().getAllAsync<{ id: string }>(
      `SELECT id FROM files WHERE trashedAt IS NOT NULL AND trashedAt < ? AND deletedAt IS NULL AND kind = 'file'`,
      cutoff,
    )
    if (rows.length === 0) return
    const ids = rows.map((r) => r.id)
    const files = await readFileRecordsByIds(ids)
    if (files.length > 0) {
      logger.info('deleteFile', 'auto_purge_trashed', { count: files.length })
      await permanentlyDeleteFiles(files)
    }
  } catch (error) {
    logger.error('deleteFile', 'auto_purge_failed', { error: error as Error })
  }
}

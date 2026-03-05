import { logger } from '@siastorage/logger'
import type { DatabaseAdapter } from '../../adapters/db'
import { TRASH_AUTO_PURGE_AGE } from '../../config'
import { readFileRecordsByIds } from './files'
import { queryThumbnailFileInfoByFileIds } from './thumbnails'

type FileInfo = { id: string; type: string; localId: string | null }

export type FileCleanupDeps = {
  removeFile: (file: FileInfo) => Promise<void>
  removeUploads: (fileIds: string[]) => void
}

export async function trashFiles(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<void> {
  if (fileIds.length === 0) return
  const now = Date.now()
  const placeholders = fileIds.map(() => '?').join(',')
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE files SET trashedAt = ?, updatedAt = ? WHERE id IN (${placeholders})`,
      now,
      now,
      ...fileIds,
    )
    await db.runAsync(
      `UPDATE files SET trashedAt = ?, updatedAt = ? WHERE thumbForId IN (${placeholders})`,
      now,
      now,
      ...fileIds,
    )
  })
}

export async function restoreFiles(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<void> {
  if (fileIds.length === 0) return
  const now = Date.now()
  const placeholders = fileIds.map(() => '?').join(',')
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE files SET trashedAt = NULL, updatedAt = ? WHERE id IN (${placeholders})`,
      now,
      ...fileIds,
    )
    await db.runAsync(
      `UPDATE files SET trashedAt = NULL, updatedAt = ? WHERE thumbForId IN (${placeholders})`,
      now,
      ...fileIds,
    )
  })
}

export async function permanentlyDeleteFiles(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<void> {
  if (fileIds.length === 0) return
  const now = Date.now()
  const placeholders = fileIds.map(() => '?').join(',')
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE files SET deletedAt = ?, trashedAt = COALESCE(trashedAt, ?), updatedAt = ? WHERE id IN (${placeholders})`,
      now,
      now,
      now,
      ...fileIds,
    )
    await db.runAsync(
      `UPDATE files SET deletedAt = ?, trashedAt = COALESCE(trashedAt, ?), updatedAt = ? WHERE thumbForId IN (${placeholders})`,
      now,
      now,
      now,
      ...fileIds,
    )
  })
}

export async function autoPurgeOldTrashedFiles(
  db: DatabaseAdapter,
): Promise<string[]> {
  const cutoff = Date.now() - TRASH_AUTO_PURGE_AGE
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM files WHERE trashedAt IS NOT NULL AND trashedAt < ? AND deletedAt IS NULL AND kind = 'file'`,
    cutoff,
  )
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  await permanentlyDeleteFiles(db, ids)
  return ids
}

export async function permanentlyDeleteFilesWithCleanup(
  db: DatabaseAdapter,
  files: FileInfo[],
  deps: FileCleanupDeps,
): Promise<void> {
  if (files.length === 0) return
  const ids = files.map((f) => f.id)
  deps.removeUploads(ids)
  await permanentlyDeleteFiles(db, ids)
  const thumbs = await queryThumbnailFileInfoByFileIds(db, ids)
  await Promise.all([...files, ...thumbs].map((f) => deps.removeFile(f)))
}

export async function autoPurgeOldTrashedFilesWithCleanup(
  db: DatabaseAdapter,
  deps: FileCleanupDeps,
): Promise<void> {
  try {
    const purgedIds = await autoPurgeOldTrashedFiles(db)
    if (purgedIds.length === 0) return
    const files = await readFileRecordsByIds(db, purgedIds)
    if (files.length === 0) return
    logger.info('deleteFile', 'auto_purge_trashed', { count: files.length })
    deps.removeUploads(purgedIds)
    const thumbs = await queryThumbnailFileInfoByFileIds(db, purgedIds)
    await Promise.all([...files, ...thumbs].map((f) => deps.removeFile(f)))
  } catch (error) {
    logger.error('deleteFile', 'auto_purge_failed', { error: error as Error })
  }
}

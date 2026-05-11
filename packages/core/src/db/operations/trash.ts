import type { DatabaseAdapter } from '../../adapters/db'
import { TRASH_AUTO_PURGE_AGE } from '../../config'
import { processInBatches } from '../sql'
import { recalculateCurrentForGroups } from './files'
import { flagObjectsForFiles } from './localObjects'

async function getGroupsForFileIds(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<{ name: string; directoryId: string | null }[]> {
  const ph = fileIds.map(() => '?').join(',')
  return db.getAllAsync<{ name: string; directoryId: string | null }>(
    `SELECT DISTINCT name, directoryId FROM files WHERE id IN (${ph}) AND kind = 'file'`,
    ...fileIds,
  )
}

// Flag the objects of these files and their thumbnails so sync-up deletes both
// remotely. (Trash/restore flag only files — a thumb's trashedAt isn't pushed.)
// Thumb ids aren't in hand, so reach them via thumbForId.
async function flagObjectsForTombstonedFilesAndThumbnails(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<void> {
  await flagObjectsForFiles(db, fileIds)
  const ph = fileIds.map(() => '?').join(',')
  await db.runAsync(
    `UPDATE objects SET needsSyncUp = 1 WHERE fileId IN (SELECT id FROM files WHERE thumbForId IN (${ph}))`,
    ...fileIds,
  )
}

export async function trashFilesAndThumbnails(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<void> {
  if (fileIds.length === 0) return
  const groups = await getGroupsForFileIds(db, fileIds)
  const now = Date.now()
  const ph = fileIds.map(() => '?').join(',')
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE files SET trashedAt = ?, updatedAt = ? WHERE id IN (${ph})`,
      now,
      now,
      ...fileIds,
    )
    await db.runAsync(
      `UPDATE files SET trashedAt = ?, updatedAt = ? WHERE thumbForId IN (${ph})`,
      now,
      now,
      ...fileIds,
    )
    await flagObjectsForFiles(db, fileIds)
  })
  await recalculateCurrentForGroups(db, groups)
}

export async function restoreFilesAndThumbnails(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<void> {
  if (fileIds.length === 0) return
  const groups = await getGroupsForFileIds(db, fileIds)
  const now = Date.now()
  const ph = fileIds.map(() => '?').join(',')
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE files SET trashedAt = NULL, updatedAt = ? WHERE id IN (${ph})`,
      now,
      ...fileIds,
    )
    await db.runAsync(
      `UPDATE files SET trashedAt = NULL, updatedAt = ? WHERE thumbForId IN (${ph})`,
      now,
      ...fileIds,
    )
    await flagObjectsForFiles(db, fileIds)
  })
  await recalculateCurrentForGroups(db, groups)
}

export async function tombstoneFilesAndThumbnails(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<void> {
  if (fileIds.length === 0) return
  const groups = await getGroupsForFileIds(db, fileIds)
  const now = Date.now()
  const ph = fileIds.map(() => '?').join(',')
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE files SET deletedAt = ?, trashedAt = COALESCE(trashedAt, ?), updatedAt = ? WHERE id IN (${ph})`,
      now,
      now,
      now,
      ...fileIds,
    )
    await db.runAsync(
      `UPDATE files SET deletedAt = ?, trashedAt = COALESCE(trashedAt, ?), updatedAt = ? WHERE thumbForId IN (${ph})`,
      now,
      now,
      now,
      ...fileIds,
    )
    await flagObjectsForTombstonedFilesAndThumbnails(db, fileIds)
  })
  await recalculateCurrentForGroups(db, groups)
}

export async function autoPurgeOldTrashedFiles(
  db: DatabaseAdapter,
  onBatch?: (purgedIds: string[]) => Promise<void>,
): Promise<number> {
  const cutoff = Date.now() - TRASH_AUTO_PURGE_AGE
  return processInBatches<{ id: string }>(
    db,
    `SELECT id FROM files WHERE trashedAt IS NOT NULL AND trashedAt < ? AND deletedAt IS NULL AND kind = 'file'`,
    [cutoff],
    500,
    async (rows) => {
      const ids = rows.map((r) => r.id)
      await tombstoneFilesAndThumbnails(db, ids)
      if (onBatch) await onBatch(ids)
    },
  )
}

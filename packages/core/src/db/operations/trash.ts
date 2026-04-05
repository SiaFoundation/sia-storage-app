import type { DatabaseAdapter } from '../../adapters/db'
import { TRASH_AUTO_PURGE_AGE } from '../../config'
import { recalculateCurrentForGroups } from './files'

async function getGroupsForFileIds(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<{ name: string; directoryId: string | null }[]> {
  const placeholders = fileIds.map(() => '?').join(',')
  return db.getAllAsync<{ name: string; directoryId: string | null }>(
    `SELECT DISTINCT name, directoryId FROM files WHERE id IN (${placeholders}) AND kind = 'file'`,
    ...fileIds,
  )
}

export async function trashFiles(db: DatabaseAdapter, fileIds: string[]): Promise<void> {
  if (fileIds.length === 0) return
  const groups = await getGroupsForFileIds(db, fileIds)
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
  await recalculateCurrentForGroups(db, groups)
}

export async function restoreFiles(db: DatabaseAdapter, fileIds: string[]): Promise<void> {
  if (fileIds.length === 0) return
  const groups = await getGroupsForFileIds(db, fileIds)
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
  await recalculateCurrentForGroups(db, groups)
}

export async function permanentlyDeleteFiles(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<void> {
  if (fileIds.length === 0) return
  const groups = await getGroupsForFileIds(db, fileIds)
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
  await recalculateCurrentForGroups(db, groups)
}

export async function autoPurgeOldTrashedFiles(db: DatabaseAdapter): Promise<string[]> {
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

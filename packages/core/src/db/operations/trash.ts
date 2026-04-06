import type { DatabaseAdapter } from '../../adapters/db'
import { TRASH_AUTO_PURGE_AGE } from '../../config'
import { processInBatches } from '../sql'
import { recalculateCurrentForGroups } from './files'

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

export async function trashFiles(db: DatabaseAdapter, fileIds: string[]): Promise<void> {
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
  })
  await recalculateCurrentForGroups(db, groups)
}

export async function restoreFiles(db: DatabaseAdapter, fileIds: string[]): Promise<void> {
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
      await permanentlyDeleteFiles(db, ids)
      if (onBatch) await onBatch(ids)
    },
  )
}

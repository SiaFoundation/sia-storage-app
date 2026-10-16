import type { DatabaseAdapter, SQLParam } from '../../adapters/db'
import { TRASH_AUTO_PURGE_AGE } from '../../config'
import { naturalSortKey } from '../../lib/naturalSortKey'
import type { RestoredFile } from '../../types/files'
import { processInBatches, transaction } from '../sql'
import { recalculateCurrentForGroups } from './files'
import { flagObjectsForFiles } from './localObjects'

/** Ids per statement when deleting in bulk, as the hourly purge does. */
const TOMBSTONE_BATCH = 500

const TRASHED_FILES = `kind = 'file' AND trashedAt IS NOT NULL AND deletedAt IS NULL`

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

/**
 * The files among `fileIds` newest version first, by `(updatedAt, id)` as a
 * version stack picks its current row, so restamping them in this order keeps
 * the version shown the same.
 */
async function newestFirst(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<{ id: string; updatedAt: number }[]> {
  const ph = fileIds.map(() => '?').join(',')
  return db.getAllAsync<{ id: string; updatedAt: number }>(
    `SELECT id, updatedAt FROM files WHERE id IN (${ph})
     ORDER BY updatedAt DESC, id DESC`,
    ...fileIds,
  )
}

/**
 * Gives `rows`, newest first, `updatedAt` values one apart counting down
 * from `base`, so they keep their order. The newest `updatedAt` in a file's
 * name and folder decides which version is current, so one shared value
 * would leave the order to the ids.
 */
async function stampInOrder(
  tx: DatabaseAdapter,
  rows: { id: string }[],
  base: number,
  set?: { sql: string; values: SQLParam[] },
): Promise<void> {
  const assignments = set ? `${set.sql}, updatedAt = ?` : 'updatedAt = ?'
  for (let i = 0; i < rows.length; i++) {
    await tx.runAsync(
      `UPDATE files SET ${assignments} WHERE id = ?`,
      ...(set?.values ?? []),
      base - i,
      rows[i].id,
    )
  }
}

export async function trashFilesAndThumbnails(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<void> {
  if (fileIds.length === 0) return
  const now = Date.now()
  const ph = fileIds.map(() => '?').join(',')
  await db.withTransactionAsync(async (tx) => {
    const groups = await getGroupsForFileIds(tx, fileIds)
    const rows = await newestFirst(tx, fileIds)
    // Above every row's own clock, not only the wall clock: a row can carry
    // another device's later clock, and a lower stamp would lose the sync race.
    const base = Math.max(now, (rows[0]?.updatedAt ?? 0) + rows.length)
    await stampInOrder(tx, rows, base, { sql: 'trashedAt = ?', values: [now] })
    await tx.runAsync(
      `UPDATE files SET trashedAt = ?, updatedAt = ? WHERE thumbForId IN (${ph})`,
      now,
      now,
      ...fileIds,
    )
    await flagObjectsForFiles(tx, fileIds)
    await recalculateCurrentForGroups(tx, groups)
  })
}

/** The name with ` (restored)` or ` (restored n)` before its extension. */
function restoredName(name: string, n: number): string {
  const dot = name.lastIndexOf('.')
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  return `${stem} (restored${n > 1 ? ` ${n}` : ''})${ext}`
}

/** Whether a live file other than the stacks `ownStacks` holds `name` in the folder. */
async function nameTaken(
  tx: DatabaseAdapter,
  name: string,
  directoryId: string | null,
  ownStacks: string[],
): Promise<boolean> {
  const row = await tx.getFirstAsync(
    `SELECT 1 FROM files WHERE name = ? AND directoryId IS ? AND kind = 'file'
       AND trashedAt IS NULL AND deletedAt IS NULL
       AND stackId NOT IN (${ownStacks.map(() => '?').join(',')}) LIMIT 1`,
    name,
    directoryId,
    ...ownStacks,
  )
  return row !== null
}

/**
 * Takes these files out of the trash. Ids no longer in the trash, such as a
 * file the hourly purge deleted since the caller read it, are skipped.
 *
 * The versions trashed together come back together. When another file holds
 * their name, saved there since the trash or restored before them, they come
 * back renamed, `photo (restored).jpg` and then `photo (restored 2).jpg`,
 * rather than joining its versions, where the newer stamp would decide which
 * one shows. Versions of their own file left out of the trash do not count,
 * since every version of a file carries its `stackId`, and a file saved under
 * the name after the whole file was trashed starts a stack of its own. Each
 * comes back just above its own `updatedAt` from the trash, which is enough
 * for other devices to take the change.
 */
export async function restoreFilesAndThumbnails(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<RestoredFile[]> {
  if (fileIds.length === 0) return []
  return transaction(db, async (tx) => {
    const ph = fileIds.map(() => '?').join(',')
    const trashed = await tx.getAllAsync<{ id: string }>(
      `SELECT id FROM files WHERE id IN (${ph}) AND ${TRASHED_FILES}`,
      ...fileIds,
    )
    if (trashed.length === 0) return []
    const ids = trashed.map((r) => r.id)
    const idPh = ids.map(() => '?').join(',')
    const groups = await getGroupsForFileIds(tx, ids)
    // Files trashed together share a `trashedAt`, so each of these is one
    // file's versions, oldest trash first so a later one is the one renamed.
    const entries = await tx.getAllAsync<{
      name: string
      directoryId: string | null
      trashedAt: number
    }>(
      `SELECT name, directoryId, trashedAt FROM files WHERE id IN (${idPh})
       GROUP BY name, directoryId, trashedAt ORDER BY trashedAt`,
      ...ids,
    )
    const restored: RestoredFile[] = []
    for (const entry of entries) {
      const rows = await tx.getAllAsync<{ id: string; updatedAt: number; stackId: string }>(
        `SELECT id, updatedAt, stackId FROM files
         WHERE id IN (${idPh}) AND name = ? AND directoryId IS ? AND trashedAt = ?
         ORDER BY updatedAt DESC, id DESC`,
        ...ids,
        entry.name,
        entry.directoryId,
        entry.trashedAt,
      )
      const ownStacks = [...new Set(rows.map((r) => r.stackId))]
      let name = entry.name
      for (let n = 1; await nameTaken(tx, name, entry.directoryId, ownStacks); n++) {
        name = restoredName(entry.name, n)
      }
      const set =
        name === entry.name
          ? { sql: 'trashedAt = NULL', values: [] }
          : {
              sql: 'trashedAt = NULL, name = ?, nameSortKey = ?',
              values: [name, naturalSortKey(name)],
            }
      await stampInOrder(tx, rows, rows[0].updatedAt + rows.length, set)
      if (name !== entry.name) groups.push({ name, directoryId: entry.directoryId })
      restored.push({
        id: rows[0].id,
        name,
        renamedFrom: name === entry.name ? null : entry.name,
      })
    }
    await tx.runAsync(
      `UPDATE files SET trashedAt = NULL, updatedAt = ? WHERE thumbForId IN (${idPh})`,
      Date.now(),
      ...ids,
    )
    await flagObjectsForFiles(tx, ids)
    await recalculateCurrentForGroups(tx, groups)
    return restored
  })
}

/** Restores the trash entries `entryIds` name, reading them in the same transaction. */
export async function restoreTrashEntries(
  db: DatabaseAdapter,
  entryIds: string[],
): Promise<RestoredFile[]> {
  return transaction(db, async (tx) => {
    const files = await queryTrashEntryFiles(tx, entryIds)
    return restoreFilesAndThumbnails(
      tx,
      files.map((f) => f.id),
    )
  })
}

export async function tombstoneFilesAndThumbnails(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<void> {
  if (fileIds.length === 0) return
  const now = Date.now()
  const ph = fileIds.map(() => '?').join(',')
  await db.withTransactionAsync(async (tx) => {
    const groups = await getGroupsForFileIds(tx, fileIds)
    await tx.runAsync(
      `UPDATE files SET deletedAt = ?, trashedAt = COALESCE(trashedAt, ?), updatedAt = ? WHERE id IN (${ph})`,
      now,
      now,
      now,
      ...fileIds,
    )
    await tx.runAsync(
      `UPDATE files SET deletedAt = ?, trashedAt = COALESCE(trashedAt, ?), updatedAt = ? WHERE thumbForId IN (${ph})`,
      now,
      now,
      now,
      ...fileIds,
    )
    await flagObjectsForTombstonedFilesAndThumbnails(tx, fileIds)
    await recalculateCurrentForGroups(tx, groups)
  })
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
      // Selected outside a transaction, so a restore can land between the
      // select and the delete. The rows are read again in the delete's own
      // transaction, and only those still due are deleted and cleaned up.
      const ids = await transaction(db, async (tx) => {
        const ph = rows.map(() => '?').join(',')
        const due = await tx.getAllAsync<{ id: string }>(
          `SELECT id FROM files WHERE id IN (${ph}) AND trashedAt IS NOT NULL
             AND trashedAt < ? AND deletedAt IS NULL AND kind = 'file'`,
          ...rows.map((r) => r.id),
          cutoff,
        )
        const dueIds = due.map((r) => r.id)
        await tombstoneFilesAndThumbnails(tx, dueIds)
        return dueIds
      })
      if (onBatch && ids.length > 0) await onBatch(ids)
    },
  )
}

/**
 * A file in the trash with the versions trashed along with it. Trashing a
 * file gives all its versions one `trashedAt`, so an entry is the files
 * sharing a name, folder and `trashedAt`. The newest of them stands for it,
 * and its id names the entry.
 */
export type TrashEntryRow = {
  id: string
  name: string
  type: string
  size: number
  directoryId: string | null
  trashedAt: number
  versions: number
}

/** Trash entries, the most recently trashed first. */
export async function queryTrashEntries(
  db: DatabaseAdapter,
  limit: number,
  offset: number,
): Promise<TrashEntryRow[]> {
  return db.getAllAsync<TrashEntryRow>(
    `SELECT id, name, type, size, directoryId, trashedAt, versions FROM (
       SELECT id, name, type, size, directoryId, trashedAt,
         COUNT(*) OVER entry AS versions,
         ROW_NUMBER() OVER (entry ORDER BY updatedAt DESC, id DESC) AS rn
       FROM files WHERE ${TRASHED_FILES}
       WINDOW entry AS (PARTITION BY name, directoryId, trashedAt)
     ) WHERE rn = 1
     ORDER BY trashedAt DESC, id DESC
     LIMIT ? OFFSET ?`,
    limit,
    offset,
  )
}

export async function queryTrashEntryCount(db: DatabaseAdapter): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM (
       SELECT 1 FROM files WHERE ${TRASHED_FILES} GROUP BY name, directoryId, trashedAt
     )`,
  )
  return row?.n ?? 0
}

/** Every file in the entries `entryIds` name, with its type. */
export async function queryTrashEntryFiles(
  db: DatabaseAdapter,
  entryIds: string[],
): Promise<{ id: string; type: string }[]> {
  if (entryIds.length === 0) return []
  const ph = entryIds.map(() => '?').join(',')
  return db.getAllAsync<{ id: string; type: string }>(
    `SELECT DISTINCT f.id, f.type FROM files f
     JOIN files e ON f.name = e.name AND f.directoryId IS e.directoryId AND f.trashedAt = e.trashedAt
     WHERE e.id IN (${ph}) AND f.kind = 'file' AND f.trashedAt IS NOT NULL AND f.deletedAt IS NULL`,
    ...entryIds,
  )
}

/** Every file in the trash, with its type. */
export async function queryTrashedFiles(
  db: DatabaseAdapter,
): Promise<{ id: string; type: string }[]> {
  return db.getAllAsync<{ id: string; type: string }>(
    `SELECT id, type FROM files WHERE ${TRASHED_FILES}`,
  )
}

/**
 * Deletes the trash entries `entryIds` name for good, reading them in the
 * same transaction so a restore that lands first keeps its files. Returns
 * the files deleted, whose bytes the caller removes.
 */
export async function tombstoneTrashEntries(
  db: DatabaseAdapter,
  entryIds: string[],
): Promise<{ id: string; type: string }[]> {
  return transaction(db, async (tx) => {
    const files = await queryTrashEntryFiles(tx, entryIds)
    await tombstoneFilesAndThumbnails(
      tx,
      files.map((f) => f.id),
    )
    return files
  })
}

/** Deletes everything in the trash for good, as `tombstoneTrashEntries` does an entry. */
export async function tombstoneTrash(db: DatabaseAdapter): Promise<{ id: string; type: string }[]> {
  return transaction(db, async (tx) => {
    const files = await queryTrashedFiles(tx)
    // In batches, since each id is a bound parameter and a large trash holds
    // more versions than SQLite allows in one statement.
    for (let i = 0; i < files.length; i += TOMBSTONE_BATCH) {
      await tombstoneFilesAndThumbnails(
        tx,
        files.slice(i, i + TOMBSTONE_BATCH).map((f) => f.id),
      )
    }
    return files
  })
}

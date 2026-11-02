import type { DatabaseAdapter, SQLParam } from '../../adapters/db'
import { TRASH_AUTO_PURGE_AGE } from '../../config'
import { naturalSortKey } from '../../lib/naturalSortKey'
import type { RestoredFile } from '../../types/files'
import { processInBatches, transaction } from '../sql'
import { deleteEmptyDirectories, getOrCreateDirectoryAtPath } from './directories'
import { queryDirectoryIdsForFiles, recalculateCurrentForGroups } from './files'
import { flagObjectsForFiles } from './localObjects'
import { takeTrashedFilesOffLinks } from './shareLinks'

/** Ids per statement when deleting in bulk, as the hourly purge does. */
const TOMBSTONE_BATCH = 500

/** `ids` split into lists of TOMBSTONE_BATCH, each small enough to bind in one statement. */
function batches(ids: string[]): string[][] {
  const out: string[][] = []
  for (let i = 0; i < ids.length; i += TOMBSTONE_BATCH) out.push(ids.slice(i, i + TOMBSTONE_BATCH))
  return out
}

const TRASHED_FILES = `kind = 'file' AND trashedAt IS NOT NULL AND deletedAt IS NULL`

/** The folder path a trashed row goes back to, '' for the top of the library. */
const TRASHED_FROM = `coalesce(trashedFrom, '')`

/** The path of the folder a row sits in, '' for the top of the library. */
const FOLDER_PATH = `coalesce((SELECT d.path FROM directories d WHERE d.id = files.directoryId), '')`

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
 * would leave the order to the ids. One statement for every row: the ids go
 * in as a JSON array and each row's place in it is its offset from `base`.
 */
async function stampInOrder(
  tx: DatabaseAdapter,
  rows: { id: string }[],
  base: number,
  set?: { sql: string; values: SQLParam[] },
): Promise<void> {
  if (rows.length === 0) return
  const assignments = set ? `${set.sql}, updatedAt = ? - j.key` : 'updatedAt = ? - j.key'
  await tx.runAsync(
    `UPDATE files SET ${assignments} FROM json_each(?) j WHERE files.id = j.value`,
    ...(set?.values ?? []),
    base,
    JSON.stringify(rows.map((r) => r.id)),
  )
}

/**
 * Moves files and their thumbnails to the trash. Each file leaves its folder
 * and keeps the folder's path in trashedFrom, which restore recreates. A
 * folder this leaves with no live file is deleted here too, unless
 * `keepFolders` is set. Other devices learn of the trash only from the files,
 * and their sync-down deletes a folder whose last live file has left it.
 *
 * `folder` is the path of a folder being deleted with these files, which
 * groups them as one trash entry. A folder delete trashes its files in
 * batches, so it passes one `trashedAt` for all of them and a running `base`
 * that keeps version order across batches.
 */
export async function trashFilesAndThumbnails(
  db: DatabaseAdapter,
  fileIds: string[],
  opts: { trashedAt?: number; folder?: string; base?: number; keepFolders?: boolean } = {},
): Promise<void> {
  if (fileIds.length === 0) return
  const now = opts.trashedAt ?? Date.now()
  const ph = fileIds.map(() => '?').join(',')
  await db.withTransactionAsync(async (tx) => {
    const groups = await getGroupsForFileIds(tx, fileIds)
    const folders = await queryDirectoryIdsForFiles(tx, fileIds)
    const rows = await newestFirst(tx, fileIds)
    // Above every row's own clock, not only the wall clock: a row can carry
    // another device's later clock, and a lower stamp would lose the sync race.
    const base = opts.base ?? Math.max(now, (rows[0]?.updatedAt ?? 0) + rows.length)
    // A row already in the trash keeps the location and entry it was trashed
    // with. SQLite reads every right-hand side from the row before the update.
    await stampInOrder(tx, rows, base, {
      sql: `trashedAt = ?,
        trashedFrom = CASE WHEN trashedAt IS NULL THEN ${FOLDER_PATH} ELSE trashedFrom END,
        trashedFolder = CASE WHEN trashedAt IS NULL THEN ? ELSE trashedFolder END,
        directoryId = NULL`,
      values: [now, opts.folder ?? null],
    })
    await tx.runAsync(
      `UPDATE files SET trashedAt = ?, updatedAt = ? WHERE thumbForId IN (${ph})`,
      now,
      now,
      ...fileIds,
    )
    await flagObjectsForFiles(tx, fileIds)
    await takeTrashedFilesOffLinks(tx, fileIds)
    await recalculateCurrentForGroups(tx, groups)
    if (!opts.keepFolders) await deleteEmptyDirectories(tx, folders)
  })
}

/** The name with ` (restored)` or ` (restored n)` before its extension. */
function restoredName(name: string, n: number): string {
  const dot = name.lastIndexOf('.')
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  return `${stem} (restored${n > 1 ? ` ${n}` : ''})${ext}`
}

/**
 * The stack ids of the live files holding each name in a folder, read once per
 * folder for every name a restore puts back, and once more for each
 * ` (restored n)` name a clash makes it try.
 */
class FolderNames {
  private byFolder = new Map<string | null, Map<string, Set<string>>>()

  constructor(private tx: DatabaseAdapter) {}

  async load(directoryId: string | null, names: string[]): Promise<void> {
    const known = this.folder(directoryId)
    const wanted = names.filter((n) => !known.has(n))
    if (wanted.length === 0) return
    for (const n of wanted) known.set(n, new Set())
    // CROSS JOIN reads the names first and finds each by the name index.
    // Left to choose, SQLite reads every file and checks it against the names.
    const rows = await this.tx.getAllAsync<{ name: string; stackId: string }>(
      `SELECT f.name, f.stackId FROM json_each(?) j CROSS JOIN files f
         ON f.name = j.value AND f.directoryId IS ?
       WHERE f.kind = 'file' AND f.trashedAt IS NULL AND f.deletedAt IS NULL`,
      JSON.stringify(wanted),
      directoryId,
    )
    for (const r of rows) known.get(r.name)?.add(r.stackId)
  }

  /** Whether a live file other than the stacks `ownStacks` holds `name` in the folder. */
  async taken(directoryId: string | null, name: string, ownStacks: Set<string>): Promise<boolean> {
    await this.load(directoryId, [name])
    const stacks = this.folder(directoryId).get(name) ?? new Set()
    return [...stacks].some((s) => !ownStacks.has(s))
  }

  /** Records `name` as held by `stacks`, as the rows this restore puts back hold it. */
  claim(directoryId: string | null, name: string, stacks: Set<string>): void {
    const known = this.folder(directoryId)
    known.set(name, new Set([...(known.get(name) ?? []), ...stacks]))
  }

  private folder(directoryId: string | null): Map<string, Set<string>> {
    let known = this.byFolder.get(directoryId)
    if (!known) this.byFolder.set(directoryId, (known = new Map()))
    return known
  }
}

/**
 * Takes these files out of the trash. Ids no longer in the trash, such as a
 * file the hourly purge deleted since the caller read it, are skipped.
 *
 * Each file goes back to the folder path it was trashed from, which is
 * created again, parents included, when it no longer exists, and merged into
 * when it does. Restoring a deleted folder's files in any order rebuilds the
 * same tree.
 *
 * The versions trashed together come back together. When another file holds
 * their name in that folder, saved there since the trash or restored before
 * them, they come back renamed, `photo (restored).jpg` and then
 * `photo (restored 2).jpg`, rather than joining its versions, where the newer
 * stamp would decide which one shows. Versions of their own file left out of
 * the trash do not count, since every version of a file carries its
 * `stackId`, and a file saved under the name after the whole file was trashed
 * starts a stack of its own. Each comes back just above its own `updatedAt`
 * from the trash, which is enough for other devices to take the change.
 */
export async function restoreFilesAndThumbnails(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<RestoredFile[]> {
  if (fileIds.length === 0) return []
  return transaction(db, async (tx) => {
    type TrashedRow = {
      id: string
      name: string
      fromPath: string
      trashedAt: number
      updatedAt: number
      stackId: string
    }
    // Read in batches, since a deleted folder's entry can hold more files
    // than SQLite takes bound parameters in one statement.
    const trashed: TrashedRow[] = []
    for (const batch of batches(fileIds)) {
      trashed.push(
        ...(await tx.getAllAsync<TrashedRow>(
          `SELECT id, name, ${TRASHED_FROM} AS fromPath, trashedAt, updatedAt, stackId
           FROM files WHERE id IN (${batch.map(() => '?').join(',')}) AND ${TRASHED_FILES}`,
          ...batch,
        )),
      )
    }
    if (trashed.length === 0) return []
    const ids = trashed.map((r) => r.id)
    // The recount skips trashed rows, so only the stacks restored into change.
    const groups: { name: string; directoryId: string | null }[] = []
    // Files trashed together share a `trashedAt`, so each of these is one
    // file's versions, oldest trash first so a later one is the one renamed.
    const entries = new Map<string, TrashedRow[]>()
    for (const row of trashed) {
      const key = JSON.stringify([row.name, row.fromPath, row.trashedAt])
      const rows = entries.get(key)
      if (rows) rows.push(row)
      else entries.set(key, [row])
    }
    const ordered = [...entries.values()].sort((a, b) => a[0].trashedAt - b[0].trashedAt)

    const folderIds = new Map<string, string | null>()
    for (const { fromPath } of trashed) {
      if (folderIds.has(fromPath)) continue
      folderIds.set(
        fromPath,
        fromPath === '' ? null : (await getOrCreateDirectoryAtPath(tx, fromPath)).id,
      )
    }
    const names = new FolderNames(tx)
    const namesByFolder = new Map<string | null, Set<string>>()
    for (const { name, fromPath } of trashed) {
      const directoryId = folderIds.get(fromPath) ?? null
      namesByFolder.set(directoryId, (namesByFolder.get(directoryId) ?? new Set()).add(name))
    }
    for (const [directoryId, folderNames] of namesByFolder) {
      await names.load(directoryId, [...folderNames])
    }

    const writes: {
      id: string
      d: string | null
      n: string | null
      k: string | null
      u: number
    }[] = []
    const restored: RestoredFile[] = []
    for (const rows of ordered) {
      rows.sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      const { name: original, fromPath } = rows[0]
      const directoryId = folderIds.get(fromPath) ?? null
      const ownStacks = new Set(rows.map((r) => r.stackId))
      let name = original
      for (let n = 1; await names.taken(directoryId, name, ownStacks); n++) {
        name = restoredName(original, n)
      }
      names.claim(directoryId, name, ownStacks)
      const renamed = name !== original
      // Each comes back just above its own `updatedAt`, in version order.
      const base = rows[0].updatedAt + rows.length
      rows.forEach((row, i) =>
        writes.push({
          id: row.id,
          d: directoryId,
          n: renamed ? name : null,
          k: renamed ? naturalSortKey(name) : null,
          u: base - i,
        }),
      )
      groups.push({ name, directoryId })
      restored.push({ id: rows[0].id, name, renamedFrom: renamed ? original : null })
    }
    await tx.runAsync(
      `UPDATE files SET trashedAt = NULL, trashedFrom = NULL, trashedFolder = NULL,
         directoryId = json_extract(j.value, '$.d'),
         name = coalesce(json_extract(j.value, '$.n'), files.name),
         nameSortKey = coalesce(json_extract(j.value, '$.k'), files.nameSortKey),
         updatedAt = json_extract(j.value, '$.u')
       FROM json_each(?) j WHERE files.id = json_extract(j.value, '$.id')`,
      JSON.stringify(writes),
    )
    const now = Date.now()
    for (const batch of batches(ids)) {
      await tx.runAsync(
        `UPDATE files SET trashedAt = NULL, updatedAt = ? WHERE thumbForId IN (${batch.map(() => '?').join(',')})`,
        now,
        ...batch,
      )
      await flagObjectsForFiles(tx, batch)
    }
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
    const folders = await queryDirectoryIdsForFiles(tx, fileIds)
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
    // A live file deleted for good can be the last one in its folder.
    await deleteEmptyDirectories(tx, folders)
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
 * One item in the trash. A `file` entry is a file with the versions trashed
 * along with it: trashing a file gives all its versions one `trashedAt`, so
 * it is the rows sharing a name, original folder and `trashedAt`. A `folder`
 * entry is every file a folder delete took into the trash, the rows sharing
 * a `trashedFolder` and `trashedAt`. The newest file stands for either kind,
 * and its id names the entry.
 *
 * For a file, `name` is the file name and `location` the folder path it
 * restores to. For a folder, `name` is the deleted folder's path, `files`
 * counts the files in it, and `size` adds up their newest versions.
 */
export type TrashEntryRow = {
  id: string
  kind: 'file' | 'folder'
  name: string
  type: string
  size: number
  location: string
  trashedAt: number
  versions: number
  files: number
}

/**
 * The newest version of each trashed file, with its version count, its
 * original folder and the deleted folder it went with.
 */
const TRASHED_STACKS = `
  SELECT id, name, type, size, trashedAt, trashedFolder, updatedAt, location, versions FROM (
    SELECT id, name, type, size, trashedAt, trashedFolder, updatedAt,
      ${TRASHED_FROM} AS location,
      COUNT(*) OVER stack AS versions,
      ROW_NUMBER() OVER (stack ORDER BY updatedAt DESC, id DESC) AS rn
    FROM files WHERE ${TRASHED_FILES}
    WINDOW stack AS (PARTITION BY trashedFolder, name, ${TRASHED_FROM}, trashedAt)
  ) WHERE rn = 1`

const TRASH_ENTRIES = `
  WITH stacks AS (${TRASHED_STACKS})
  SELECT id, 'file' AS kind, name, type, size, location, trashedAt, versions, 1 AS files
  FROM stacks WHERE trashedFolder IS NULL
  UNION ALL
  SELECT id, 'folder', trashedFolder, '', total, '', trashedAt, versions, files FROM (
    SELECT id, trashedFolder, trashedAt,
      SUM(size) OVER folder AS total,
      SUM(versions) OVER folder AS versions,
      COUNT(*) OVER folder AS files,
      ROW_NUMBER() OVER (folder ORDER BY updatedAt DESC, id DESC) AS rn
    FROM stacks WHERE trashedFolder IS NOT NULL
    WINDOW folder AS (PARTITION BY trashedFolder, trashedAt)
  ) WHERE rn = 1`

/** Trash entries, the most recently trashed first. */
export async function queryTrashEntries(
  db: DatabaseAdapter,
  limit: number,
  offset: number,
): Promise<TrashEntryRow[]> {
  return db.getAllAsync<TrashEntryRow>(
    `SELECT * FROM (${TRASH_ENTRIES}) ORDER BY trashedAt DESC, id DESC LIMIT ? OFFSET ?`,
    limit,
    offset,
  )
}

export async function queryTrashEntryCount(db: DatabaseAdapter): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM (${TRASH_ENTRIES})`)
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
     JOIN files e ON f.trashedAt = e.trashedAt AND (
       (e.trashedFolder IS NOT NULL AND f.trashedFolder = e.trashedFolder)
       OR (e.trashedFolder IS NULL AND f.trashedFolder IS NULL AND f.name = e.name
         AND coalesce(f.trashedFrom, '') = coalesce(e.trashedFrom, '')))
     WHERE e.id IN (${ph}) AND e.kind = 'file' AND e.trashedAt IS NOT NULL AND e.deletedAt IS NULL
       AND f.kind = 'file' AND f.deletedAt IS NULL`,
    ...entryIds,
  )
}

/**
 * Where a trashed file goes back to and the deleted folder it went with, as
 * its metadata publishes them. Null for a file that is not in the trash.
 */
export async function queryTrashLocation(
  db: DatabaseAdapter,
  fileId: string,
): Promise<{ directory: string; trashedFolder: string | null } | null> {
  return db.getFirstAsync<{ directory: string; trashedFolder: string | null }>(
    `SELECT ${TRASHED_FROM} AS directory, trashedFolder FROM files
     WHERE id = ? AND trashedAt IS NOT NULL`,
    fileId,
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
    // In batches, as tombstoneTrash does, since a deleted folder's entry can
    // hold more files than SQLite takes bound parameters in one statement.
    for (const batch of batches(files.map((f) => f.id))) {
      await tombstoneFilesAndThumbnails(tx, batch)
    }
    return files
  })
}

/** Deletes everything in the trash for good, as `tombstoneTrashEntries` does an entry. */
export async function tombstoneTrash(db: DatabaseAdapter): Promise<{ id: string; type: string }[]> {
  return transaction(db, async (tx) => {
    const files = await queryTrashedFiles(tx)
    // In batches, since each id is a bound parameter and a large trash holds
    // more versions than SQLite allows in one statement.
    for (const batch of batches(files.map((f) => f.id))) {
      await tombstoneFilesAndThumbnails(tx, batch)
    }
    return files
  })
}

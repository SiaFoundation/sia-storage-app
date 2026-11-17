import type { DatabaseAdapter, SQLParam } from '../../adapters/db'
import { OLDER_VERSION_TRASH_AGE, TRASH_AUTO_PURGE_AGE } from '../../config'
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
 *
 * `aboveOwn` stamps each row one above its own `updatedAt` instead of from
 * the time of the trash, for a trash no person asked for. Sync keeps the
 * row with the later `updatedAt`, so such a trash reaches the devices still
 * holding the row as it was, and loses to a restore or any other edit made
 * on another device since, which is stamped with the time it was made.
 */
export async function trashFilesAndThumbnails(
  db: DatabaseAdapter,
  fileIds: string[],
  opts: {
    trashedAt?: number
    folder?: string
    base?: number
    keepFolders?: boolean
    aboveOwn?: boolean
  } = {},
): Promise<void> {
  if (fileIds.length === 0) return
  const now = opts.trashedAt ?? Date.now()
  const ph = fileIds.map(() => '?').join(',')
  await db.withTransactionAsync(async (tx) => {
    const groups = await getGroupsForFileIds(tx, fileIds)
    const folders = await queryDirectoryIdsForFiles(tx, fileIds)
    // A row already in the trash keeps the location and entry it was trashed
    // with. SQLite reads every right-hand side from the row before the update.
    const set = {
      sql: `trashedAt = ?,
        trashedFrom = CASE WHEN trashedAt IS NULL THEN ${FOLDER_PATH} ELSE trashedFrom END,
        trashedFolder = CASE WHEN trashedAt IS NULL THEN ? ELSE trashedFolder END,
        directoryId = NULL`,
      values: [now, opts.folder ?? null],
    }
    if (opts.aboveOwn) {
      await tx.runAsync(
        `UPDATE files SET ${set.sql}, updatedAt = updatedAt + 1 WHERE id IN (${ph})`,
        ...set.values,
        ...fileIds,
      )
    } else {
      const rows = await newestFirst(tx, fileIds)
      // Above every row's own clock, not only the wall clock: a row can carry
      // another device's later clock, and a lower stamp would lose the sync race.
      const base = opts.base ?? Math.max(now, (rows[0]?.updatedAt ?? 0) + rows.length)
      await stampInOrder(tx, rows, base, set)
    }
    // Stamped with the time even for `aboveOwn`, since a thumbnail's trash
    // never leaves this device: its metadata carries no trashedAt and its
    // object is not flagged for sync-up.
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
  private newest = new Map<string, number>()

  constructor(private tx: DatabaseAdapter) {}

  async load(directoryId: string | null, names: string[]): Promise<void> {
    const known = this.folder(directoryId)
    const wanted = names.filter((n) => !known.has(n))
    if (wanted.length === 0) return
    for (const n of wanted) known.set(n, new Set())
    // CROSS JOIN reads the names first and finds each by the name index.
    // Left to choose, SQLite reads every file and checks it against the names.
    const rows = await this.tx.getAllAsync<{ name: string; stackId: string; updatedAt: number }>(
      `SELECT f.name, f.stackId, f.updatedAt FROM json_each(?) j CROSS JOIN files f
         ON f.name = j.value AND f.directoryId IS ?
       WHERE f.kind = 'file' AND f.trashedAt IS NULL AND f.deletedAt IS NULL`,
      JSON.stringify(wanted),
      directoryId,
    )
    for (const r of rows) {
      known.get(r.name)?.add(r.stackId)
      const key = `${directoryId}\0${r.name}`
      this.newest.set(key, Math.max(this.newest.get(key) ?? 0, r.updatedAt))
    }
  }

  /** The newest `updatedAt` among the live files holding `name` in the folder, 0 when none do. */
  async newestStamp(directoryId: string | null, name: string): Promise<number> {
    await this.load(directoryId, [name])
    return this.newest.get(`${directoryId}\0${name}`) ?? 0
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
 * The stack id of the live file holding `name` in a folder when the trash
 * entry `trashedAt` names there was trashed out of that file as older
 * versions, or null when it was trashed as a whole file.
 *
 * Restore compares stack ids first, but those are local: a device that first
 * saw the versions in the trash gave them stacks of their own. So this reads
 * the versions' history from synced fields. The older-version pass stamps a
 * version one above its own `updatedAt` and leaves a newer version live,
 * while trashing a file by hand stamps its newest version at or after the
 * time of the trash. An entry came out of the live file when a version
 * stamped at or above the entry's newest, and before the entry was trashed,
 * is still live or went to the trash later out of the live file in the same
 * way. At or above, rather than above, because a rename or move stamps a
 * file's versions one apart, so the pass's stamp can equal the newer
 * version's. No version is stamped both at or above a hand-trashed file's
 * newest and before its trash, so that file keeps its own stack. A folder
 * delete stamps its files in one count down that can end below its time,
 * and is left out, since it always trashes whole files.
 *
 * A live version also has to have reached this device by the time of the
 * trash or by the time the entry did, whichever is later. A photo-library
 * import stamps `updatedAt` with the capture time, so a different file
 * imported under the name after the trash can carry a stamp from before it.
 * Sync-down delivers objects in the order the indexer last saw them change,
 * and the pass trashes a version only once the newer one has an object, so
 * on a device that first saw the entry in the trash the newer version
 * arrived no later than the entry.
 *
 * An edit made after the pass, such as a tag change, stamps a version from
 * the time of the edit. A live version edited since reads as saved after
 * the trash, and an entry whose versions were edited in the trash reads as
 * trashed by hand, and either one comes back renamed. trashedAt does not
 * tell the two trashes apart, since both record the time of the trash.
 */
async function liveStackTrashedFrom(
  tx: DatabaseAdapter,
  name: string,
  directoryId: string | null,
  fromPath: string,
  trashedAt: number,
): Promise<string | null> {
  type Row = {
    id: string
    updatedAt: number
    addedAt: number
    trashedAt: number | null
    stackId: string
    current: number
  }
  const rows = await tx.getAllAsync<Row>(
    `SELECT id, updatedAt, addedAt, trashedAt, stackId, current FROM files
     WHERE name = ? AND kind = 'file' AND deletedAt IS NULL
       AND ((trashedAt IS NULL AND directoryId IS ?)
         OR (trashedAt >= ? AND trashedFolder IS NULL AND ${TRASHED_FROM} = ?))`,
    name,
    directoryId,
    trashedAt,
    fromPath,
  )
  const live = rows.filter((r) => r.trashedAt === null)
  const shown = live.find((r) => r.current === 1) ?? live[0]
  if (!shown) return null
  const entries = new Map<number, Row[]>()
  for (const r of rows) {
    if (r.trashedAt === null) continue
    const entry = entries.get(r.trashedAt)
    if (entry) entry.push(r)
    else entries.set(r.trashedAt, [r])
  }
  // Latest trash first, so every row that can show an entry came out of the
  // live file has been found by the time the entry is read.
  const fromLive: Row[] = []
  for (const at of [...entries.keys()].sort((a, b) => b - a)) {
    const entry = entries.get(at) as Row[]
    const top = Math.max(...entry.map((r) => r.updatedAt))
    const arrived = Math.max(at, ...entry.map((r) => r.addedAt))
    const joined = [...live.filter((r) => r.addedAt <= arrived), ...fromLive].some(
      (r) => r.updatedAt >= top && r.updatedAt < at,
    )
    if (at === trashedAt) return joined ? shown.stackId : null
    if (joined) fromLive.push(...entry)
  }
  return null
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
 * starts a stack of its own. Older versions trashed out of a file that a
 * device first saw in the trash rejoin that file's stack, as
 * `liveStackTrashedFrom` finds it.
 *
 * Restored versions are stamped from the time of the restore, or just above
 * their own `updatedAt` from the trash, or just above the newest live version
 * of the files they come back into, whichever is latest, as when a row
 * carries another device's later clock. A version comes back current over a
 * version of its file saved after it was trashed, which is what the user
 * restoring it asked for, and other devices take the change because the stamp
 * is above the one they hold.
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
      s: string | null
      u: number
    }[] = []
    const restored: RestoredFile[] = []
    for (const rows of ordered) {
      rows.sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    }
    const placed: {
      rows: TrashedRow[]
      directoryId: string | null
      name: string
      original: string
      joins: string | null
    }[] = []
    let liveTop = 0
    let count = 0
    for (const rows of ordered) {
      const { name: original, fromPath } = rows[0]
      const directoryId = folderIds.get(fromPath) ?? null
      const ownStacks = new Set(rows.map((r) => r.stackId))
      let joins: string | null = null
      if (await names.taken(directoryId, original, ownStacks)) {
        joins = await liveStackTrashedFrom(tx, original, directoryId, fromPath, rows[0].trashedAt)
        if (joins) ownStacks.add(joins)
      }
      let name = original
      for (let n = 1; await names.taken(directoryId, name, ownStacks); n++) {
        name = restoredName(original, n)
      }
      names.claim(directoryId, name, ownStacks)
      liveTop = Math.max(liveTop, await names.newestStamp(directoryId, name))
      count += rows.length
      placed.push({ rows, directoryId, name, original, joins })
    }
    // A stamp only above the trash's own would leave a version saved since
    // the trash current, and the next older-version pass would trash the
    // restored one again. The live versions a restore joins can carry a
    // stamp ahead of this device's clock from another device, so the count
    // starts high enough for every restored row to land above them. Counting
    // down from the latest trash keeps entries of one file restored together
    // in the order they were trashed.
    const bases = new Map<TrashedRow[], number>()
    let next = Math.max(Date.now(), liveTop + count)
    for (const { rows } of [...placed].reverse()) {
      const base = Math.max(next, rows[0].updatedAt + rows.length)
      bases.set(rows, base)
      next = base - rows.length
    }
    for (const { rows, directoryId, name, original, joins } of placed) {
      const renamed = name !== original
      const base = bases.get(rows) as number
      // Rows rejoining a file take its stack id. Left with their own, the
      // recount would give the stack the id of its newest row, the restored
      // one, and the live file would change identity in the Finder.
      rows.forEach((row, i) =>
        writes.push({
          id: row.id,
          d: directoryId,
          n: renamed ? name : null,
          k: renamed ? naturalSortKey(name) : null,
          s: renamed ? null : joins,
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
         stackId = coalesce(json_extract(j.value, '$.s'), files.stackId),
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
 * Moves older versions to the trash a day after a newer version replaced
 * them, so a file saved many times does not keep every version for good. The
 * trash deletes them for good after TRASH_AUTO_PURGE_AGE like any other file,
 * and until then a version can be restored, which makes it current again.
 *
 * Versions are ordered by (updatedAt, id), and a version qualifies once a
 * newer live version of its stack has been on this device, unchanged, for
 * OLDER_VERSION_TRASH_AGE: that version's `addedAt` and `updatedAt` are both
 * older than the age, and so is this version's own `addedAt`. `updatedAt`
 * alone is not enough, because a photo-library import sets it to the capture
 * time, so a photo taken months ago and imported today would make the version
 * it replaced qualify at once. `addedAt` is when the row reached this device,
 * by a save, an import or sync-down, and is not synced, so each device counts
 * the day from when it got the versions. A restore stamps `updatedAt` with
 * the time of the restore and leaves `addedAt`, so `updatedAt` is what keeps
 * the version a restore replaced for a day. Finding any one such newer
 * version is enough, since this version has not been current here since that
 * one arrived.
 *
 * The current version never qualifies. A version also needs an object on
 * `indexerURL`, because one that has not uploaded has its local copy as the
 * only copy, and the uploader still sends it. So does the newer version that
 * counts. The trash syncs to every device, and one that never received a
 * newer version still waiting to upload here, or one the uploader gave up on
 * (`lostReason`), would see the whole file go to its trash and, 30 days on,
 * deleted. A version on a share link stays, since trashing takes a file off
 * every link for good and a snapshot link shows that version.
 *
 * Every version trashed in one call shares one `trashedAt`, so the versions of
 * one file make one trash entry. Each batch is read in the transaction that
 * trashes it, so a version restored or made current since the last batch
 * stays. `onBatch` gets each batch's ids once its transaction commits, so a
 * caller can clean up after the batches that committed when a later one
 * fails. Returns the ids trashed.
 *
 * Each version trashed is stamped one above its own `updatedAt`, which keeps
 * the versions of a file in their order for restore, however the batches
 * split them. The trash then syncs to a device that still holds the version
 * as it was, while a restore or another edit made on a device that has not
 * seen the trash yet is stamped later and wins. A stamp from `now` would undo
 * a restore made on another device before this one synced it. Two devices
 * trashing a version at once give it the same stamp, and sync keeps one
 * device's `trashedAt`.
 */
export async function trashOlderVersions(
  db: DatabaseAdapter,
  indexerURL: string,
  now: number = Date.now(),
  onBatch?: (ids: string[]) => Promise<void>,
): Promise<string[]> {
  const cutoff = now - OLDER_VERSION_TRASH_AGE
  const trashed: string[] = []
  // Each batch reads idx_files_older_versions from just below the last row the
  // one before it took, so rows a batch leaves, such as versions not uploaded
  // yet, are not read again by every later batch. The first batch starts at
  // the cutoff, since a qualifying row's `updatedAt` is at most its newer
  // version's, which is at most the cutoff.
  let after = { updatedAt: cutoff + 1, id: '' }
  while (true) {
    const rows = await transaction(db, async (tx) => {
      const batch = await tx.getAllAsync<{ id: string; updatedAt: number }>(
        `SELECT f.id, f.updatedAt FROM files f
         WHERE f.kind = 'file' AND f.current = 0
           AND f.trashedAt IS NULL AND f.deletedAt IS NULL
           AND (f.updatedAt, f.id) < (?, ?)
           AND f.addedAt <= ?
           AND EXISTS (SELECT 1 FROM objects o WHERE o.fileId = f.id AND o.indexerURL = ?)
           AND EXISTS (
             SELECT 1 FROM files n
             WHERE n.stackId = f.stackId AND n.kind = 'file'
               AND n.trashedAt IS NULL AND n.deletedAt IS NULL
               AND (n.updatedAt, n.id) > (f.updatedAt, f.id)
               AND n.updatedAt <= ? AND n.addedAt <= ?
               AND n.lostReason IS NULL
               AND EXISTS (SELECT 1 FROM objects o2 WHERE o2.fileId = n.id AND o2.indexerURL = ?))
           AND NOT EXISTS (SELECT 1 FROM share_link_files s WHERE s.fileId = f.id)
         ORDER BY f.updatedAt DESC, f.id DESC
         LIMIT ?`,
        after.updatedAt,
        after.id,
        cutoff,
        indexerURL,
        cutoff,
        cutoff,
        indexerURL,
        TOMBSTONE_BATCH,
      )
      if (batch.length > 0) {
        await trashFilesAndThumbnails(
          tx,
          batch.map((r) => r.id),
          { trashedAt: now, aboveOwn: true },
        )
      }
      return batch
    })
    const ids = rows.map((r) => r.id)
    trashed.push(...ids)
    if (ids.length > 0) await onBatch?.(ids)
    if (rows.length < TOMBSTONE_BATCH) return trashed
    after = rows[rows.length - 1]
  }
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

import type { DatabaseAdapter } from '../../adapters/db'
import type { Migration } from '../types'

/*
 * A file in the trash remembers the folder it came from by path, in
 * files.trashedFrom ('' for the top of the library), and no longer sits in
 * that folder. Restoring it recreates the path. files.trashedFolder is the
 * path of the folder whose delete took the file into the trash, so the trash
 * lists that folder as one entry. It is NULL for a file trashed on its own.
 *
 * Rows currently in the trash hold their folder through directoryId, and a
 * folder with nothing in it but trashed files stays in the library. Other
 * devices learn about a deleted folder only from the files in it, so such a
 * folder stayed on every device that had trashed files in it, and came back
 * on a device signing in later. This moves each trashed row's folder into
 * trashedFrom, clears its directoryId, and deletes the folders that leaves
 * with no live file, no subfolder and no import in progress, walking up to
 * each parent the same way. An import is in progress while a file of it is
 * pending or active, or while it is unsealed, as a photo library scan is
 * between pages. Folders are checked 500 at a time, since each id is a bound
 * parameter and SQLite caps those per statement. A subfolder is found as a
 * path between `<path>/` and `<path>0`, '0' being the byte after '/', which
 * SQLite answers from the unique index on path. A LIKE prefix match reads
 * every folder for each one checked.
 *
 * A trashed row whose folder a delete already cleared gets '' and restores
 * to the top of the library. Tombstoned rows are left alone, since they are
 * never restored.
 *
 * No updatedAt moves and no object is flagged for sync-up. The metadata on
 * the indexer already names each trashed file's folder in `directory`, which
 * is what trashedFrom reads back as, and every device runs this on its own
 * rows.
 *
 * The SQL is inline rather than calling deleteEmptyDirectories, so a later
 * change to which files hold a folder cannot change what this did.
 */

const IN_TRASH = `kind = 'file' AND trashedAt IS NOT NULL AND deletedAt IS NULL`

const BATCH = 500

async function up(db: DatabaseAdapter): Promise<void> {
  await db.execAsync(`ALTER TABLE files ADD COLUMN trashedFrom TEXT;`)
  await db.execAsync(`ALTER TABLE files ADD COLUMN trashedFolder TEXT;`)

  const held = await db.getAllAsync<{ id: string }>(
    `SELECT DISTINCT directoryId AS id FROM files WHERE ${IN_TRASH} AND directoryId IS NOT NULL`,
  )
  await db.runAsync(
    `UPDATE files
       SET trashedFrom = coalesce((SELECT d.path FROM directories d WHERE d.id = files.directoryId), ''),
           directoryId = NULL
     WHERE ${IN_TRASH}`,
  )

  const queue = held.map((r) => r.id)
  while (queue.length > 0) {
    const batch = queue.splice(0, BATCH)
    const ph = batch.map(() => '?').join(',')
    const empties = await db.getAllAsync<{ id: string; path: string }>(
      `SELECT d.id, d.path FROM directories d
       WHERE d.id IN (${ph})
         AND NOT EXISTS (SELECT 1 FROM files f WHERE f.directoryId = d.id
           AND f.kind = 'file' AND f.trashedAt IS NULL AND f.deletedAt IS NULL)
         AND NOT EXISTS (SELECT 1 FROM directories c
           WHERE c.path > d.path || '/' AND c.path < d.path || '0')
         AND NOT EXISTS (SELECT 1 FROM import_files i WHERE i.directoryId = d.id
           AND i.state IN ('pending', 'active'))
         AND NOT EXISTS (SELECT 1 FROM imports im WHERE im.directoryId = d.id AND im.sealed = 0)`,
      ...batch,
    )
    if (empties.length === 0) continue
    const idPh = empties.map(() => '?').join(',')
    await db.runAsync(`DELETE FROM directories WHERE id IN (${idPh})`, ...empties.map((e) => e.id))
    const parents = [
      ...new Set(
        empties
          .filter((e) => e.path.includes('/'))
          .map((e) => e.path.slice(0, e.path.lastIndexOf('/'))),
      ),
    ]
    if (parents.length === 0) continue
    const parentPh = parents.map(() => '?').join(',')
    const rows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM directories WHERE path IN (${parentPh})`,
      ...parents,
    )
    queue.push(...rows.map((r) => r.id))
  }
}

export const migration_20261029_120000_trash_remembers_folder: Migration = {
  id: '20261029_120000_trash_remembers_folder',
  description: 'Trashed files remember their folder by path, and no longer keep it in the library.',
  up,
}

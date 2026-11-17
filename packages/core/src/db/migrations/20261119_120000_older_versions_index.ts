import type { DatabaseAdapter } from '../../adapters/db'
import type { Migration } from '../types'

/*
 * The hourly pass that trashes older versions (`trashOlderVersions`) looks
 * for live rows with `current = 0`. No index covered them, so every pass
 * scanned the whole files table inside a write transaction, holding up other
 * writes for the length of the scan.
 *
 * The index holds only older versions not yet in the trash. Once the pass
 * runs, those are versions replaced less than a day ago, versions still
 * waiting to upload, and versions a share link names, so it stays small next
 * to the table. It is ordered the way the pass reads, newest first.
 *
 * The pass also skips a version any share link names. share_link_files is
 * keyed by (publicKey, fileId), so finding the links for one file read the
 * whole table, once for every version the pass checked. The fileId index
 * serves that check and every other lookup of a file's links.
 */
async function up(db: DatabaseAdapter): Promise<void> {
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_files_older_versions ON files(updatedAt, id)
    WHERE kind = 'file' AND current = 0 AND trashedAt IS NULL AND deletedAt IS NULL;
    CREATE INDEX IF NOT EXISTS idx_share_link_files_fileId ON share_link_files(fileId);
  `)
}

export const migration_20261119_120000_older_versions_index: Migration = {
  id: '20261119_120000_older_versions_index',
  description: 'Index the older versions the trash pass looks for, and share link files by file.',
  up,
}

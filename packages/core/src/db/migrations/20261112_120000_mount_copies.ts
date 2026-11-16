import type { DatabaseAdapter } from '../../adapters/db'
import type { Migration } from '../types'

/*
 * A device has up to two places a file's bytes can be. The cache is this
 * app's own folder, recorded in `fs` with one row per version. The mount is
 * the folder a file manager shows, a File Provider domain on macOS or a Cloud
 * Files sync root on Windows, where the operating system writes and removes
 * the bytes itself and keeps one version of each file at most.
 *
 * mount_copies records what the mount holds, so those bytes can be counted
 * and a file can be reported as downloaded without a copy in the cache.
 *
 *   stackId  The id the system names the file by, one row per file.
 *   fileId   The version whose bytes the system holds: the one last handed to
 *            it whole, or last taken from it.
 *   bytes    Bytes on disk. The version's size, or for a file read by ranges
 *            the bytes served so far.
 *   whole    0 while the system holds only ranges of the file, or was handed
 *            the whole file and has not listed it yet.
 *   usedAt   When the system last read the file through this device or
 *            reported it opened.
 *
 * The table is empty on a device with no mount, such as a phone.
 */
async function up(db: DatabaseAdapter): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS mount_copies (
      stackId TEXT PRIMARY KEY NOT NULL,
      fileId TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      whole INTEGER NOT NULL,
      usedAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mount_copies_fileId ON mount_copies(fileId);
    CREATE INDEX IF NOT EXISTS idx_mount_copies_usedAt ON mount_copies(usedAt, stackId);
  `)
}

export const migration_20261112_120000_mount_copies: Migration = {
  id: '20261112_120000_mount_copies',
  description: 'Record the files the file manager folder holds copies of.',
  up,
}

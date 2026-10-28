import type { DatabaseAdapter } from '../../adapters/db'
import type { Migration } from '../types'

/*
 * The provider feed re-reports a file when its upload state changes, and
 * upload state is relative to the current indexer: an item reports uploaded
 * only with an object on it. The two object triggers currently fire on a
 * file's first object and its last one across every indexer, so a file that
 * already has an object on a previous indexer and gains its first on the
 * current one is never re-reported, and Finder keeps it marked as not
 * uploaded.
 *
 * Each trigger is recreated to fire on the first and last object per
 * (fileId, indexerURL). A trigger cannot read the current indexer, which is
 * in key-value settings rather than the database, so an object arriving on an
 * indexer that is not current re-stamps the row too. That costs one extra
 * re-read of the item by the OS.
 *
 * Every file row is also re-stamped once. Upload state reported before this
 * migration counted an object on any indexer, so a library that switched
 * indexers earlier holds items Finder has as uploaded that have no object on
 * the current one, and nothing else in the feed would report them again.
 */

const TRIGGERS: Array<{ name: string; sql: string }> = [
  {
    name: 'trg_objects_feed_first',
    sql: `CREATE TRIGGER trg_objects_feed_first
   AFTER INSERT ON objects
   WHEN (SELECT kind FROM files WHERE id = NEW.fileId) = 'file'
     AND NOT EXISTS (
       SELECT 1 FROM objects
       WHERE fileId = NEW.fileId AND indexerURL = NEW.indexerURL AND rowid <> NEW.rowid
     )
   BEGIN
     UPDATE feed_meta SET seq = seq + 1 WHERE id = 1;
     UPDATE files SET feedSeq = (SELECT seq FROM feed_meta WHERE id = 1) WHERE id = NEW.fileId;
   END;`,
  },
  {
    name: 'trg_objects_feed_last',
    sql: `CREATE TRIGGER trg_objects_feed_last
   AFTER DELETE ON objects
   WHEN (SELECT kind FROM files WHERE id = OLD.fileId) = 'file'
     AND NOT EXISTS (
       SELECT 1 FROM objects WHERE fileId = OLD.fileId AND indexerURL = OLD.indexerURL
     )
   BEGIN
     UPDATE feed_meta SET seq = seq + 1 WHERE id = 1;
     UPDATE files SET feedSeq = (SELECT seq FROM feed_meta WHERE id = 1) WHERE id = OLD.fileId;
   END;`,
  },
]

async function up(db: DatabaseAdapter): Promise<void> {
  for (const { name, sql } of TRIGGERS) {
    await db.execAsync(`DROP TRIGGER IF EXISTS ${name};`)
    await db.execAsync(sql)
  }
  await db.execAsync(`UPDATE feed_meta SET seq = seq + 1 WHERE id = 1;`)
  await db.execAsync(
    `UPDATE files SET feedSeq = (SELECT seq FROM feed_meta WHERE id = 1) WHERE kind = 'file';`,
  )
}

export const migration_20261028_120000_objects_feed_per_indexer: Migration = {
  id: '20261028_120000_objects_feed_per_indexer',
  description: 'Re-report a file on its first and last object per indexer.',
  up,
}

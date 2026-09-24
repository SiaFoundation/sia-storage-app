import type { DatabaseAdapter } from '../../adapters/db'
import type { Migration } from '../types'

/*
 * files.stackId is the id of a file as a whole, where a row id names one
 * version of it. Every live row of a version stack (same name and
 * directoryId, kind 'file', neither trashed nor tombstoned) carries the same
 * value, and the OS shell names files by it, so a saved edit or another
 * device's version arrives as an update to the item it already holds. It is
 * local to this database and never synced, so two devices can disagree on
 * it. The backfill gives each stack its current row's id, and the currency
 * recalculation in operations/files.ts keeps stacks in agreement afterwards.
 *
 * Its own migration rather than part of the provider feed migration, because
 * builds have shipped with that one applied and a change to it would never
 * run there. The feed's two departure triggers ledger a row's own id, which
 * the shell no longer names files by, so they are dropped and recreated to
 * ledger the stack id.
 */

const DEPARTURE_TRIGGERS = ['trg_files_feed_delete', 'trg_files_feed_depart'] as const

const TRIGGER_STATEMENTS: readonly string[] = [
  `CREATE TRIGGER trg_files_feed_delete
   AFTER DELETE ON files WHEN OLD.kind = 'file'
   BEGIN
     UPDATE feed_meta SET seq = seq + 1 WHERE id = 1;
     INSERT OR REPLACE INTO feed_departures (id, kind, parentId, reason, feedSeq)
       VALUES (OLD.stackId, 'file', coalesce(OLD.directoryId, ''), 'deleted',
               (SELECT seq FROM feed_meta WHERE id = 1));
   END;`,
  `CREATE TRIGGER trg_files_feed_depart
   AFTER UPDATE OF directoryId ON files
   WHEN NEW.kind = 'file' AND OLD.directoryId IS NOT NEW.directoryId
   BEGIN
     UPDATE feed_meta SET seq = seq + 1 WHERE id = 1;
     INSERT OR REPLACE INTO feed_departures (id, kind, parentId, reason, feedSeq)
       VALUES (OLD.stackId, 'file', coalesce(OLD.directoryId, ''), 'moved',
               (SELECT seq FROM feed_meta WHERE id = 1));
   END;`,
  // A new live row joins the stack already at its name within the insert
  // statement, so no reader sees a live file without an identity.
  `CREATE TRIGGER trg_files_stack_id_insert
   AFTER INSERT ON files WHEN NEW.kind = 'file' AND NEW.stackId IS NULL
   BEGIN
     UPDATE files SET stackId = coalesce(
       (SELECT c.stackId FROM files c
        WHERE c.kind = 'file' AND c.current = 1 AND c.trashedAt IS NULL AND c.deletedAt IS NULL
          AND c.name = NEW.name AND c.directoryId IS NEW.directoryId AND c.id <> NEW.id
          AND NEW.trashedAt IS NULL AND NEW.deletedAt IS NULL
        ORDER BY c.updatedAt DESC, c.id DESC LIMIT 1),
       NEW.id)
     WHERE id = NEW.id;
   END;`,
  // A row changing identity re-announces itself under the new id. An old id
  // left on no live row is ledgered as deleted, since its rows still exist
  // under another id and nothing else in the feed would report it. The ledger
  // row takes its own sequence so it never shares a (feedSeq, id) position.
  `CREATE TRIGGER trg_files_stack_id_change
   AFTER UPDATE OF stackId ON files
   WHEN NEW.kind = 'file' AND OLD.stackId IS NOT NULL AND OLD.stackId IS NOT NEW.stackId
   BEGIN
     UPDATE feed_meta SET seq = seq + 1 WHERE id = 1;
     UPDATE files SET feedSeq = (SELECT seq FROM feed_meta WHERE id = 1) WHERE id = NEW.id;
     UPDATE feed_meta SET seq = seq + 1 WHERE id = 1
       AND OLD.trashedAt IS NULL AND OLD.deletedAt IS NULL
       AND NOT EXISTS (SELECT 1 FROM files c WHERE c.stackId = OLD.stackId
         AND c.kind = 'file' AND c.trashedAt IS NULL AND c.deletedAt IS NULL);
     INSERT OR REPLACE INTO feed_departures (id, kind, parentId, reason, feedSeq)
       SELECT OLD.stackId, 'file', coalesce(OLD.directoryId, ''), 'deleted',
              (SELECT seq FROM feed_meta WHERE id = 1)
       WHERE OLD.trashedAt IS NULL AND OLD.deletedAt IS NULL
         AND NOT EXISTS (SELECT 1 FROM files c WHERE c.stackId = OLD.stackId
           AND c.kind = 'file' AND c.trashedAt IS NULL AND c.deletedAt IS NULL);
   END;`,
  // The uploaded badge reads whether a file has any object, so the file
  // re-stamps when its first object arrives and when its last one goes. A
  // cascade from a deleted file row finds no file row and does nothing.
  `CREATE TRIGGER trg_objects_feed_first
   AFTER INSERT ON objects
   WHEN (SELECT kind FROM files WHERE id = NEW.fileId) = 'file'
     AND NOT EXISTS (SELECT 1 FROM objects WHERE fileId = NEW.fileId AND rowid <> NEW.rowid)
   BEGIN
     UPDATE feed_meta SET seq = seq + 1 WHERE id = 1;
     UPDATE files SET feedSeq = (SELECT seq FROM feed_meta WHERE id = 1) WHERE id = NEW.fileId;
   END;`,
  `CREATE TRIGGER trg_objects_feed_last
   AFTER DELETE ON objects
   WHEN (SELECT kind FROM files WHERE id = OLD.fileId) = 'file'
     AND NOT EXISTS (SELECT 1 FROM objects WHERE fileId = OLD.fileId)
   BEGIN
     UPDATE feed_meta SET seq = seq + 1 WHERE id = 1;
     UPDATE files SET feedSeq = (SELECT seq FROM feed_meta WHERE id = 1) WHERE id = OLD.fileId;
   END;`,
]

async function up(db: DatabaseAdapter): Promise<void> {
  await db.execAsync(`ALTER TABLE files ADD COLUMN stackId TEXT;`)
  await db.execAsync(`UPDATE files SET stackId = id WHERE kind = 'file';`)
  // Superseded live versions take their stack's current row id.
  await db.execAsync(
    `UPDATE files SET stackId = (
       SELECT c.id FROM files c
       WHERE c.kind = 'file' AND c.current = 1 AND c.trashedAt IS NULL AND c.deletedAt IS NULL
         AND c.name = files.name AND c.directoryId IS files.directoryId
       ORDER BY c.updatedAt DESC, c.id DESC LIMIT 1
     )
     WHERE kind = 'file' AND current = 0 AND trashedAt IS NULL AND deletedAt IS NULL
       AND EXISTS (
         SELECT 1 FROM files c
         WHERE c.kind = 'file' AND c.current = 1 AND c.trashedAt IS NULL AND c.deletedAt IS NULL
           AND c.name = files.name AND c.directoryId IS files.directoryId
       );`,
  )
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_stackId
     ON files(stackId) WHERE kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL;`,
  )
  // Created after the backfill, so assigning the ids announces nothing.
  for (const name of DEPARTURE_TRIGGERS) {
    await db.execAsync(`DROP TRIGGER IF EXISTS ${name};`)
  }
  for (const statement of TRIGGER_STATEMENTS) {
    await db.execAsync(statement)
  }
}

export const migration_20260925_120000_file_stack_id: Migration = {
  id: '20260925_120000_file_stack_id',
  description: 'files.stackId, its triggers, and file departures ledgered by stack id.',
  up,
}

import type { DatabaseAdapter } from '../../adapters/db'
import type { Migration } from '../types'

/*
 * The five triggers that write feed_departures do it with INSERT OR REPLACE
 * on its (id, parentId) key, and SQLite does not always honour a conflict
 * clause inside a trigger. When the statement that fires the trigger carries
 * a conflict policy of its own, that policy replaces the trigger's.
 *
 * - A foreign key action runs under ABORT. Deleting a folder clears
 *   files.directoryId on every row inside it (ON DELETE SET NULL), each row
 *   fires trg_files_feed_depart, and two versions of one file in the folder
 *   write the same (stackId, parentId) key. The second write fails, and the
 *   folder delete with everything in its transaction rolls back. A library
 *   in that state fails every sync-down pass that deletes the folder, and
 *   Finder cannot trash it.
 * - An upsert runs its update under ABORT, with the same result for a
 *   departure key that already has a row.
 * - An OR IGNORE statement turns the REPLACE into IGNORE, so an existing
 *   departure keeps its old sequence and a feed reader past that sequence
 *   never sees the newer move.
 *
 * An upsert inside the trigger is not overridden by any of these, so each
 * trigger is recreated as it was with only its departure write changed to
 * ON CONFLICT (id, parentId) DO UPDATE. A library a failed folder delete has
 * stuck recovers on the next pass after this runs, because the delete then
 * succeeds.
 */

const DEPARTURE_UPSERT = `ON CONFLICT (id, parentId) DO UPDATE SET
         kind = excluded.kind, reason = excluded.reason, feedSeq = excluded.feedSeq`

const TRIGGERS: Array<{ name: string; sql: string }> = [
  {
    name: 'trg_files_feed_delete',
    sql: `CREATE TRIGGER trg_files_feed_delete
   AFTER DELETE ON files WHEN OLD.kind = 'file'
   BEGIN
     UPDATE feed_meta SET seq = seq + 1 WHERE id = 1;
     INSERT INTO feed_departures (id, kind, parentId, reason, feedSeq)
       VALUES (OLD.stackId, 'file', coalesce(OLD.directoryId, ''), 'deleted',
               (SELECT seq FROM feed_meta WHERE id = 1))
       ${DEPARTURE_UPSERT};
   END;`,
  },
  {
    name: 'trg_files_feed_depart',
    sql: `CREATE TRIGGER trg_files_feed_depart
   AFTER UPDATE OF directoryId ON files
   WHEN NEW.kind = 'file' AND OLD.directoryId IS NOT NEW.directoryId
   BEGIN
     UPDATE feed_meta SET seq = seq + 1 WHERE id = 1;
     INSERT INTO feed_departures (id, kind, parentId, reason, feedSeq)
       VALUES (OLD.stackId, 'file', coalesce(OLD.directoryId, ''), 'moved',
               (SELECT seq FROM feed_meta WHERE id = 1))
       ${DEPARTURE_UPSERT};
   END;`,
  },
  {
    name: 'trg_files_stack_id_change',
    sql: `CREATE TRIGGER trg_files_stack_id_change
   AFTER UPDATE OF stackId ON files
   WHEN NEW.kind = 'file' AND OLD.stackId IS NOT NULL AND OLD.stackId IS NOT NEW.stackId
   BEGIN
     UPDATE feed_meta SET seq = seq + 1 WHERE id = 1;
     UPDATE files SET feedSeq = (SELECT seq FROM feed_meta WHERE id = 1) WHERE id = NEW.id;
     UPDATE feed_meta SET seq = seq + 1 WHERE id = 1
       AND OLD.trashedAt IS NULL AND OLD.deletedAt IS NULL
       AND NOT EXISTS (SELECT 1 FROM files c WHERE c.stackId = OLD.stackId
         AND c.kind = 'file' AND c.trashedAt IS NULL AND c.deletedAt IS NULL);
     INSERT INTO feed_departures (id, kind, parentId, reason, feedSeq)
       SELECT OLD.stackId, 'file', coalesce(OLD.directoryId, ''), 'deleted',
              (SELECT seq FROM feed_meta WHERE id = 1)
       WHERE OLD.trashedAt IS NULL AND OLD.deletedAt IS NULL
         AND NOT EXISTS (SELECT 1 FROM files c WHERE c.stackId = OLD.stackId
           AND c.kind = 'file' AND c.trashedAt IS NULL AND c.deletedAt IS NULL)
       ${DEPARTURE_UPSERT};
   END;`,
  },
  {
    name: 'trg_directories_feed_delete',
    sql: `CREATE TRIGGER trg_directories_feed_delete
   AFTER DELETE ON directories
   BEGIN
     UPDATE feed_meta SET seq = seq + 1 WHERE id = 1;
     INSERT INTO feed_departures (id, kind, parentId, reason, feedSeq)
       VALUES (OLD.id, 'dir', coalesce(OLD.parentId, ''), 'deleted',
               (SELECT seq FROM feed_meta WHERE id = 1))
       ${DEPARTURE_UPSERT};
   END;`,
  },
  {
    name: 'trg_directories_feed_depart',
    sql: `CREATE TRIGGER trg_directories_feed_depart
   AFTER UPDATE OF parentId ON directories
   WHEN OLD.parentId IS NOT NEW.parentId
   BEGIN
     UPDATE feed_meta SET seq = seq + 1 WHERE id = 1;
     INSERT INTO feed_departures (id, kind, parentId, reason, feedSeq)
       VALUES (OLD.id, 'dir', coalesce(OLD.parentId, ''), 'moved',
               (SELECT seq FROM feed_meta WHERE id = 1))
       ${DEPARTURE_UPSERT};
   END;`,
  },
]

async function up(db: DatabaseAdapter): Promise<void> {
  for (const { name, sql } of TRIGGERS) {
    await db.execAsync(`DROP TRIGGER IF EXISTS ${name};`)
    await db.execAsync(sql)
  }
}

export const migration_20261004_120000_feed_departure_upserts: Migration = {
  id: '20261004_120000_feed_departure_upserts',
  description: 'Write feed departures with an upsert, which a firing statement cannot override.',
  up,
}

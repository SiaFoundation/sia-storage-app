import type { DatabaseAdapter } from '../../adapters/db'
import type { Migration } from '../types'
import { uniqueId } from '../../lib/uniqueId'
import { naturalSortKey } from '../../lib/naturalSortKey'

/*
 * The provider feed's clock and ledger. A cursor over files.updatedAt
 * cannot order this feed: that is domain time, where sync-down writes the
 * other device's wall clock, version promotion moves no clock at all, and
 * bulk moves stamp decreasing values, so rows could commit behind a cursor
 * the OS shell had already read and never be delivered. feedSeq is the order
 * changes land in THIS database: a monotone counter in feed_meta, stamped
 * onto every provider-visible row change by the triggers below, never taken
 * from the wire.
 *
 * Live rows carry the present, so a folder-scoped delta can read arrivals
 * and edits straight from them, but a row that moved away states its new
 * parent and a destroyed row states nothing. feed_departures records the one
 * fact the present cannot encode, "id left parent P at sequence S"; a
 * deletion is a departure whose reason is 'deleted'. "Tombstone" is
 * deliberately avoided, since in this codebase it names the deletedAt
 * soft-delete invariant, and rows in that state keep existing and stamp like
 * any other change. The (id, parentId) REPLACE key self-compacts:
 * oscillation between two folders holds two rows restamped in place, and a
 * delete supersedes a stale same-parent 'moved' row with the strictly newer
 * fact. Move rows for other parents survive a delete on purpose: a scope
 * whose anchor predates the move still needs them. parentId is the parent's
 * id, never its path, because scopes query by folder id and ids survive
 * renames; '' encodes root, because NULL never equals NULL, so a NULL key
 * would never REPLACE and root departures would pile up one row per write.
 * Ledger sequences are unique (each write takes its own bump), but the
 * readers keyset on (feedSeq, id) like the rest of the feed rather than
 * relying on that.
 *
 * Why the departing row must carry its parent id instead of the trigger
 * deriving it from the path: measured, not assumed. In a single-statement
 * subtree DELETE, AFTER DELETE triggers see the partially deleted table and
 * a dirname lookup returns NULL for every row; in a move,
 * rebaseDirectoryTree rewrites the root's path before its descendants, so a
 * descendant's trigger looks up a parent path that no longer exists.
 * OLD.parentId (and files' OLD.directoryId) is in the dying or departing row
 * itself, immune to statement order. directories.parentId is therefore a
 * second representation of the hierarchy the path already encodes; its
 * writers are the directory insert paths and the moved root of a rebase, and
 * rename cascades never touch it. The backfill below repairs orphan paths (a
 * move to a parent that was never created) by creating the missing ancestors
 * rather than silently promoting the orphan to root.
 *
 * Rows from before this migration keep feedSeq 0 and page by id inside that
 * band; sequences are monotone, not unique, and the feed breaks ties on
 * (feedSeq, id). The epoch names this database's feed: anchors embed it, and
 * a wiped and recreated library (fresh counter near 0) expires a stale
 * anchor holding a large old seq instead of silently returning nothing
 * forever.
 */

/*
 * Trigger ground rules the schema now relies on. Both were measured against
 * the engines this runs on, not assumed:
 * - INSERT OR REPLACE stays forbidden on files and directories, because the
 *   delete its conflict resolution performs does NOT fire the delete
 *   trigger. An OR REPLACE that displaces a different row through a UNIQUE
 *   constraint (directories.path, files.localId) would destroy that row
 *   with no ledger entry, and the shell keeps the dead item forever. Files
 *   upsert via ON CONFLICT DO UPDATE, directories via OR IGNORE; both fire
 *   correctly.
 * - Foreign-key ON DELETE SET NULL writes DO fire the update trigger even
 *   with recursive_triggers off, so the feed sees FK-driven reparenting on
 *   its own. That pragma is also what the OR REPLACE rule above depends
 *   on: turning it on makes replace-deletes fire delete triggers, so it
 *   must stay off. deleteDirectory's explicit null-and-stamp of children
 *   stays for the updatedAt bump that sync-up needs, not for feed coverage.
 * - The UPDATE OF column list is the provider-visible set. updatedAt is in
 *   it because file metadataVersion embeds updatedAt, so tag edits and
 *   rename cascades must re-announce. kind guards keep thumbnail rows out.
 */
const TRIGGER_STATEMENTS: readonly string[] = [
  `CREATE TRIGGER IF NOT EXISTS trg_files_feed_insert
   AFTER INSERT ON files WHEN NEW.kind = 'file'
   BEGIN
     UPDATE feed_meta SET seq = seq + 1 WHERE id = 1;
     UPDATE files SET feedSeq = (SELECT seq FROM feed_meta WHERE id = 1)
       WHERE id = NEW.id;
   END;`,
  `CREATE TRIGGER IF NOT EXISTS trg_files_feed_update
   AFTER UPDATE OF name, size, hash, type, directoryId, trashedAt, deletedAt, current, updatedAt
   ON files WHEN NEW.kind = 'file' AND (
     OLD.name IS NOT NEW.name OR OLD.size IS NOT NEW.size
     OR OLD.hash IS NOT NEW.hash OR OLD.type IS NOT NEW.type
     OR OLD.directoryId IS NOT NEW.directoryId
     OR OLD.trashedAt IS NOT NEW.trashedAt OR OLD.deletedAt IS NOT NEW.deletedAt
     OR OLD.current IS NOT NEW.current OR OLD.updatedAt IS NOT NEW.updatedAt
   )
   BEGIN
     UPDATE feed_meta SET seq = seq + 1 WHERE id = 1;
     UPDATE files SET feedSeq = (SELECT seq FROM feed_meta WHERE id = 1)
       WHERE id = NEW.id;
   END;`,
  `CREATE TRIGGER IF NOT EXISTS trg_files_feed_delete
   AFTER DELETE ON files WHEN OLD.kind = 'file'
   BEGIN
     UPDATE feed_meta SET seq = seq + 1 WHERE id = 1;
     INSERT OR REPLACE INTO feed_departures (id, kind, parentId, reason, feedSeq)
       VALUES (OLD.id, 'file', coalesce(OLD.directoryId, ''), 'deleted',
               (SELECT seq FROM feed_meta WHERE id = 1));
   END;`,
  `CREATE TRIGGER IF NOT EXISTS trg_files_feed_depart
   AFTER UPDATE OF directoryId ON files
   WHEN NEW.kind = 'file' AND OLD.directoryId IS NOT NEW.directoryId
   BEGIN
     UPDATE feed_meta SET seq = seq + 1 WHERE id = 1;
     INSERT OR REPLACE INTO feed_departures (id, kind, parentId, reason, feedSeq)
       VALUES (OLD.id, 'file', coalesce(OLD.directoryId, ''), 'moved',
               (SELECT seq FROM feed_meta WHERE id = 1));
   END;`,
  `CREATE TRIGGER IF NOT EXISTS trg_directories_feed_insert
   AFTER INSERT ON directories
   BEGIN
     UPDATE feed_meta SET seq = seq + 1 WHERE id = 1;
     UPDATE directories SET feedSeq = (SELECT seq FROM feed_meta WHERE id = 1)
       WHERE id = NEW.id;
   END;`,
  `CREATE TRIGGER IF NOT EXISTS trg_directories_feed_update
   AFTER UPDATE OF path ON directories WHEN OLD.path IS NOT NEW.path
   BEGIN
     UPDATE feed_meta SET seq = seq + 1 WHERE id = 1;
     UPDATE directories SET feedSeq = (SELECT seq FROM feed_meta WHERE id = 1)
       WHERE id = NEW.id;
   END;`,
  `CREATE TRIGGER IF NOT EXISTS trg_directories_feed_delete
   AFTER DELETE ON directories
   BEGIN
     UPDATE feed_meta SET seq = seq + 1 WHERE id = 1;
     INSERT OR REPLACE INTO feed_departures (id, kind, parentId, reason, feedSeq)
       VALUES (OLD.id, 'dir', coalesce(OLD.parentId, ''), 'deleted',
               (SELECT seq FROM feed_meta WHERE id = 1));
   END;`,
  `CREATE TRIGGER IF NOT EXISTS trg_directories_feed_depart
   AFTER UPDATE OF parentId ON directories
   WHEN OLD.parentId IS NOT NEW.parentId
   BEGIN
     UPDATE feed_meta SET seq = seq + 1 WHERE id = 1;
     INSERT OR REPLACE INTO feed_departures (id, kind, parentId, reason, feedSeq)
       VALUES (OLD.id, 'dir', coalesce(OLD.parentId, ''), 'moved',
               (SELECT seq FROM feed_meta WHERE id = 1));
   END;`,
]

/** Every strict ancestor path of `path`, shallowest first. */
function ancestorPaths(path: string): string[] {
  const out: string[] = []
  let idx = path.indexOf('/')
  while (idx !== -1) {
    out.push(path.slice(0, idx))
    idx = path.indexOf('/', idx + 1)
  }
  return out
}

async function up(db: DatabaseAdapter): Promise<void> {
  await db.execAsync(`CREATE TABLE IF NOT EXISTS feed_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    seq INTEGER NOT NULL,
    epoch TEXT NOT NULL,
    horizon INTEGER NOT NULL DEFAULT 0
  );`)
  await db.runAsync(`INSERT OR IGNORE INTO feed_meta (id, seq, epoch) VALUES (1, 0, ?)`, uniqueId())
  await db.execAsync(`ALTER TABLE files ADD COLUMN feedSeq INTEGER NOT NULL DEFAULT 0;`)
  await db.execAsync(`ALTER TABLE directories ADD COLUMN feedSeq INTEGER NOT NULL DEFAULT 0;`)
  await db.execAsync(`ALTER TABLE directories ADD COLUMN parentId TEXT;`)

  // Orphan repair before backfill: create any ancestor a path names but the
  // table lacks, shallowest first. The triggers are not installed yet, so
  // these rows join the feedSeq-0 band like every other pre-existing row.
  const rows = await db.getAllAsync<{ path: string }>(`SELECT path FROM directories`)
  const have = new Set(rows.map((r) => r.path))
  const missing = new Set<string>()
  for (const row of rows) {
    for (const ancestor of ancestorPaths(row.path)) {
      if (!have.has(ancestor)) missing.add(ancestor)
    }
  }
  const now = Date.now()
  for (const path of [...missing].sort()) {
    await db.runAsync(
      `INSERT INTO directories (id, path, createdAt, nameSortKey) VALUES (?, ?, ?, ?)`,
      uniqueId(),
      path,
      now,
      naturalSortKey(path),
    )
  }

  // Backfill parentId from each path's dirname; roots (no '/') stay NULL.
  // rtrim(path, replace(path, '/', '')) strips the last segment: the second
  // argument is the path's non-slash characters, so trimming stops at the
  // final slash.
  await db.execAsync(
    `UPDATE directories SET parentId = (
       SELECT p.id FROM directories p
       WHERE p.path = rtrim(rtrim(directories.path, replace(directories.path, '/', '')), '/')
     ) WHERE path LIKE '%/%';`,
  )

  await db.execAsync(`CREATE TABLE IF NOT EXISTS feed_departures (
    id TEXT NOT NULL,
    kind TEXT NOT NULL,
    parentId TEXT NOT NULL,
    reason TEXT NOT NULL,
    feedSeq INTEGER NOT NULL,
    PRIMARY KEY (id, parentId)
  );`)

  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_files_feedSeq_id ON files(feedSeq, id);`)
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_directories_feedSeq_id ON directories(feedSeq, id);`,
  )
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_directoryId_feedSeq_id
     ON files(directoryId, feedSeq, id);`,
  )
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_directories_parentId_feedSeq_id
     ON directories(parentId, feedSeq, id);`,
  )
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_feed_departures_parentId_feedSeq_id
     ON feed_departures(parentId, feedSeq, id);`,
  )
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_feed_departures_reason_feedSeq_id
     ON feed_departures(reason, feedSeq, id);`,
  )

  for (const stmt of TRIGGER_STATEMENTS) await db.execAsync(stmt)
}

export const migration_20260916_124516_provider_feed_seq: Migration = {
  id: '20260916_124516_provider_feed_seq',
  description:
    'Provider feed: feed_meta, feedSeq stamps, directories.parentId, departure ledger, triggers.',
  up,
}

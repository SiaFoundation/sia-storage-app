import type { DatabaseAdapter } from '../../adapters/db'
import type { Migration } from '../types'

/*
 * The imports and import_files tables.
 *
 * This migration moves in-flight imports into their own tables. They currently
 * sit in `files` as placeholder rows with `hash=''`, which overloads the files
 * table and lets a half-finished import shadow a real file. Each becomes an
 * `imports` row (one per user action) owning many `import_files` rows (one per
 * asset being copied).
 * After it runs, `files` holds only finalized rows; the only `hash=''` rows left
 * are trashed/deleted tombstones, which we leave in place.
 *
 * It also retires `files.localId`. That column carries a UNIQUE constraint, and
 * a duplicate insert into it was the "stuck re-import" bug. We add a non-unique
 * `mediaAssetId` and copy localId's values into it; once nothing writes localId,
 * its UNIQUE can never fire again. We do not drop the localId column: SQLite can
 * only remove a column-level UNIQUE by rebuilding the whole table (recreating
 * every index and foreign key on it), so a dead-but-present column is the
 * cheaper, safer choice.
 *
 * The migration runner wraps this in a transaction, so it issues no BEGIN/COMMIT.
 */
async function up(db: DatabaseAdapter): Promise<void> {
  // One row per user action that starts an import.
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS imports (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,                                   -- picker | camera | share | new-photos | library-scan | legacy
      directoryId TEXT REFERENCES directories(id) ON DELETE SET NULL,  -- destination folder; NULL = unfiled
      pendingTags TEXT,                                       -- JSON tag names applied to each file on finalize
      expectedCount INTEGER NOT NULL DEFAULT 0,               -- files the import source expects, for progress; 0 until known
      dedupByHash INTEGER NOT NULL DEFAULT 1,                 -- 1 = skip a file whose content hash already exists in the dir
      dirSourceRef TEXT,                                      -- OS permission handle for a picked directory (Android SAF / iOS bookmark)
      sealed INTEGER NOT NULL DEFAULT 1,                      -- 1 = import source done adding; may finalize once all rows are terminal
      startedAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );`,
  )

  // One row per asset being imported. state IS the outcome, so there is no separate result column.
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS import_files (
      id TEXT PRIMARY KEY,                                    -- reused verbatim as files.id on finalize, so ids stay stable
      importId TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,  -- deleting the import drops its rows
      state TEXT NOT NULL DEFAULT 'pending',                  -- pending, then active, then added | duplicate | unavailable | failed | cancelled
      reason TEXT,                                            -- failure-reason code on a terminal non-added row
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      hash TEXT,                                              -- content hash, set once the copy is read; NULL until then
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      addedAt INTEGER NOT NULL,                               -- when the import source staged the row; orders the pending queue
      directoryId TEXT,                                       -- destination folder (rows in one import may differ)
      mediaAssetId TEXT,                                      -- photo-library asset id for identity dedup; NULL for camera/share
      sourceKind TEXT NOT NULL,                               -- how to read the bytes: media | ephemeral | staged | path | bookmark | dir-child
      sourceUri TEXT,                                         -- readable location for this source kind
      sourceRef TEXT,                                         -- durable OS permission handle; kept for retry, released on delete
      copyBytes INTEGER NOT NULL DEFAULT 0,                   -- bytes copied so far, for the live progress bar
      attempts INTEGER NOT NULL DEFAULT 0,                    -- failed tries so far, for backoff and per-reason caps
      nextAttemptAt INTEGER NOT NULL DEFAULT 0,               -- earliest retry time; a backed-off row is skipped until now passes it
      claimedAt INTEGER,                                      -- when a scanner tick claimed the row; heartbeat for the stale-claim sweep
      claimToken TEXT                                         -- owner token; a claimed write only lands if it still matches (one writer per row)
    );`,
  )
  // Scanner reads an import's rows filtered by state (drain, count terminals, decide finalize).
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_import_files_import ON import_files(importId, state);`,
  )
  // Pending rows, newest staged first.
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_import_files_pending ON import_files(addedAt DESC) WHERE state = 'pending';`,
  )
  // Identity dedup: find in-flight rows for a given photo-library asset.
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_import_files_mediaAsset ON import_files(mediaAssetId) WHERE mediaAssetId IS NOT NULL;`,
  )
  // The imports history list, newest first.
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_imports_started ON imports(startedAt DESC);`)

  // Retire localId: add the non-unique replacement and carry the existing values over.
  await db.execAsync(`ALTER TABLE files ADD COLUMN mediaAssetId TEXT;`)
  await db.execAsync(`UPDATE files SET mediaAssetId = localId WHERE localId IS NOT NULL;`)
  // Identity dedup against already-finalized files.
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_mediaAsset ON files(mediaAssetId) WHERE mediaAssetId IS NOT NULL;`,
  )

  // Adopt every existing hash='' placeholder under one synthetic 'legacy' import so the
  // new tables own all in-flight work from the first run. A fresh install (and any device with no in-flight imports)
  // has no placeholders; create no legacy import there, so its history isn't seeded with
  // an empty "imported before this update" row for imports that never existed.
  const placeholders = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM files
     WHERE hash = '' AND kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL`,
  )
  if (!placeholders || placeholders.n === 0) return

  const now = Date.now()
  await db.runAsync(
    `INSERT INTO imports (id, source, directoryId, expectedCount, dedupByHash, sealed, startedAt, updatedAt)
     VALUES ('legacy', 'legacy', NULL, 0, 1, 1, ?, ?)`,
    now,
    now,
  )

  // Copy each placeholder into import_files, keeping its id. A row that already failed
  // (lostReason set) lands terminal 'unavailable' carrying that reason; the rest land
  // 'pending' to be re-driven. A placeholder with a library asset id can re-resolve and
  // finalize ('media'); one without a durable source can't, so it drains to 'unavailable'
  // ('ephemeral').
  await db.execAsync(
    `INSERT INTO import_files (id, importId, state, reason, name, type, size,
                              createdAt, updatedAt, addedAt, mediaAssetId, sourceKind, directoryId, nextAttemptAt)
     SELECT id, 'legacy',
            CASE WHEN lostReason IS NOT NULL THEN 'unavailable' ELSE 'pending' END,
            lostReason, name, type, size,
            createdAt, updatedAt, addedAt, localId,
            CASE WHEN localId IS NOT NULL THEN 'media' ELSE 'ephemeral' END,
            directoryId, 0
     FROM files
     WHERE hash = '' AND kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL;`,
  )
  await db.execAsync(
    `DELETE FROM files WHERE hash = '' AND kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL;`,
  )

  // Recompute `current` for every (name, directoryId) group a placeholder vacated. `current`
  // marks the one live version of a name in a folder; a placeholder had grabbed it and set its
  // real sibling to 0. For each affected group, clear `current`, then set it on the newest
  // surviving row. `IS` (not `=`) so an unfiled group (directoryId NULL) compares equal.
  await db.execAsync(
    `UPDATE files SET current = 0
     WHERE kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL
       AND EXISTS (
         SELECT 1 FROM import_files i WHERE i.name = files.name AND i.directoryId IS files.directoryId
       );`,
  )
  await db.execAsync(
    `UPDATE files SET current = 1 WHERE id IN (
       SELECT id FROM (
         SELECT f.id, ROW_NUMBER() OVER (
           PARTITION BY f.name, f.directoryId ORDER BY f.updatedAt DESC, f.id DESC
         ) AS rn
         FROM files f
         WHERE f.kind = 'file' AND f.trashedAt IS NULL AND f.deletedAt IS NULL
           AND EXISTS (
             SELECT 1 FROM import_files i WHERE i.name = f.name AND i.directoryId IS f.directoryId
           )
       ) WHERE rn = 1
     );`,
  )
}

export const migration_0003_create_imports: Migration = {
  id: '0003_create_imports',
  description: 'Move in-flight imports into imports/import_files; finalized-only files table.',
  up,
}

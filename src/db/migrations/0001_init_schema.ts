import type * as SQLite from 'expo-sqlite'
import { logger } from '../../lib/logger'
import type { Migration } from './types'

// Initial schema migration.
async function up(db: SQLite.SQLiteDatabase): Promise<void> {
  try {
    // Create the files table.
    await db.execAsync(
      `CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      localId TEXT UNIQUE,
      addedAt INTEGER NOT NULL,
      name TEXT NOT NULL,
      size INTEGER NOT NULL,
      type TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      hash TEXT NOT NULL UNIQUE,
      thumbForHash TEXT,
      thumbSize INTEGER
    );`,
    )

    // Index for sorting on createdAt.
    // Matches ORDER BY createdAt, id for paginated lists without extra sort. Reverse scan works for DESC.
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_files_createdAt_id ON files(createdAt, id);`,
    )

    // Index for category filters like WHERE type LIKE 'video/%'.
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_files_fileType ON files(type);`,
    )

    // Index for searching and sorting on filename.
    // 1) Case-insensitive search: accelerates prefix searches like WHERE name LIKE 'foo%' COLLATE NOCASE.
    //    Note: It does not help contains searches like WHERE name LIKE '%foo%' due to leading wildcard.
    // 2) Sorting: matches ORDER BY name COLLATE NOCASE, id for stable, index-only ordered scans.
    //    Including id provides a deterministic tie-break and supports pagination without extra sort.
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_files_fileName_nocase_id ON files(name COLLATE NOCASE, id);`,
    )

    // Index for sync queries on updatedAt.
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_files_updatedAt_id ON files(updatedAt, id);`,
    )

    // Index to efficiently select thumbnails for an original and size bucket.
    await db.execAsync(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_files_thumbForHash_thumbSize ON files(thumbForHash, thumbSize);`,
    )

    // Create the objects table.
    await db.execAsync(
      `CREATE TABLE IF NOT EXISTS objects (
      fileId TEXT NOT NULL,
      indexerURL TEXT NOT NULL,
      id TEXT NOT NULL,
      slabs TEXT NOT NULL,
      encryptedDataKey TEXT NOT NULL,
      encryptedMetadataKey TEXT NOT NULL,
      encryptedMetadata TEXT NOT NULL,
      dataSignature TEXT NOT NULL,
      metadataSignature TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      PRIMARY KEY (indexerURL, id),
      FOREIGN KEY (fileId) REFERENCES files(id) ON DELETE CASCADE
    );`,
    )

    // Index for lookups by object id.
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_objects_id ON objects(id);`,
    )

    // Index for joins and filters by fileId.
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_objects_fileId ON objects(fileId);`,
    )

    // Create the fs table.
    // Metadata table that mirrors files on disk so we can track usage,
    // limit the total size of local storage, and evict unused files.
    await db.execAsync(
      `CREATE TABLE IF NOT EXISTS fs (
      fileId TEXT PRIMARY KEY,
      size INTEGER NOT NULL,
      addedAt INTEGER NOT NULL,
      usedAt INTEGER NOT NULL
    );`,
    )

    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_fs_addedAt ON fs(addedAt);`,
    )
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_fs_usedAt ON fs(usedAt);`,
    )

    // Create the logs table.
    await db.execAsync(
      `CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      level TEXT NOT NULL,
      scope TEXT NOT NULL,
      message TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );`,
    )

    // Index for filtering by level and scope.
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_logs_level_scope ON logs(level, scope);`,
    )

    // Index for ordering by creation time.
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_logs_createdAt ON logs(createdAt);`,
    )
  } catch (e) {
    logger.error('db', 'migration_error', {
      id: '0001_init_schema',
      error: e as Error,
    })
    throw e
  }
}

export const migration_0001_init_schema: Migration = {
  id: '0001_init_schema',
  description: 'Initialize storage schema.',
  up,
}

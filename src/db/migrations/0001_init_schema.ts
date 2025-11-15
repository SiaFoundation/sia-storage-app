import * as SQLite from 'expo-sqlite'
import { type Migration } from './types'
import { logger } from '../../lib/logger'

// Initial schema migration.
async function up(db: SQLite.SQLiteDatabase): Promise<void> {
  try {
    const cols = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info('files')"
    )
    const hasTable = cols.length > 0
    if (hasTable) return

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
      hash TEXT NOT NULL UNIQUE
    );`
    )

    // Index for sorting on createdAt.
    // Matches ORDER BY createdAt, id for paginated lists without extra sort. Reverse scan works for DESC.
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_files_createdAt_id ON files(createdAt, id);`
    )

    // Index for category filters like WHERE type LIKE 'video/%'.
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_files_fileType ON files(type);`
    )

    // Index for searching and sorting on filename.
    // 1) Case-insensitive search: accelerates prefix searches like WHERE name LIKE 'foo%' COLLATE NOCASE.
    //    Note: It does not help contains searches like WHERE name LIKE '%foo%' due to leading wildcard.
    // 2) Sorting: matches ORDER BY name COLLATE NOCASE, id for stable, index-only ordered scans.
    //    Including id provides a deterministic tie-break and supports pagination without extra sort.
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_files_fileName_nocase_id ON files(name COLLATE NOCASE, id);`
    )

    // Create the objects table.
    await db.execAsync(
      `CREATE TABLE IF NOT EXISTS objects (
      fileId TEXT NOT NULL,
      indexerURL TEXT NOT NULL,
      id TEXT NOT NULL,
      slabs TEXT NOT NULL,
      encryptedMasterKey TEXT NOT NULL,
      encryptedMetadata TEXT NOT NULL,
      signature TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      PRIMARY KEY (indexerURL, id),
      FOREIGN KEY (fileId) REFERENCES files(id) ON DELETE CASCADE
    );`
    )

    // Index for lookups by object id.
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_objects_id ON objects(id);`
    )

    // Index for joins and filters by fileId.
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_objects_fileId ON objects(fileId);`
    )
  } catch (e) {
    logger.log('[db] error running migration 0001_init_schema', e)
    throw e
  }
}

export const migration_0001_init_schema: Migration = {
  id: '0001_init_schema',
  description: 'Initialize core storage schema.',
  up,
}

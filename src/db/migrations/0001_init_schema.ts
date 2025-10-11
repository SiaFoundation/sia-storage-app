import * as SQLite from 'expo-sqlite'
import { type Migration } from './types'

// Initial schema migration.
async function up(db: SQLite.SQLiteDatabase): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info('files')"
  )
  const hasTable = cols.length > 0
  if (hasTable) return

  // Create the files table.
  // id: unique identifier assigned locally.
  // cid: content id which is the Blake2b hash of the object's slabs.
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      cid TEXT UNIQUE,
      fileName TEXT,
      fileSize INTEGER,
      createdAt INTEGER NOT NULL,
      fileType TEXT,
      sealedObjects TEXT NOT NULL DEFAULT '{}'
    );`
  )

  // Index for sorting on createdAt.
  // Matches ORDER BY createdAt, id for paginated lists without extra sort. Reverse scan works for DESC.
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_createdAt_id ON files(createdAt, id);`
  )

  // Index for category filters like WHERE fileType LIKE 'video/%'.
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_fileType ON files(fileType);`
  )

  // Index for searching and sorting on filename.
  // 1) Case-insensitive search: accelerates prefix searches like WHERE fileName LIKE 'foo%' COLLATE NOCASE.
  //    Note: It does not help contains searches like WHERE fileName LIKE '%foo%' due to leading wildcard.
  // 2) Sorting: matches ORDER BY fileName COLLATE NOCASE, id for stable, index-only ordered scans.
  //    Including id provides a deterministic tie-break and supports pagination without extra sort.
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_fileName_nocase_id ON files(fileName COLLATE NOCASE, id);`
  )
}

export const migration_0001_init_schema: Migration = {
  id: '0001_init_schema',
  up,
}

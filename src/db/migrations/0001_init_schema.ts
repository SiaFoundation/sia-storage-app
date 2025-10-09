import * as SQLite from 'expo-sqlite'
import { type Migration } from './types'

// Initial schema migration: create files table.
async function up(db: SQLite.SQLiteDatabase): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info('files')"
  )
  const hasTable = cols.length > 0
  if (hasTable) return

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
}

export const migration_0001_init_schema: Migration = {
  id: '0001_init_schema',
  up,
}

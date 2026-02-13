import type * as SQLite from 'expo-sqlite'
import { logger } from '../../lib/logger'
import type { Migration } from './types'

async function up(db: SQLite.SQLiteDatabase): Promise<void> {
  try {
    // Create the tags table for autocomplete/discovery.
    await db.execAsync(
      `CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        createdAt INTEGER NOT NULL,
        usedAt INTEGER NOT NULL,
        system INTEGER NOT NULL DEFAULT 0
      );`,
    )

    // Index for ordering by recently used.
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_tags_usedAt ON tags(usedAt);`,
    )

    // Create the file_tags junction table (local source of truth).
    await db.execAsync(
      `CREATE TABLE IF NOT EXISTS file_tags (
        fileId TEXT NOT NULL,
        tagId TEXT NOT NULL,
        PRIMARY KEY (fileId, tagId),
        FOREIGN KEY (fileId) REFERENCES files(id) ON DELETE CASCADE,
        FOREIGN KEY (tagId) REFERENCES tags(id) ON DELETE CASCADE
      );`,
    )

    // Index for looking up files by tag.
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_file_tags_tagId ON file_tags(tagId);`,
    )

    // Create the directories table.
    await db.execAsync(
      `CREATE TABLE IF NOT EXISTS directories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        createdAt INTEGER NOT NULL
      );`,
    )

    // Add directoryId column to files table (idempotent: ALTER TABLE ADD COLUMN
    // is not transactional in SQLite, so the column may already exist from a
    // previously failed run).
    const cols = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM pragma_table_info('files') WHERE name='directoryId'`,
    )
    if (cols.length === 0) {
      await db.execAsync(
        `ALTER TABLE files ADD COLUMN directoryId TEXT REFERENCES directories(id) ON DELETE SET NULL;`,
      )
    }

    // Index for looking up files by directory.
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_files_directoryId ON files(directoryId);`,
    )

    // Insert the Favorites system tag.
    const now = Date.now()
    await db.runAsync(
      `INSERT OR IGNORE INTO tags (id, name, createdAt, usedAt, system) VALUES (?, ?, ?, ?, 1)`,
      'sys:favorites',
      'Favorites',
      now,
      now,
    )
  } catch (e) {
    logger.error('db', 'migration_0006_error', { error: e as Error })
    throw e
  }
}

export const migration_0006_add_tags_and_directories: Migration = {
  id: '0006_add_tags_and_directories',
  description:
    'Add tags, file_tags, directories tables and Favorites system tag.',
  up,
}

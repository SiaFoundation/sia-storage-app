/**
 * DB migration: add kind column, make hash non-unique, rename thumbForHash → thumbForId.
 *
 * Uses a table recreation strategy (CREATE new → INSERT SELECT → DROP old → RENAME)
 * because SQLite doesn't support DROP COLUMN or ALTER COLUMN. The INSERT SELECT
 * derives `kind` from the presence of thumbForHash and copies thumbForHash values
 * into thumbForId, then a follow-up UPDATE resolves those content hashes to file IDs.
 *
 * Idempotent: checks PRAGMA table_info before running.
 */

import type * as SQLite from 'expo-sqlite'
import { logger } from '../../lib/logger'
import type { Migration } from './types'

async function up(db: SQLite.SQLiteDatabase): Promise<void> {
  try {
    const cols = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(files)`,
    )
    const colNames = new Set(cols.map((c) => c.name))
    if (colNames.has('kind') && colNames.has('thumbForId')) {
      return
    }
    await db.execAsync(`
      CREATE TABLE files_new (
        id TEXT PRIMARY KEY,
        localId TEXT UNIQUE,
        addedAt INTEGER NOT NULL,
        name TEXT NOT NULL,
        size INTEGER NOT NULL,
        type TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'file',
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        hash TEXT NOT NULL,
        thumbForId TEXT,
        thumbSize INTEGER
      );

      INSERT INTO files_new
        SELECT id, localId, addedAt, name, size, type,
          CASE WHEN thumbForHash IS NOT NULL THEN 'thumb' ELSE 'file' END,
          createdAt, updatedAt, hash, thumbForHash, thumbSize
        FROM files;

      DROP TABLE files;
      ALTER TABLE files_new RENAME TO files;

      -- Resolve hash values to file IDs.
      -- thumbForId currently holds content hashes copied from the old thumbForHash column.
      UPDATE files SET thumbForId = (
        SELECT f.id FROM files AS f
        WHERE f.hash = files.thumbForId AND f.kind = 'file'
        LIMIT 1
      ) WHERE kind = 'thumb';

      CREATE INDEX idx_files_hash ON files(hash);
      CREATE INDEX idx_files_kind ON files(kind);
      CREATE INDEX idx_files_thumbForId_thumbSize ON files(thumbForId, thumbSize);
      CREATE INDEX idx_files_createdAt_id ON files(createdAt, id);
      CREATE INDEX idx_files_fileType ON files(type);
      CREATE INDEX idx_files_fileName_nocase_id ON files(name COLLATE NOCASE, id);
      CREATE INDEX idx_files_updatedAt_id ON files(updatedAt, id);
    `)
  } catch (e) {
    logger.error('db', 'migration_error', {
      id: '0004_hash_and_thumbs',
      error: e as Error,
    })
    throw e
  }
}

export const migration_0004_hash_and_thumbs: Migration = {
  id: '0004_hash_and_thumbs',
  description:
    'Remove UNIQUE on hash, add kind column, rename thumbForHash to thumbForId.',
  up,
}

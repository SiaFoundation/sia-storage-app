import * as SQLite from 'expo-sqlite'
import { logger } from '../../lib/logger'
import { type Migration } from './types'

async function up(db: SQLite.SQLiteDatabase): Promise<void> {
  try {
    const cols = await db.getAllAsync<{
      name: string
      notnull?: number
    }>("PRAGMA table_info('files')")

    const hasTable = cols.length > 0
    if (!hasTable) {
      await db.execAsync(
        `CREATE TABLE IF NOT EXISTS files (
          id TEXT PRIMARY KEY,
          fileName TEXT,
          fileSize INTEGER,
          createdAt INTEGER NOT NULL,
          fileType TEXT NOT NULL DEFAULT 'application/octet-stream',
          pinnedObjects TEXT NOT NULL DEFAULT '{}',
          encryptionKey TEXT
        );`
      )
      return
    }

    const pinnedCol = cols.find((c) => c.name === 'pinnedObjects')
    const needsRebuild = !pinnedCol || pinnedCol.notnull !== 1

    if (needsRebuild) {
      logger.log(
        '[db] 0001: Rebuilding files table to enforce NOT NULL pinnedObjects'
      )
      await db.withTransactionAsync(async () => {
        await db.execAsync(
          `CREATE TABLE IF NOT EXISTS files_new (
            id TEXT PRIMARY KEY,
            fileName TEXT,
            fileSize INTEGER,
            createdAt INTEGER NOT NULL,
            fileType TEXT NOT NULL DEFAULT 'application/octet-stream',
            pinnedObjects TEXT NOT NULL DEFAULT '{}',
            encryptionKey TEXT
          );`
        )
        await db.execAsync(
          `INSERT OR REPLACE INTO files_new (id, fileName, fileSize, createdAt, fileType, pinnedObjects, encryptionKey)
           SELECT id, fileName, fileSize, createdAt,
                  COALESCE(fileType, 'application/octet-stream'),
                  COALESCE(pinnedObjects, '{}'),
                  encryptionKey
           FROM files;`
        )
        await db.execAsync('DROP TABLE files;')
        await db.execAsync('ALTER TABLE files_new RENAME TO files;')
      })
    } else {
      await db.runAsync(
        'UPDATE files SET pinnedObjects = ? WHERE pinnedObjects IS NULL',
        '{}'
      )
    }
  } catch (e) {
    logger.log('[db] 0001 migration error', e)
    // Best-effort create to avoid breakage.
    await db.execAsync(
      `CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        fileName TEXT,
        fileSize INTEGER,
        createdAt INTEGER NOT NULL,
        fileType TEXT NOT NULL DEFAULT 'application/octet-stream',
        pinnedObjects TEXT NOT NULL DEFAULT '{}',
        encryptionKey TEXT
      );`
    )
  }
}

export const migration_0001_enforceNonNullPinnedObjects: Migration = {
  id: '0001_enforce_nonnull_pinnedObjects',
  up,
}

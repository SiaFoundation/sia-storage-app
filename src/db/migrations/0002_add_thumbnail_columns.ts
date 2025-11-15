import * as SQLite from 'expo-sqlite'
import { type Migration } from './types'
import { logger } from '../../lib/logger'

async function columnExists(
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string
): Promise<boolean> {
  const cols = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info('${table}')`
  )
  return cols.some((c) => c.name === column)
}

// Add thumb-related columns to files: thumbForHash, thumbSize, width, height.
async function up(db: SQLite.SQLiteDatabase): Promise<void> {
  try {
    const table = 'files'
    const needsThumbForHash = !(await columnExists(db, table, 'thumbForHash'))
    const needsThumbSize = !(await columnExists(db, table, 'thumbSize'))

    if (needsThumbForHash) {
      await db.execAsync(`ALTER TABLE ${table} ADD COLUMN thumbForHash TEXT`)
    }
    if (needsThumbSize) {
      await db.execAsync(`ALTER TABLE ${table} ADD COLUMN thumbSize INTEGER`)
    }

    // Create an index to efficiently select thumbnails for an original and size bucket.
    await db.execAsync(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_files_thumbForHash_thumbSize ON files(thumbForHash, thumbSize)`
    )
  } catch (e) {
    logger.log('[db] error running migration 0002_add_thumbnail_columns', e)
    throw e
  }
}

export const migration_0002_add_thumbnail_columns: Migration = {
  id: '0002_add_thumbnail_columns',
  description: 'Add thumbnail metadata columns and indexes.',
  up,
}

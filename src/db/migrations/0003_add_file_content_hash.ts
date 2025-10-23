import * as SQLite from 'expo-sqlite'
import { type Migration } from './types'
import { logger } from '../../lib/logger'

/**
 * Adds a contentHash column to the files table.
 * The contentHash is a unique identifier for each file.
 * More details can be found in the calculateContentHash function.
 * It is unique across devices, so it can be used to track whether
 * incoming files from any source have already been imported.
 */
async function up(db: SQLite.SQLiteDatabase): Promise<void> {
  try {
    const cols = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info('files')"
    )
    const hasContentHash = cols.some((c) => c.name === 'contentHash')
    if (!hasContentHash) {
      await db.execAsync(`ALTER TABLE files ADD COLUMN contentHash TEXT`)
      await db.execAsync(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_files_contentHash ON files(contentHash)`
      )
    }
  } catch (e) {
    logger.log('[db] error running migration 0003_add_file_content_hash', e)
    throw e
  }
}

export const migration_0003_add_file_content_hash: Migration = {
  id: '0003_add_file_content_hash',
  up,
}

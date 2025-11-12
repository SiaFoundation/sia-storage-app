import * as SQLite from 'expo-sqlite'
import { type Migration } from './types'
import { logger } from '../../lib/logger'

// Adds an index on the updatedAt column to the files table.
// This is used to efficiently query files that have been updated since a given time.
async function up(db: SQLite.SQLiteDatabase): Promise<void> {
  try {
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_files_updatedAt_id ON files(updatedAt, id);`
    )
  } catch (e) {
    logger.log('[db] error running migration 0003_add_updated_at_index', e)
    throw e
  }
}

export const migration_0003_add_updated_at_index: Migration = {
  id: '0003_add_updated_at_index',
  up,
}

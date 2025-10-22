import * as SQLite from 'expo-sqlite'
import { type Migration } from './types'
import { logger } from '../../lib/logger'

async function up(db: SQLite.SQLiteDatabase): Promise<void> {
  try {
    const cols = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info('files')"
    )
    const hasCol = cols.some((c) => c.name === 'localId')
    if (!hasCol) {
      await db.execAsync(`ALTER TABLE files ADD COLUMN localId TEXT`)
      await db.execAsync(
        `CREATE INDEX IF NOT EXISTS idx_files_localId ON files(localId)`
      )
    }
  } catch (e) {
    logger.log('[db] error running migration 0002_add_file_local_id', e)
    throw e
  }
}

export const migration_0002_add_file_local_id: Migration = {
  id: '0002_add_file_local_id',
  up,
}

import * as SQLite from 'expo-sqlite'
import { type Migration } from './types'
import { logger } from '../../lib/logger'

async function up(db: SQLite.SQLiteDatabase): Promise<void> {
  try {
    const cols = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info('files')"
    )
    const hasFingerprint = cols.some((c) => c.name === 'fingerprint')
    if (!hasFingerprint) {
      await db.execAsync(`ALTER TABLE files ADD COLUMN fingerprint TEXT`)
      await db.execAsync(
        `CREATE INDEX IF NOT EXISTS idx_files_fingerprint ON files(fingerprint)`
      )
    }
  } catch (e) {
    logger.log('[db] error running migration 0003_add_fingerprint', e)
    throw e
  }
}

export const migration_0003_add_fingerprint: Migration = {
  id: '0003_add_fingerprint',
  up,
}

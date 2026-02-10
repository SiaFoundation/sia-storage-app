import type * as SQLite from 'expo-sqlite'
import type { Migration } from './types'

async function up(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync('ALTER TABLE logs ADD COLUMN data TEXT;')
}

export const migration_0003_logs_data_column: Migration = {
  id: '0003_logs_data_column',
  description: 'Add data column to logs table for structured log data.',
  up,
}

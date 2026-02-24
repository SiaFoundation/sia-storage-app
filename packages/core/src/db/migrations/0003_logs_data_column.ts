import type { DatabaseAdapter } from '../../adapters/db'
import type { Migration } from '../types'

async function up(db: DatabaseAdapter): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM pragma_table_info('logs') WHERE name='data'`,
  )
  if (cols.length === 0) {
    await db.execAsync('ALTER TABLE logs ADD COLUMN data TEXT;')
  }
}

export const migration_0003_logs_data_column: Migration = {
  id: '0003_logs_data_column',
  description: 'Add data column to logs table for structured log data.',
  up,
}

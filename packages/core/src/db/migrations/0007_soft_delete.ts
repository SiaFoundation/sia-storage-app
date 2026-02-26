import type { DatabaseAdapter } from '../../adapters/db'
import type { Migration } from '../types'

async function up(db: DatabaseAdapter): Promise<void> {
  await db.execAsync(
    'ALTER TABLE files ADD COLUMN trashedAt INTEGER;',
  )
  await db.execAsync(
    'ALTER TABLE files ADD COLUMN deletedAt INTEGER;',
  )
  await db.execAsync(
    'CREATE INDEX IF NOT EXISTS idx_files_trashedAt ON files(trashedAt);',
  )
  await db.execAsync(
    'CREATE INDEX IF NOT EXISTS idx_files_deletedAt ON files(deletedAt);',
  )
}

export const migration_0007_soft_delete: Migration = {
  id: '0007_soft_delete',
  description: 'Add trashedAt and deletedAt columns for soft delete and tombstone support.',
  up,
}

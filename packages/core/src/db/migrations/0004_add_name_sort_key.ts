import type { DatabaseAdapter } from '../../adapters/db'
import type { Migration } from '../types'

async function up(db: DatabaseAdapter): Promise<void> {
  await db.execAsync(`ALTER TABLE files ADD COLUMN nameSortKey TEXT`)
  await db.execAsync(`ALTER TABLE directories ADD COLUMN nameSortKey TEXT`)

  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_nameSortKey_id ON files(nameSortKey, id)`,
  )
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_current_nameSortKey
     ON files(nameSortKey, id)
     WHERE current = 1 AND kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL`,
  )
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_directories_nameSortKey ON directories(nameSortKey)`,
  )
  await db.execAsync(`DROP INDEX IF EXISTS idx_files_fileName_nocase_id`)
}

export const migration_0004_add_name_sort_key: Migration = {
  id: '0004_add_name_sort_key',
  description: 'Add nameSortKey column for natural sorting.',
  up,
}

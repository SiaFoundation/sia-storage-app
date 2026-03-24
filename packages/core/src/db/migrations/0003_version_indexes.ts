import type { DatabaseAdapter } from '../../adapters/db'
import type { Migration } from '../types'

const CURRENT_FILE = `current = 1 AND kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL`
const ACTIVE_FILE = `kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL`

async function up(db: DatabaseAdapter): Promise<void> {
  await db.execAsync(
    'ALTER TABLE files ADD COLUMN current INTEGER NOT NULL DEFAULT 1',
  )

  // Version group lookup: find all versions of a file by (name, directoryId).
  // Used by recalculateCurrentForGroup and queryFileVersions.
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_version_group
     ON files(name, directoryId, updatedAt DESC, id DESC)
     WHERE ${ACTIVE_FILE};`,
  )

  // Current files sorted by createdAt: library default sort, pagination.
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_current_createdAt
     ON files(createdAt DESC, id DESC)
     WHERE ${CURRENT_FILE};`,
  )

  // Current files sorted by addedAt: library ADDED sort.
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_current_addedAt
     ON files(addedAt DESC, id DESC)
     WHERE ${CURRENT_FILE};`,
  )

  // Current files sorted by size: library SIZE sort.
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_current_size
     ON files(size DESC, id DESC)
     WHERE ${CURRENT_FILE};`,
  )

  // Current files by type: category filtering (Image, Video, Audio, etc).
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_current_type
     ON files(type)
     WHERE ${CURRENT_FILE};`,
  )

  // Current files by directory: folder views and directory file counts.
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_current_directoryId
     ON files(directoryId)
     WHERE ${CURRENT_FILE};`,
  )

  // Current file lookup by name and directory: queryFileRecordByName.
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_current_name_directoryId
     ON files(name, directoryId)
     WHERE ${CURRENT_FILE};`,
  )
}

export const migration_0003_version_indexes: Migration = {
  id: '0003_version_indexes',
  description:
    'Add materialized current column and partial indexes for file versioning.',
  up,
}

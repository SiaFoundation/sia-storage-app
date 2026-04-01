import type { DatabaseAdapter } from '../../adapters/db'
import type { Migration } from '../types'

async function up(db: DatabaseAdapter): Promise<void> {
  // Save file→directory mappings before DROP triggers ON DELETE SET NULL
  await db.execAsync(
    `CREATE TEMP TABLE _dir_file_map AS
     SELECT id, directoryId FROM files WHERE directoryId IS NOT NULL`,
  )

  // Recreate directories table without COLLATE NOCASE, with nameSortKey
  await db.execAsync(
    `CREATE TABLE directories_new (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      createdAt INTEGER NOT NULL,
      nameSortKey TEXT
    )`,
  )
  await db.execAsync(
    `INSERT INTO directories_new (id, name, createdAt, nameSortKey)
     SELECT id, name, createdAt, nameSortKey FROM directories`,
  )
  await db.execAsync(`DROP TABLE directories`)
  await db.execAsync(`ALTER TABLE directories_new RENAME TO directories`)

  // Restore file→directory mappings
  await db.execAsync(
    `UPDATE files SET directoryId = (
       SELECT directoryId FROM _dir_file_map WHERE _dir_file_map.id = files.id
     )
     WHERE id IN (SELECT id FROM _dir_file_map)`,
  )
  await db.execAsync(`DROP TABLE _dir_file_map`)

  // Recreate directory indexes
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_directories_nameSortKey ON directories(nameSortKey)`,
  )

  // Recreate tags table without COLLATE NOCASE
  await db.execAsync(
    `CREATE TABLE tags_new (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      createdAt INTEGER NOT NULL,
      usedAt INTEGER NOT NULL,
      system INTEGER NOT NULL DEFAULT 0
    )`,
  )
  await db.execAsync(`INSERT INTO tags_new SELECT * FROM tags`)
  await db.execAsync(`DROP TABLE tags`)
  await db.execAsync(`ALTER TABLE tags_new RENAME TO tags`)
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_tags_usedAt ON tags(usedAt)`,
  )

  // Recreate version group index without COLLATE NOCASE
  await db.execAsync(`DROP INDEX IF EXISTS idx_files_version_group`)
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_version_group
     ON files(name, directoryId, updatedAt DESC, id DESC)
     WHERE kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL`,
  )
}

export const migration_0005_directories_case_sensitive: Migration = {
  id: '0005_directories_case_sensitive',
  description:
    'Remove COLLATE NOCASE from directories, tags, and file version index.',
  up,
}

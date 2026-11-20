import type { DatabaseAdapter } from '../../adapters/db'
import type { Migration } from '../types'

/*
 * A trashed file's versions share a name, the folder they left and their
 * trashedAt, and a tag change or favorite that reaches a trashed version
 * reads its versions by those three to keep them in order. The only index
 * covering trashed rows is on trashedAt alone, and every file trashed
 * together, such as the contents of a deleted folder, shares one trashedAt.
 * Through that index each lookup reads the whole batch, once per file, so
 * renaming a tag that a thousand files trashed together carry reads a million
 * rows inside one write transaction.
 *
 * Keyed on trashedAt and name, a lookup reads only that file's versions. It
 * holds trashed rows only, so live writes never touch it.
 */
async function up(db: DatabaseAdapter): Promise<void> {
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_files_trashed_versions ON files(trashedAt, name)
    WHERE kind = 'file' AND trashedAt IS NOT NULL AND deletedAt IS NULL;
  `)
}

export const migration_20261118_120000_trashed_versions_index: Migration = {
  id: '20261118_120000_trashed_versions_index',
  description: "Index a trashed file's versions by trash time and name.",
  up,
}

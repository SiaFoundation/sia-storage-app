/**
 * Database migrations runner.
 *
 * How it works:
 * - Migrations live in `src/db/migrations` and export `{ id, up }`.
 * - Applied migrations are tracked in the SQLite table `migrations (id TEXT PRIMARY KEY, appliedAt INTEGER)`.
 * - On app startup, `runMigrations` executes migrations not present in the table.
 * - Each migration runs inside a transaction; failures roll back and are not recorded.
 *
 * Adding a migration:
 * 1) Create a file, e.g. `0002_add_new_column.ts`, exporting `export const migration_0002_addNewColumn: Migration`.
 * 2) Append it to the `migrations` array below in the correct order.
 * 3) Make the `up` function idempotent/safe to re-run after rollback.
 *
 * Notes:
 * - Do not swallow errors inside migrations; log and rethrow so the runner can roll back.
 * - For breaking schema changes, prefer rebuild-copy-rename to preserve data.
 */
import * as SQLite from 'expo-sqlite'
import { logger } from '../../lib/logger'
import { type Migration } from './types'
import { migration_0001_init_schema } from './0001_init_schema'
import { migration_0002_add_file_local_id } from './0002_add_file_local_id'
import { migration_0003_add_fingerprint } from './0003_add_fingerprint'

const migrations: Migration[] = [
  migration_0001_init_schema,
  migration_0002_add_file_local_id,
  migration_0003_add_fingerprint,
]

export async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  logger.log('[db] checking migrations...')
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      appliedAt INTEGER NOT NULL
    );`
  )

  const appliedRows = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM migrations'
  )
  const applied = new Set(appliedRows.map((r) => r.id))

  const needToApply = migrations.length - applied.size
  if (needToApply > 0) {
    logger.log(
      '[db] need to apply',
      migrations.length - applied.size,
      'migrations'
    )
  }
  for (const m of migrations) {
    if (applied.has(m.id)) continue
    logger.log('[db] applying migration', m.id)
    await db.withTransactionAsync(async () => {
      await m.up(db)
      await db.runAsync(
        'INSERT INTO migrations (id, appliedAt) VALUES (?, ?)',
        m.id,
        Date.now()
      )
    })
  }
  logger.log('[db] all migrations applied')
}

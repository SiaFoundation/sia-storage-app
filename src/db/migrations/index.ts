/**
 * Database migrations runner.
 *
 * How it works:
 * - Migrations live in `src/db/migrations` and export `{ id, description, up }`.
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
import type * as SQLite from 'expo-sqlite'
import { logger } from '../../lib/logger'
import { migration_0001_init_schema } from './0001_init_schema'
import { migration_0002_keychain_accessibility } from './0002_keychain_accessibility'
import { migration_0003_logs_data_column } from './0003_logs_data_column'
import { migration_0004_hash_and_thumbs } from './0004_hash_and_thumbs'
import { migration_0005_reset_sync_up_cursor } from './0005_reset_sync_up_cursor'
import type { Migration, MigrationProgressHandler } from './types'

const migrations: Migration[] = [
  migration_0001_init_schema,
  migration_0002_keychain_accessibility,
  migration_0003_logs_data_column,
  migration_0004_hash_and_thumbs,
  migration_0005_reset_sync_up_cursor,
]

export async function runMigrations(
  db: SQLite.SQLiteDatabase,
  onProgress?: MigrationProgressHandler,
): Promise<void> {
  logger.debug('db', 'checking_migrations')
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      appliedAt INTEGER NOT NULL
    );`,
  )

  const appliedRows = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM migrations',
  )
  const applied = new Set(appliedRows.map((r) => r.id))

  const needToApply = migrations.length - applied.size
  if (needToApply > 0) {
    logger.info('db', 'migrations_pending', {
      count: migrations.length - applied.size,
    })
  }
  for (const m of migrations) {
    if (applied.has(m.id)) {
      continue
    }
    logger.info('db', 'applying_migration', { id: m.id })
    onProgress?.({
      id: m.id,
      message: m.description,
    })
    await db.withTransactionAsync(async () => {
      await m.up(db, onProgress)
      await db.runAsync(
        'INSERT INTO migrations (id, appliedAt) VALUES (?, ?)',
        m.id,
        Date.now(),
      )
    })
  }
  logger.info('db', 'migrations_complete')
}

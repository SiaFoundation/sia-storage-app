import type { DatabaseAdapter } from '../adapters/db'
import type { Migration, MigrationProgressHandler } from './types'

export type MigrationLogger = {
  debug: (scope: string, msg: string, data?: Record<string, unknown>) => void
  info: (scope: string, msg: string, data?: Record<string, unknown>) => void
}

export async function runMigrations(
  db: DatabaseAdapter,
  migrations: Migration[],
  options?: {
    log?: MigrationLogger
    onProgress?: MigrationProgressHandler
  },
): Promise<void> {
  const log = options?.log
  const onProgress = options?.onProgress

  log?.debug('db', 'checking_migrations')
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      appliedAt INTEGER NOT NULL
    );`,
  )

  const appliedRows = await db.getAllAsync<{ id: string }>('SELECT id FROM migrations')
  const applied = new Set(appliedRows.map((r) => r.id))

  const needToApply = migrations.length - applied.size
  if (needToApply > 0) {
    log?.info('db', 'migrations_pending', {
      count: migrations.length - applied.size,
    })
  }
  for (const m of migrations) {
    if (applied.has(m.id)) {
      continue
    }
    log?.info('db', 'applying_migration', { id: m.id })
    onProgress?.({
      id: m.id,
      message: m.description,
    })
    await db.withTransactionAsync(async () => {
      await m.up(db, onProgress)
      await db.runAsync('INSERT INTO migrations (id, appliedAt) VALUES (?, ?)', m.id, Date.now())
    })
  }
  log?.info('db', 'migrations_complete')
}

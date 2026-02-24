import type { MigrationProgressHandler } from '@siastorage/core/db'
import { runMigrations } from '@siastorage/core/db'
import { Mutex } from '@siastorage/core/lib/mutex'
import { logger } from '@siastorage/logger'
import * as SQLite from 'expo-sqlite'
import { migrations } from './migrations'

export let database: SQLite.SQLiteDatabase
export let dbInitialized = false
let dbName = 'app.db'

export async function initializeDB(options?: {
  onProgress?: MigrationProgressHandler
  /** Custom database name (for test isolation) */
  databaseName?: string
}): Promise<void> {
  const name = options?.databaseName ?? dbName
  logger.info('db', 'initializing', { name })
  database = await SQLite.openDatabaseAsync(name)
  await database.execAsync('PRAGMA foreign_keys = ON')
  await runMigrations(database, migrations, {
    log: logger,
    onProgress: options?.onProgress,
  })
  dbInitialized = true
  dbName = name
  logger.info('db', 'initialized')
}

/** Close the database connection (for test cleanup) */
export async function closeDb(): Promise<void> {
  if (database && dbInitialized) {
    try {
      await database.closeAsync()
    } catch (e) {
      logger.debug('db', 'close_error', { error: e as Error })
    }
    dbInitialized = false
  }
}

// Drop all tables and run migrations again
export async function resetDb() {
  // Disable log appender before dropping tables to prevent "no such table: logs" errors
  dbInitialized = false
  // Disable foreign keys to allow dropping tables in any order
  await database.execAsync('PRAGMA foreign_keys = OFF')
  await database.withTransactionAsync(async () => {
    const rows = await database.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    )
    logger.debug('db', 'dropping_tables', {
      tables: rows.map((r) => r.name),
    })
    for (let i = 0; i < rows.length; i++) {
      const table = rows[i].name
      await database.execAsync(`DROP TABLE IF EXISTS "${table}"`)
    }
  })
  // Re-enable foreign keys
  await database.execAsync('PRAGMA foreign_keys = ON')
  await runMigrations(database, migrations, { log: logger })
}

export function db() {
  return database
}

const txMutex = new Mutex()

/** Run operations in a transaction and serialize all database transactions across the app. */
export async function withTransactionLock<T>(fn: () => Promise<T>): Promise<T> {
  return txMutex.runExclusive(async () => {
    let out!: T
    await db().withTransactionAsync(async () => {
      out = await fn()
    })
    return out
  })
}

import * as SQLite from 'expo-sqlite'
import { logger } from '../lib/logger'
import { Mutex } from '../lib/mutex'
import { runMigrations } from './migrations'
import type { MigrationProgressHandler } from './migrations/types'

export let database: SQLite.SQLiteDatabase
export let dbInitialized = false
const dbName = 'app.db'

export async function initializeDB(options?: {
  onProgress?: MigrationProgressHandler
}): Promise<void> {
  logger.info('db', 'initializing database...')
  database = await SQLite.openDatabaseAsync(dbName)
  await runMigrations(database, options?.onProgress)
  dbInitialized = true
  logger.info('db', 'database initialized')
}

// Drop all tables and run migrations again
export async function resetDb() {
  await database.withTransactionAsync(async () => {
    const rows = await database.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    )
    logger.debug(
      'db',
      'dropping tables',
      rows.map((r) => r.name),
    )
    for (let i = 0; i < rows.length; i++) {
      const table = rows[i].name
      await database.execAsync(`DROP TABLE IF EXISTS "${table}"`)
    }
  })
  await runMigrations(database)
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

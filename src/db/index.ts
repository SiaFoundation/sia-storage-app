import * as SQLite from 'expo-sqlite'
import { runMigrations } from './migrations'
import { type MigrationProgressHandler } from './migrations/types'
import { logger } from '../lib/logger'
import { Mutex } from '../lib/mutex'

export let database: SQLite.SQLiteDatabase
const dbName = 'app.db'

export async function initializeDB(options?: {
  onProgress?: MigrationProgressHandler
}): Promise<void> {
  logger.log('[db] initializing database...')
  database = await SQLite.openDatabaseAsync(dbName)
  await runMigrations(database, options?.onProgress)
  logger.log('[db] database initialized')
}

// Drop all tables and run migrations again
export async function resetDb() {
  await database.withTransactionAsync(async () => {
    const rows = await database.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
    )
    logger.log(
      '[db] dropping tables',
      rows.map((r) => r.name)
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

/**
 * Generic INSERT helper that:
 * - Inlines SQL NULL for nullish fields to avoid Android varargs null bridging issues.
 * - Binds only primitives (string | number) for the remaining fields.
 */
export async function insert<
  T extends Record<string, string | number | boolean | null | undefined>
>(table: string, row: T): Promise<SQLite.SQLiteRunResult> {
  const columns = Object.keys(row)
  const valuesSql: string[] = []
  const params: (string | number)[] = []

  for (const key of columns) {
    const value = row[key]
    if (value === null || value === undefined) {
      valuesSql.push('NULL')
      continue
    }
    valuesSql.push('?')
    if (typeof value === 'number' || typeof value === 'string') {
      params.push(value)
    } else if (typeof value === 'boolean') {
      params.push(value ? 1 : 0)
    } else {
      // Fallback: store as string representation.
      params.push(String(value))
    }
  }

  const sql = `INSERT INTO ${table} (${columns.join(
    ', '
  )}) VALUES (${valuesSql.join(', ')})`
  return await database.runAsync(sql, params)
}

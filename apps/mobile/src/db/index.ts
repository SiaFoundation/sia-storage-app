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
  dbName = name
  logger.info('db', 'initializing', { name })
  database = await SQLite.openDatabaseAsync(name)
  await db().execAsync('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON')
  await runMigrations(db(), migrations, {
    log: logger,
    onProgress: options?.onProgress,
  })
  dbInitialized = true
  logger.info('db', 'initialized')
}

/**
 * Detects expo-sqlite Android NullPointerException where the native
 * database handle becomes invalid while operations are still in flight.
 * The exact cause is unconfirmed — possibly related to SharedObject
 * lifecycle or native resource management on Android.
 */
function isNativeHandleError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes('has been rejected') &&
    error.message.includes('NullPointerException')
  )
}

let recovering: Promise<boolean> | null = null

/**
 * Reopens the database connection after a native handle invalidation.
 * The database file is intact — only the native handle needs replacing.
 * Serializes concurrent recovery attempts.
 */
async function reopenDb(): Promise<boolean> {
  if (recovering) return recovering
  recovering = (async () => {
    try {
      dbInitialized = false
      logger.warn('db', 'native_handle_invalidated_reopening')
      // Close old connection to release its cache entry (expected to fail).
      try {
        await database.closeAsync()
      } catch {}
      // useNewConnection bypasses expo-sqlite's per-name connection cache.
      database = await SQLite.openDatabaseAsync(dbName, {
        useNewConnection: true,
      })
      await database.execAsync(
        'PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON',
      )
      dbInitialized = true
      logger.warn('db', 'reopened_successfully')
      return true
    } catch (e) {
      logger.error('db', 'reopen_failed', { error: e as Error })
      dbInitialized = false
      return false
    } finally {
      recovering = null
    }
  })()
  return recovering
}

/**
 * Runs a database operation with automatic recovery from native handle
 * invalidation. On failure, reopens the connection and retries once.
 */
export async function withRecovery<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (isNativeHandleError(error) && (await reopenDb())) {
      return await fn()
    }
    throw error
  }
}

/** Close the database connection (for test cleanup). */
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

// Drop all tables and run migrations again.
// Uses `database` directly — recovery doesn't apply during a destructive reset.
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

const RECOVERY_METHODS = new Set([
  'getAllAsync',
  'getFirstAsync',
  'getEachAsync',
  'runAsync',
  'execAsync',
  'prepareAsync',
])

let _dbProxy: SQLite.SQLiteDatabase | null = null

/**
 * Returns a proxy around the current database connection that automatically
 * retries operations on native handle invalidation (Android NPE).
 * All async query/exec methods are wrapped with recovery; other methods
 * (like withTransactionAsync) pass through directly.
 */
export function db(): SQLite.SQLiteDatabase {
  if (!_dbProxy) {
    _dbProxy = new Proxy({} as SQLite.SQLiteDatabase, {
      get(_, prop) {
        const value = (database as any)[prop]
        if (typeof prop === 'string' && RECOVERY_METHODS.has(prop)) {
          return (...args: unknown[]) =>
            withRecovery(() => (database as any)[prop](...args))
        }
        if (typeof value === 'function') {
          return value.bind(database)
        }
        return value
      },
    })
  }
  return _dbProxy
}

const txMutex = new Mutex()

/**
 * Run operations in a transaction and serialize all database transactions across the app.
 * Uses `database` directly for withTransactionAsync — transaction lifecycle can't be
 * retried at the method level. The outer withRecovery retries the entire transaction.
 */
export async function withTransactionLock<T>(fn: () => Promise<T>): Promise<T> {
  return txMutex.runExclusive(() =>
    withRecovery(async () => {
      let out!: T
      await database.withTransactionAsync(async () => {
        out = await fn()
      })
      return out
    }),
  )
}

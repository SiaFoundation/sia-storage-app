import type { MigrationProgressHandler } from '@siastorage/core/db'
import { runMigrations } from '@siastorage/core/db'
import { Mutex } from '@siastorage/core/lib/mutex'
import { logger } from '@siastorage/logger'
import * as SQLite from 'expo-sqlite'
import { getSharedDbDirectory } from '../lib/sharedContainer'
import { migrations } from './migrations'

export let database: SQLite.SQLiteDatabase
export let dbInitialized = false
let dbName = 'app.db'
const dbDirectory = getSharedDbDirectory()
export async function initializeDB(options?: {
  onProgress?: MigrationProgressHandler
  /** Custom database name (for test isolation) */
  databaseName?: string
}): Promise<void> {
  const name = options?.databaseName ?? dbName
  dbName = name
  logger.info('db', 'initializing', { name, directory: dbDirectory })
  database = await SQLite.openDatabaseAsync(name, undefined, dbDirectory)
  await db().execAsync(
    'PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON',
  )
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
      database = await SQLite.openDatabaseAsync(
        dbName,
        { useNewConnection: true },
        dbDirectory,
      )
      await database.execAsync(
        'PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON',
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

// Delete the database and start fresh. Closes the existing connection,
// removes the DB file, and reopens so migrations can run on next init.
export async function resetDb() {
  dbInitialized = false
  if (database) {
    try {
      await database.closeAsync()
    } catch {}
  }
  await SQLite.deleteDatabaseAsync(dbName, dbDirectory)
  database = await SQLite.openDatabaseAsync(dbName, undefined, dbDirectory)
  await database.execAsync(
    'PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON',
  )
  await runMigrations(database, migrations, { log: logger })
  dbInitialized = true
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

const txMutex = new Mutex()

/**
 * Returns a proxy around the current database connection that automatically
 * retries operations on native handle invalidation (Android NPE).
 * All async query/exec methods are wrapped with recovery.
 * `withTransactionAsync` is wrapped with mutex serialization + recovery
 * so all code paths (including core operations) get these guarantees.
 */
export function db(): SQLite.SQLiteDatabase {
  if (!_dbProxy) {
    _dbProxy = new Proxy({} as SQLite.SQLiteDatabase, {
      get(_, prop) {
        if (prop === 'withTransactionAsync') {
          return (fn: () => Promise<void>) =>
            txMutex.runExclusive(() =>
              withRecovery(async () => {
                await database.withTransactionAsync(fn)
              }),
            )
        }
        const value = (database as any)[prop]
        if (typeof prop === 'string' && RECOVERY_METHODS.has(prop)) {
          return (...args: unknown[]) =>
            withRecovery(async () => {
              const start = performance.now()
              const result = await (database as any)[prop](...args)
              const duration = performance.now() - start
              const sql = typeof args[0] === 'string' ? args[0] : undefined
              if (duration > 500 && !sql?.startsWith('INSERT INTO logs')) {
                logger.warn('db', 'slow_query', {
                  method: prop,
                  duration: Math.round(duration),
                  sql,
                })
              }
              return result
            })
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

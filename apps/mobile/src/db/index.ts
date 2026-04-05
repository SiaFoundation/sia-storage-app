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
  /** Bypass expo-sqlite connection cache when reopening after suspension. */
  reopen?: boolean
}): Promise<void> {
  const name = options?.databaseName ?? dbName
  dbName = name
  // Clear the cached proxy so db() creates a fresh one bound to the new connection.
  _dbProxy = null
  const openOptions = options?.reopen ? { useNewConnection: true } : undefined
  logger.info('db', 'initializing', {
    name,
    directory: dbDirectory,
    reopen: !!options?.reopen,
  })
  database = await SQLite.openDatabaseAsync(name, openOptions, dbDirectory)
  // Use database directly (not the db() proxy) to avoid triggering
  // withRecovery during init, which would open a competing connection.
  await database.execAsync(
    'PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON',
  )
  await runMigrations(database, migrations, {
    log: logger,
    onProgress: options?.onProgress,
  })
  dbInitialized = true
  logger.info('db', 'initialized')
}

/**
 * Detects errors from an invalidated native database handle:
 * - Android NullPointerException: SharedObject lifecycle issue.
 * - "Access to closed resource": DB was closed for background suspension
 *   while a query was in-flight (e.g., from a SWR React hook).
 * In both cases, reopening the connection and retrying resolves it.
 */
function isNativeHandleError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes('has been rejected') &&
    (error.message.includes('NullPointerException') || error.message.includes('closed resource'))
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
      database = await SQLite.openDatabaseAsync(dbName, { useNewConnection: true }, dbDirectory)
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
    if (isNativeHandleError(error)) {
      // If the DB was already reopened by the suspension manager,
      // just retry against the current connection.
      if (dbInitialized || (await reopenDb())) {
        return await fn()
      }
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
  const release = await txMutex.acquire()
  try {
    _dbProxy = null
    if (database) {
      try {
        await database.closeAsync()
      } catch {}
    }
    try {
      await SQLite.deleteDatabaseAsync(dbName, dbDirectory)
    } catch (e) {
      // TODO: Remove after all users have upgraded past v1.9 (app group migration).
      // Ignore "not found" on upgrade from pre-app-group location.
      // Re-throw other errors so reset failures aren't silently swallowed.
      if (e instanceof Error && e.message.includes('not found')) {
        // Expected on first upgrade — DB was at old location.
      } else {
        throw e
      }
    }
    database = await SQLite.openDatabaseAsync(dbName, { useNewConnection: true }, dbDirectory)
    await database.execAsync(
      'PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON',
    )
    await runMigrations(database, migrations, { log: logger })
    dbInitialized = true
  } finally {
    release()
  }
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

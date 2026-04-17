import type { DatabaseAdapter, SQLParam, SQLRunResult } from '@siastorage/core/adapters'
import type { MigrationProgressHandler } from '@siastorage/core/db'
import { runMigrations } from '@siastorage/core/db'
import { Mutex } from '@siastorage/core/lib/mutex'
import { logger } from '@siastorage/logger'
import * as SQLite from 'expo-sqlite'
import { getSharedDbDirectory } from '../lib/sharedContainer'
import { migrations } from './migrations'

// Thrown by the adapter when a query has been waiting for the suspension
// gate to reopen beyond WAIT_TIMEOUT_MS — this only happens if resume never
// fires, which means the app is in a broken state.
export class DatabaseSuspendedError extends Error {
  constructor() {
    super('Database is suspended for background transition')
    this.name = 'DatabaseSuspendedError'
  }
}

// Suspension lifecycle state (separate from dbInitialized).
// - 'active':     queries flow normally through the adapter.
// - 'suspending': new queries park on a waiter queue; in-flight queries drain.
// - 'closed':     database handle is closed, WAL lock released; waiters park.
//
// When not active, queries WAIT instead of reject. This matters during the
// ~80ms `db.reopen()` window on resume: native callbacks (image picker,
// share intent) fire their continuation the moment the app foregrounds and
// race our resume flow. If we rejected, a caller like importFiles would
// lose its write. Waiters drain inside resumeDb(), so the queued query
// dispatches to the newly-reopened handle.
//
// This preserves 0xdead10cc protection: queued waiters don't touch SQLite's
// native GCD queue, so there's no fsync in flight when iOS freezes the
// process. Waiters are just heap objects that drain post-resume.
type DbState = 'active' | 'suspending' | 'closed'

let state: DbState = 'active'

// Queue of callers parked inside waitForActive(). resumeDb() drains them
// in FIFO order once the database handle is valid again.
let activeWaiters: Array<() => void> = []

// Safety valve: if resume never fires (app stuck in broken state), don't
// let waiters pile up forever. 30s is well past any realistic iOS thaw
// or Android foreground transition.
const WAIT_TIMEOUT_MS = 30_000

function waitForActive(): Promise<void> {
  if (state === 'active') return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const resolveOnce = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve()
    }
    activeWaiters.push(resolveOnce)
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      activeWaiters = activeWaiters.filter((w) => w !== resolveOnce)
      reject(new DatabaseSuspendedError())
    }, WAIT_TIMEOUT_MS)
  })
}

// Tracks how many queries are currently dispatched to native but haven't
// resolved yet. The suspension manager waits for this to hit 0 before
// closing the database, ensuring no in-progress queries hold the WAL lock.
let inflightCount = 0
let idleResolvers: Array<() => void> = []

function trackStart(): void {
  inflightCount++
}

function trackEnd(): void {
  inflightCount--
  if (inflightCount === 0) {
    const resolvers = idleResolvers
    idleResolvers = []
    for (const r of resolvers) r()
  }
}

export function getDbState(): DbState {
  return state
}

export function getInflightCount(): number {
  return inflightCount
}

export function getWaiterCount(): number {
  return activeWaiters.length
}

/** Path to the SQLite WAL file, for diagnostic stat() calls. */
export function getWalPath(): string {
  return `${dbDirectory}/${dbName}-wal`
}

// Called by the suspension manager as the first step when the app backgrounds.
// After this, new queries through db() park on the waiter queue until resume.
export function suspendDb(): void {
  state = 'suspending'
  logger.debug('db', 'suspended')
}

// Called by the suspension manager after initializeDB({ reopen: true })
// succeeds. Flips state back to active and drains the waiter queue so any
// queries parked during suspend/close/reopen dispatch to the valid handle.
export function resumeDb(): void {
  state = 'active'
  inflightCount = 0
  idleResolvers = []
  const waiters = activeWaiters
  activeWaiters = []
  for (const w of waiters) w()
  logger.debug('db', 'resumed', { drained: waiters.length })
}

// Resolves when all in-flight queries have completed. Used by the suspension
// manager to wait for the native GCD queue to drain before closing.
export function waitForQueriesIdle(): Promise<void> {
  if (inflightCount === 0) return Promise.resolve()
  return new Promise<void>((r) => {
    idleResolvers.push(r)
  })
}

export let database: SQLite.SQLiteDatabase
export let dbInitialized = false
let dbName = 'app.db'
const dbDirectory = getSharedDbDirectory()

// synchronous=NORMAL under WAL trades fsync-per-commit for fsync-per-checkpoint,
// drastically reducing the chance a commit is mid-fsync at iOS suspension time
// (the mechanism behind 0xdead10cc). Durable across app kills — the WAL file
// survives; only a full OS crash loses the last few uncheckpointed seconds,
// which syncDown recovers from the indexer on next launch.
// wal_autocheckpoint=500 (~2MB at 4KB pages, down from default 1000/~4MB) keeps
// each checkpoint's fsync small so the fsyncs that remain finish in tens of ms
// even under disk I/O contention from Photos exports or large file copies.
const INIT_PRAGMAS =
  'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA wal_autocheckpoint = 500; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON'
export async function initializeDB(options?: {
  onProgress?: MigrationProgressHandler
  /** Custom database name (for test isolation) */
  databaseName?: string
  /** Bypass expo-sqlite connection cache when reopening after suspension. */
  reopen?: boolean
}): Promise<void> {
  const name = options?.databaseName ?? dbName
  dbName = name
  // Close any existing connection before opening a new one. Without this,
  // a suspend → resume (reopen=true) → full reinit (reopen=false) sequence
  // leaks the intermediate connection, and expo-sqlite refuses to delete
  // the database file while any connection is open.
  if (database) {
    try {
      await database.closeAsync()
    } catch {}
  }
  const openOptions = options?.reopen ? { useNewConnection: true } : undefined
  logger.info('db', 'initializing', {
    name,
    directory: dbDirectory,
    reopen: !!options?.reopen,
  })
  database = await SQLite.openDatabaseAsync(name, openOptions, dbDirectory)
  // Use database directly (not the db() adapter) to avoid triggering
  // withRecovery during init, which would open a competing connection.
  await database.execAsync(INIT_PRAGMAS)
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
      await database.execAsync(INIT_PRAGMAS)
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
    // During suspension or close, never attempt to reopen — the close is
    // intentional and reopening would fight the suspension manager.
    if (state !== 'active') {
      throw error
    }
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

export async function closeDb(): Promise<void> {
  if (database && dbInitialized) {
    // Set these BEFORE any async work so that withRecovery — which may be
    // triggered by racing queries — sees the closed state and doesn't reopen.
    dbInitialized = false
    state = 'closed'
    try {
      // Zero the busy timeout so any straggler query blocked on the SQLite
      // mutex fails immediately instead of waiting up to 5 seconds.
      await database.execAsync('PRAGMA busy_timeout = 0')
      // Flush WAL pages to the main database file and truncate the WAL.
      // This releases the WAL file lock — the actual cause of 0xdead10cc —
      // even if closeAsync() subsequently fails.
      await database.execAsync('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch (e) {
      logger.debug('db', 'pre_close_pragma_error', { error: e as Error })
    }
    try {
      await database.closeAsync()
    } catch (e) {
      logger.debug('db', 'close_error', { error: e as Error })
    }
  }
}

const txMutex = new Mutex()

// Delete the database and start fresh. Closes the existing connection,
// removes the DB file, and reopens so migrations can run on next init.
// Also resets the suspension state machine — resetDb is only called from
// the foreground (settings reset button / forced reset on boot), so the
// suspension state should always be active afterward.
export async function resetDb() {
  dbInitialized = false
  state = 'active'
  inflightCount = 0
  idleResolvers = []
  const waiters = activeWaiters
  activeWaiters = []
  for (const w of waiters) w()
  const release = await txMutex.acquire()
  try {
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
    await database.execAsync(INIT_PRAGMAS)
    await runMigrations(database, migrations, { log: logger })
    dbInitialized = true
  } finally {
    release()
  }
}

// Wraps the raw expo-sqlite connection with recovery (automatic reopen on
// native handle invalidation), transaction mutex serialization, and slow
// query logging. Reads the module-level `database` variable on every call,
// so connection swaps from initializeDB/resetDb/reopenDb are transparent.
class MobileDbAdapter implements DatabaseAdapter {
  private query<T>(method: string, args: unknown[]): Promise<T> {
    // Park the call until state === 'active'. During suspend/close/reopen
    // this blocks the caller rather than rejecting, so native callbacks
    // that fire their continuation on app foreground (image picker,
    // share intent) don't lose writes to the ~80ms reopen window. The
    // common case (state === 'active') skips the microtask detour so
    // trackStart runs synchronously and in-flight counting is exact.
    const dispatch = (): Promise<T> => {
      trackStart()
      return withRecovery(async () => {
        const start = performance.now()
        const result = await (database as any)[method](...args)
        const duration = performance.now() - start
        const sql = typeof args[0] === 'string' ? args[0] : undefined
        if (duration > 500 && !sql?.startsWith('INSERT INTO logs')) {
          logger.warn('db', 'slow_query', {
            method,
            duration: Math.round(duration),
            sql,
          })
        }
        return result
      }).finally(trackEnd)
    }
    if (state === 'active') return dispatch()
    return waitForActive().then(dispatch)
  }

  getAllAsync<T>(sql: string, ...params: SQLParam[]): Promise<T[]> {
    return this.query('getAllAsync', [sql, ...params])
  }

  getFirstAsync<T>(sql: string, ...params: SQLParam[]): Promise<T | null> {
    return this.query('getFirstAsync', [sql, ...params])
  }

  runAsync(sql: string, ...params: SQLParam[]): Promise<SQLRunResult> {
    return this.query('runAsync', [sql, ...params])
  }

  execAsync(sql: string): Promise<void> {
    return this.query('execAsync', [sql])
  }

  withTransactionAsync(fn: () => Promise<void>): Promise<void> {
    const dispatch = (): Promise<void> => {
      trackStart()
      return txMutex
        .runExclusive(() => withRecovery(() => database.withTransactionAsync(fn)))
        .finally(trackEnd)
    }
    if (state === 'active') return dispatch()
    return waitForActive().then(dispatch)
  }
}

const adapter = new MobileDbAdapter()

export function db(): DatabaseAdapter {
  return adapter
}

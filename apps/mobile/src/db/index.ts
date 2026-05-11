import type { DatabaseAdapter, SQLParam, SQLRunResult } from '@siastorage/core/adapters'
import type { MigrationProgressHandler } from '@siastorage/core/db'
import { runMigrations } from '@siastorage/core/db'
import { Mutex } from '@siastorage/core/lib/mutex'
import { logger } from '@siastorage/logger'
import * as SQLite from 'expo-sqlite'
import { Platform } from 'react-native'
import { getSharedDbDirectory } from '../lib/sharedContainer'
import { migrations } from './migrations'

// Thrown when a query is issued while the suspension gate is closed.
// Callers that need to wait for resume call waitUntilDbActive() first.
export class DatabaseSuspendedError extends Error {
  constructor() {
    super('Database is suspended for background transition')
    this.name = 'DatabaseSuspendedError'
  }
}

// Suspension lifecycle state. The DB connection stays open across
// suspension; iOS exempts SQLite files (recognized by magic bytes) from
// the 0xDEAD10CC kill as long as no write/fsync is mid-flight — the
// drain ensures that.
//
// - 'active':     queries flow normally.
// - 'suspending': queries fast-reject; callers that need to wait for
//                 resume call waitUntilDbActive() BEFORE the query.
//                 Calling it inside withTransactionAsync's fn deadlocks
//                 the drain (txMutex held while waiting).
// - 'closed':     handle destroyed, reopen imminent — queries park.
//                 Today only reachable via resetDb (manual reset).
type DbState = 'active' | 'suspending' | 'closed'

let state: DbState = 'active'

// Callers parked inside enterGate() or waitUntilDbActive(). Drained by
// resumeDb() when state returns to 'active'.
let activeWaiters: Array<() => void> = []

// Safety valve for a resume that never fires.
const WAIT_TIMEOUT_MS = 30_000

function parkUntilActive(): Promise<void> {
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

// Per-query gate. Fast-rejects during 'suspending' so in-flight
// transactions release the txMutex and let the drain finish; parking
// here would deadlock (fn awaits the parked write → mutex never
// releases → inflightCount stays high).
function enterGate(_intent: 'read' | 'write'): Promise<void> {
  if (state === 'active') return Promise.resolve()
  if (state === 'suspending') {
    return Promise.reject(new DatabaseSuspendedError())
  }
  // 'closed': park so picker / share-intent callbacks land their
  // INSERTs against the new handle after reopen.
  return parkUntilActive()
}

/**
 * Resolves when state returns to 'active'. Call BEFORE any sequence of
 * reads/writes that must land on the same side of the suspend gate —
 * typically right after an irrecoverable network or filesystem commit.
 *
 * Do NOT call from inside withTransactionAsync's fn — the txMutex is
 * held by then and the drain can't finish. Gate the whole logical
 * operation (txn included) instead.
 */
export function waitUntilDbActive(): Promise<void> {
  if (state === 'active') return Promise.resolve()
  return parkUntilActive()
}

// Tracks how many queries are currently dispatched to native but haven't
// resolved yet. The suspension manager's drain awaits this hitting 0 so
// no SQL statement is mid-fsync at iOS suspension time (= 0xDEAD10CC).
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

// First step when the app backgrounds. Queries through db() then
// fast-reject; callers that want to wait for resume call
// waitUntilDbActive() BEFORE issuing the query.
export function suspendDb(): void {
  state = 'suspending'
  logger.debug('db', 'suspended')
}

// Called on foreground. Drains waiters parked via waitUntilDbActive()
// or the 'closed'-state enterGate path.
//
// Do NOT reset inflightCount: queries dispatched BEFORE the gate already
// incremented inflight, and their pending trackEnd calls would drive
// the count negative — pinning waitForQueriesIdle and stalling the next
// drain until MAX_DRAIN_MS.
export function resumeDb(): void {
  state = 'active'
  const waiters = activeWaiters
  activeWaiters = []
  for (const w of waiters) w()
  logger.debug('db', 'resumed', { drained: waiters.length })
}

// Resolves when all in-flight queries have completed. Used by the
// suspension manager's drain loop to confirm no statement is currently
// executing on the connection before iOS freezes the process.
export function waitForQueriesIdle(): Promise<void> {
  if (inflightCount === 0) return Promise.resolve()
  return new Promise<void>((r) => {
    idleResolvers.push(r)
  })
}

// Cancels any statement currently executing on the active connection.
// iOS only — the patch that adds interruptSync to NativeDatabase only ships
// the Swift side. sqlite3_interrupt is documented thread-safe and signals
// across threads, so this returns immediately and the running statement
// fails with SQLITE_INTERRUPT, releasing the SQLite mutex and the WAL lock
// — the actual mechanism behind 0xdead10cc on suspend.
export function interruptDatabase(): void {
  if (Platform.OS !== 'ios') return
  if (!dbInitialized || !database) return
  try {
    database.nativeDatabase.interruptSync()
  } catch (e) {
    logger.debug('db', 'interrupt_error', { error: e as Error })
  }
}

export let database: SQLite.SQLiteDatabase
export let dbInitialized = false
let dbName = 'app.db'
const dbDirectory = getSharedDbDirectory()

export type JournalMode = 'WAL' | 'DELETE'

// The mode the next initializeDB / reopenDb / resetDb will open the database
// with. Set once during bootstrap from the persisted developer preference.
// Defaults to DELETE; WAL is exposed as a developer toggle (Settings →
// Advanced → Database) so we can test it in the field. Once a feature
// requires WAL, the toggle and this default both go away.
let currentJournalMode: JournalMode = 'DELETE'

export function setJournalMode(mode: JournalMode): void {
  currentJournalMode = mode
}

export function getActiveJournalMode(): JournalMode {
  return currentJournalMode
}

function buildInitPragmas(mode: JournalMode): string {
  if (mode === 'WAL') {
    // synchronous=NORMAL under WAL trades fsync-per-commit for fsync-per-checkpoint,
    // drastically reducing the chance a commit is mid-fsync at iOS suspension time
    // (the mechanism behind 0xdead10cc). Durable across app kills — the WAL file
    // survives; only a full OS crash loses the last few uncheckpointed seconds,
    // which syncDown recovers from the indexer on next launch.
    // wal_autocheckpoint=500 (~2MB at 4KB pages, down from default 1000/~4MB) keeps
    // each checkpoint's fsync small so the fsyncs that remain finish in tens of ms
    // even under disk I/O contention from Photos exports or large file copies.
    return 'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA wal_autocheckpoint = 500; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON'
  }
  return 'PRAGMA journal_mode = DELETE; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON'
}
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
  await database.execAsync(buildInitPragmas(currentJournalMode))
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
 * - "Access to closed resource": DB closed underneath a racing call —
 *   today only reachable via resetDb (manual settings reset). The
 *   suspension flow no longer closes the connection.
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
      await database.execAsync(buildInitPragmas(currentJournalMode))
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
    // Wait for in-flight native calls to finish before destroying the
    // handle. Closing while a getAllAsync is mid-iteration produces a
    // use-after-free in sqlite3_mutex_enter (TestFlight crash #29).
    // The suspension manager owns the outer deadline; no timeout here.
    await waitForQueriesIdle()
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
    await database.execAsync(buildInitPragmas(currentJournalMode))
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
  private query<T>(method: string, intent: 'read' | 'write', args: unknown[]): Promise<T> {
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
    return enterGate(intent).then(dispatch)
  }

  getAllAsync<T>(sql: string, ...params: SQLParam[]): Promise<T[]> {
    return this.query('getAllAsync', 'read', [sql, ...params])
  }

  getFirstAsync<T>(sql: string, ...params: SQLParam[]): Promise<T | null> {
    return this.query('getFirstAsync', 'read', [sql, ...params])
  }

  runAsync(sql: string, ...params: SQLParam[]): Promise<SQLRunResult> {
    return this.query('runAsync', 'write', [sql, ...params])
  }

  // 'write' because execAsync runs arbitrary SQL — used for PRAGMA + DDL
  // during init/recovery. Defaulting to write is the safe lock-out.
  execAsync(sql: string): Promise<void> {
    return this.query('execAsync', 'write', [sql])
  }

  withTransactionAsync(fn: () => Promise<void>): Promise<void> {
    const dispatch = (): Promise<void> => {
      trackStart()
      return txMutex
        .runExclusive(async () => {
          try {
            await withRecovery(() => database.withTransactionAsync(fn))
          } catch (e) {
            // If expo-sqlite's own ROLLBACK got hit by our interrupt loop,
            // the connection is left mid-transaction and the next BEGIN
            // fails. One best-effort retry recovers it.
            try {
              await database.execAsync('ROLLBACK')
            } catch {}
            throw e
          }
        })
        .finally(trackEnd)
    }
    if (state === 'active') return dispatch()
    return enterGate('write').then(dispatch)
  }

  waitUntilActive(): Promise<void> {
    return waitUntilDbActive()
  }
}

const adapter = new MobileDbAdapter()

export function db(): DatabaseAdapter {
  return adapter
}

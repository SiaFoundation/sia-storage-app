/*
 * The app's SQLite connections behind the core's DatabaseAdapter, with the
 * gate that makes iOS background suspension safe.
 *
 * iOS kills a suspended app with 0xdead10cc if it holds a lock on a file in
 * the shared app group, which SQLite does while a statement writes. It exempts
 * SQLite files, recognized by their header, once no write is mid-flight, so
 * the connection stays open across suspension. The suspension manager closes
 * the gate, waits a grace period for the work already dispatched to settle
 * (the drain), then interrupts statements until it does.
 *
 * Reads outside a transaction run on a small pool of read-only connections.
 * Under WAL a reader sees the last commit without waiting for an open
 * transaction to end, and a UI read does not queue behind a long write. With
 * no pool, reads use the writer.
 *
 * | gate                | new call | statement inside an open transaction    |
 * |---------------------|----------|-----------------------------------------|
 * | active              | runs     | runs                                    |
 * | suspending          | parks    | runs, so the transaction can commit     |
 * | suspending, cut off | parks    | rejects, and the transaction rolls back |
 * | closed              | parks    | runs, and resetDb waits for it          |
 *
 * The drain's first interrupt cuts off open transactions. 'closed' is resetDb
 * replacing the connection. A parked call runs once the gate reopens, or
 * rejects with DatabaseSuspendedError after 30s of the app running, so a
 * caller never has to wait for resume itself. Parking a statement inside a
 * transaction instead would keep that transaction, and so the drain, open
 * across the freeze. A call through failFast() rejects where one would park.
 *
 * Everything on the writer holds the writer lock: a transaction for its
 * whole body, a statement outside one until it settles. expo-sqlite runs one
 * statement as several native calls (prepare, execute, finalize), so without
 * the lock another flow's BEGIN could land between them and pull the rest of
 * that statement into its transaction, to commit or roll back with it.
 */
import type { DatabaseAdapter, SQLParam, SQLRunResult } from '@siastorage/core/adapters'
import type { MigrationProgressHandler } from '@siastorage/core/db'
import { runMigrations } from '@siastorage/core/db'
import { DatabaseSuspendedError } from '@siastorage/core/lib/errors'
import { Mutex } from '@siastorage/core/lib/mutex'
import { logger } from '@siastorage/logger'
import * as SQLite from 'expo-sqlite'
import { Platform } from 'react-native'
import { getSharedDbDirectory } from '../lib/sharedContainer'
import { migrations } from './migrations'

type DbState = 'active' | 'suspending' | 'closed'

let state: DbState = 'active'

let activeWaiters: Array<() => void> = []

// Set by the drain's first interrupt and cleared on resume. Until then a
// transaction that held the writer lock when the gate closed keeps running,
// so it can commit inside the drain's grace period instead of rolling back.
let cutOff = false

// Safety valve for a resume that never fires.
const WAIT_TIMEOUT_MS = 30_000

// iOS stops timers while the app is frozen and fires the overdue ones as it
// wakes, which can be before the foreground event that reopens the gate. A
// timer this late means the wait spanned a freeze, so the wait starts over
// rather than failing a call that is about to be able to run.
const FROZEN_LATENESS_MS = 1_000

function parkUntilActive(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>
    const wake = () => {
      clearTimeout(timer)
      resolve()
    }
    const arm = () => {
      const due = Date.now() + WAIT_TIMEOUT_MS
      timer = setTimeout(() => {
        if (Date.now() - due > FROZEN_LATENESS_MS) return arm()
        activeWaiters = activeWaiters.filter((w) => w !== wake)
        reject(new DatabaseSuspendedError())
      }, WAIT_TIMEOUT_MS)
    }
    activeWaiters.push(wake)
    arm()
  })
}

/** What a call does while the gate is not active. */
type WhenGated = 'park' | 'reject'

function gated(when: WhenGated): Promise<void> {
  return when === 'park' ? parkUntilActive() : Promise.reject(new DatabaseSuspendedError())
}

function openGate(): number {
  state = 'active'
  cutOff = false
  const waiters = activeWaiters
  activeWaiters = []
  for (const w of waiters) w()
  return waiters.length
}

/** Work dispatched to native and not yet settled. */
class InFlight {
  private count = 0
  private idle: Array<() => void> = []

  get size(): number {
    return this.count
  }

  start(): void {
    this.count++
  }

  end(): void {
    this.count--
    if (this.count === 0) {
      const resolvers = this.idle
      this.idle = []
      for (const r of resolvers) r()
    }
  }

  settled(): Promise<void> {
    if (this.count === 0) return Promise.resolve()
    return new Promise<void>((r) => {
      this.idle.push(r)
    })
  }
}

// What the drain waits for: each statement from dispatch to settle, on the
// writer or a reader, each transaction from BEGIN to its end, and the close
// of a retired reader. Work
// waiting for the writer lock or parked at the gate holds no file lock, so it
// is not counted.
const inflight = new InFlight()

export function getDbState(): DbState {
  return state
}

export function getInflightCount(): number {
  return inflight.size
}

/** Path to the SQLite WAL file, for diagnostic stat() calls. */
export function getWalPath(): string {
  return `${dbDirectory}/${dbName}-wal`
}

// Readers are interrupted at once, with no grace period: a read has nothing to
// commit, and the one interrupted here runs again after resume.
export function suspendDb(): void {
  state = 'suspending'
  suspensions++
  interrupt(readers.filter((r) => r.inflight > 0).map((r) => r.conn))
  logger.debug('db', 'suspended')
}

// inflight is left alone: work dispatched before the gate closed still ends,
// and resetting the count would drive it negative and stall the next drain.
export function resumeDb(): void {
  const drained = openGate()
  wakeReadQueue()
  logger.debug('db', 'resumed', { drained })
}

// Settles when the reset in progress ends. The drain waits for a reset from
// its first line, the wait for the writer lock included, because a freeze
// partway through leaves the app with no database or a half-migrated one.
let resetting: Promise<void> = Promise.resolve()

export async function waitForQueriesIdle(): Promise<void> {
  await Promise.all([inflight.settled(), resetting])
}

// Set when the first initializeDB finishes. Its migrations run on the raw
// connection, outside the drain's count, so a suspend before then is declined.
// resetDb and reopenDb clear dbInitialized later, and the drain waits for both.
let opened = false

export function suspendBlocker(): string | null {
  return opened ? null : 'db_not_initialized'
}

export function isInTransaction(): boolean {
  return dbInitialized && database.isInTransactionSync()
}

/**
 * Rolls back a transaction still open after the drain, when none should be,
 * and reports whether one was open. It runs on the connection itself, since
 * the gate is closed.
 */
export async function endOpenTransaction(): Promise<boolean> {
  if (!isInTransaction()) return false
  try {
    await database.execAsync('ROLLBACK')
  } catch (e) {
    logger.warn('db', 'rollback_after_drain_failed', { error: e as Error })
  }
  return true
}

// The drain's interrupt: cuts off open transactions and cancels the statement
// executing on the writer and on every reader with a read in flight.
export function interruptDatabase(): void {
  cutOff = true
  if (!dbInitialized || !database) return
  interrupt([database, ...readers.filter((r) => r.inflight > 0).map((r) => r.conn)])
}

// iOS only, because the patch that adds interruptSync to NativeDatabase only
// ships the Swift side. sqlite3_interrupt is documented thread-safe and
// signals across threads, so this returns immediately and each running
// statement fails with SQLITE_INTERRUPT, releasing its lock on the database
// and WAL files.
function interrupt(conns: SQLite.SQLiteDatabase[]): void {
  if (Platform.OS !== 'ios') return
  for (const conn of conns) {
    try {
      conn.nativeDatabase.interruptSync()
    } catch (e) {
      logger.debug('db', 'interrupt_error', { error: e as Error })
    }
  }
}

export let database: SQLite.SQLiteDatabase
export let dbInitialized = false

/**
 * A connection as a DatabaseAdapter for migrations, which run on the raw
 * connection outside the gate, the lock and in-flight tracking.
 */
function migrationAdapter(conn: SQLite.SQLiteDatabase): DatabaseAdapter {
  const statements = {
    getAllAsync: <T>(sql: string, ...params: SQLParam[]) => conn.getAllAsync<T>(sql, ...params),
    getFirstAsync: <T>(sql: string, ...params: SQLParam[]) => conn.getFirstAsync<T>(sql, ...params),
    runAsync: (sql: string, ...params: SQLParam[]) => conn.runAsync(sql, ...params),
    execAsync: (sql: string) => conn.execAsync(sql),
  }
  const tx: DatabaseAdapter = { ...statements, withTransactionAsync: (nested) => nested(tx) }
  return { ...statements, withTransactionAsync: (fn) => conn.withTransactionAsync(() => fn(tx)) }
}
let dbName = 'app.db'
const dbDirectory = getSharedDbDirectory()

// synchronous=NORMAL under WAL fsyncs at checkpoint instead of every commit,
// so a commit is rarely mid-fsync when iOS suspends the app (the mechanism
// behind 0xdead10cc). An app kill loses nothing, because the WAL file
// survives. An OS crash can lose the last uncheckpointed commits. Sync-down
// restores the ones that had already synced up, and a local-only change such
// as a staged import or an unpushed edit is gone. wal_autocheckpoint=500 pages
// (2MB at 4KB pages, half the default) keeps each checkpoint fsync short under
// disk contention from Photos exports and large copies. SQLite reuses the WAL
// file after a checkpoint and never shrinks it, so journal_size_limit cuts it
// back to 4MB once a large transaction has grown it.
const INIT_PRAGMAS =
  'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA wal_autocheckpoint = 500; PRAGMA journal_size_limit = 4194304; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON'

const READ_POOL_SIZE = 2

// query_only makes a write sent to a reader fail with SQLITE_READONLY instead
// of taking a write lock beside the writer. cache_size is per connection, so
// readers get a smaller one than the writer's default.
const READER_PRAGMAS =
  'PRAGMA query_only = ON; PRAGMA busy_timeout = 5000; PRAGMA cache_size = -500'

type Reader = { conn: SQLite.SQLiteDatabase; inflight: number; retired: boolean }

let readers: Reader[] = []

// Reads waiting for a free reader. A reader runs one read at a time: SQLite
// keeps a connection's read snapshot until its last open statement finishes,
// and expo-sqlite holds a statement open across the separate native calls that
// prepare, step and finalize it. A read added beside one in flight would read
// the older snapshot, missing a write its caller already awaited.
let readQueue: Array<() => void> = []

// Each waiter looks for a reader again. Called when the pool or the gate
// changes, since a waiter may now belong on the writer or at the gate.
function wakeReadQueue(): void {
  const waiting = readQueue
  readQueue = []
  for (const w of waiting) w()
}

// Bumped by every suspendDb, so a read can tell it was cut off by one even
// after the gate has reopened.
let suspensions = 0

// Closes of retired readers still in progress, which resetDb waits for before
// it deletes the file.
const closing = new Set<Promise<void>>()

// Returns null where a second connection does not share the writer's file:
// `:memory:` gives each connection its own empty database, and a reader there
// would answer every read with "no such table".
async function openReader(): Promise<Reader | null> {
  const conn = await SQLite.openDatabaseAsync(dbName, { useNewConnection: true }, dbDirectory)
  let tables: { n: number } | null
  try {
    await conn.execAsync(READER_PRAGMAS)
    tables = await conn.getFirstAsync<{ n: number }>(
      "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'",
    )
  } catch (e) {
    await conn.closeAsync().catch(() => {})
    throw e
  }
  if (tables && tables.n > 0) return { conn, inflight: 0, retired: false }
  await conn.closeAsync().catch(() => {})
  return null
}

// Runs after migrations: a reader opened earlier could read a schema the
// migrations are still changing.
async function openReaders(): Promise<void> {
  const opened: Reader[] = []
  for (let i = 0; i < READ_POOL_SIZE; i++) {
    try {
      const reader = await openReader()
      if (!reader) break
      opened.push(reader)
    } catch (e) {
      logger.warn('db', 'reader_open_failed', { error: e as Error })
    }
  }
  readers = opened
  wakeReadQueue()
  logger.info('db', 'read_pool', { size: readers.length })
}

// resetDb deletes the file, which expo-sqlite refuses while any connection to
// it is open, retired readers included.
async function closeReaders(): Promise<void> {
  const open = readers
  readers = []
  wakeReadQueue()
  for (const r of open) {
    try {
      await r.conn.closeAsync()
    } catch {}
  }
  await Promise.all(closing)
}

// A reader whose native handle failed leaves the pool at once but closes only
// once its last read settles: closing under a running statement is the
// use-after-free resetDb waits out. The pool refills at the next launch or
// reset, and with no readers left, reads use the writer.
function retire(reader: Reader): void {
  if (reader.retired) return
  reader.retired = true
  readers = readers.filter((r) => r !== reader)
  wakeReadQueue()
  logger.warn('db', 'reader_retired', { remaining: readers.length })
  closeIfRetired(reader)
}

function closeIfRetired(reader: Reader): void {
  if (!reader.retired || reader.inflight > 0) return
  inflight.start()
  const closed = reader.conn
    .closeAsync()
    .catch(() => {})
    .finally(() => inflight.end())
  closing.add(closed)
  void closed.finally(() => closing.delete(closed))
}

export async function initializeDB(options?: {
  onProgress?: MigrationProgressHandler
  /** Custom database name (for test isolation) */
  databaseName?: string
}): Promise<void> {
  const name = options?.databaseName ?? dbName
  dbName = name
  // expo-sqlite refuses to delete the database file while any connection is
  // open, so a second initializeDB must not leak the first connections.
  await closeReaders()
  if (database) {
    try {
      await database.closeAsync()
    } catch {}
  }
  logger.info('db', 'initializing', { name, directory: dbDirectory })
  database = await SQLite.openDatabaseAsync(name, undefined, dbDirectory)
  // Use database directly (not the db() adapter) to avoid triggering
  // withRecovery during init, which would open a competing connection.
  await database.execAsync(INIT_PRAGMAS)
  await runMigrations(migrationAdapter(database), migrations, {
    log: logger,
    onProgress: options?.onProgress,
  })
  await openReaders()
  dbInitialized = true
  opened = true
  logger.info('db', 'initialized')
}

/**
 * Detects errors from an invalidated native database handle:
 * - Android NullPointerException: SharedObject lifecycle issue.
 * - "Access to closed resource": the connection closed underneath a call.
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
 * The database file is intact, only the native handle needs replacing.
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
    // With the gate closed, reopening would open a second connection behind
    // the drain or resetDb, so the error goes back to the caller.
    if (state !== 'active') {
      throw error
    }
    if (isNativeHandleError(error)) {
      // Another call may already have reopened it; retry on the current one.
      if (dbInitialized || (await reopenDb())) {
        return await fn()
      }
    }
    throw error
  }
}

const writerLock = new Mutex()

// Recent commits sit in app.db-wal until a checkpoint, so sharing app.db
// alone loses them. VACUUM INTO writes one file from a single read snapshot,
// which holds every committed write.
export async function copyDatabaseTo(path: string): Promise<void> {
  await db().execAsync(`VACUUM INTO '${path.replace(/'/g, "''")}'`)
}

// Delete the database and start fresh. Runs only in the foreground (the
// settings reset and the forced reset at boot), so the gate ends active.
export function resetDb(): Promise<void> {
  const reset = replaceDatabase()
  resetting = reset.catch(() => {})
  return reset
}

async function replaceDatabase(): Promise<void> {
  state = 'closed'
  const release = await writerLock.acquire()
  try {
    // Closing while a statement iterates the native handle is a
    // use-after-free in sqlite3_mutex_enter (TestFlight crash #29).
    await inflight.settled()
    dbInitialized = false
    await closeReaders()
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
    await runMigrations(migrationAdapter(database), migrations, { log: logger })
    await openReaders()
    dbInitialized = true
  } finally {
    release()
    // A suspend that landed mid-reset owns the gate now, and its resume reopens it.
    if (state === 'closed') openGate()
  }
}

async function execute<T>(
  conn: SQLite.SQLiteDatabase,
  method: string,
  args: unknown[],
): Promise<T> {
  const start = performance.now()
  const result = await (conn as any)[method](...args)
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
}

// Runs one statement on the writer with recovery (automatic reopen on native
// handle invalidation) and in-flight tracking. Reads the module-level
// `database` on every call, so connection swaps from initializeDB/resetDb/
// reopenDb are transparent.
function query<T>(method: string, args: unknown[]): Promise<T> {
  inflight.start()
  return withRecovery(() => execute<T>(database, method, args)).finally(() => inflight.end())
}

// A read that a suspension cut off, or that finds the reader's native handle
// invalidated, runs again through outerRead, however many suspensions it
// takes. The retry happens after its own count is released, so a retry that
// has to park at the gate does not hold the drain open.
function readerQuery<T>(reader: Reader, when: WhenGated, method: string, args: unknown[]) {
  const epoch = suspensions
  reader.inflight++
  inflight.start()
  return execute<T>(reader.conn, method, args)
    .finally(() => {
      reader.inflight--
      inflight.end()
      closeIfRetired(reader)
      readQueue.shift()?.()
    })
    .catch((error) => {
      if (isNativeHandleError(error)) retire(reader)
      else if (suspensions === epoch) throw error
      return outerRead<T>(when, method, args)
    })
}

function outerRead<T>(when: WhenGated, method: string, args: unknown[]): Promise<T> {
  if (readers.length === 0) return withWriter(when, () => query(method, args))
  if (state !== 'active') return gated(when).then(() => outerRead<T>(when, method, args))
  const free = readers.find((r) => r.inflight === 0)
  if (free) return readerQuery(free, when, method, args)
  return new Promise<void>((resolve) => readQueue.push(resolve)).then(() =>
    outerRead<T>(when, method, args),
  )
}

/**
 * Runs `run` holding the writer lock once the gate is open. The lock is taken
 * in the calling tick when it is free, so a statement made just before
 * suspendDb, such as the log flush fired from onBeforeSuspend, is in flight
 * before the gate closes. A call that waited for the lock checks the gate
 * again, and if it closed meanwhile gives the lock back, having written
 * nothing, and waits for resume, or rejects through failFast.
 */
function withWriter<T>(when: WhenGated, run: () => Promise<T>): Promise<T> {
  const release = state === 'active' ? writerLock.tryAcquire() : null
  if (release) return run().finally(release)
  return (async () => {
    for (;;) {
      if (state !== 'active') {
        await gated(when)
        continue
      }
      const acquired = await writerLock.acquire()
      if (state === 'active') return run().finally(acquired)
      acquired()
    }
  })()
}

async function runTransaction(fn: (tx: DatabaseAdapter) => Promise<void>): Promise<void> {
  inflight.start()
  let live = true
  const ended = () => new Error('This transaction has ended. Its handle is closed.')
  const tx: DatabaseAdapter = {
    ...statements((method, args) => {
      if (!live) return Promise.reject(ended())
      if (cutOff) return Promise.reject(new DatabaseSuspendedError())
      return query(method, args)
    }),
    // A nested op joins, with no savepoint: a throw that escapes the body
    // rolls all of it back, and one the body catches commits what the nested
    // op already wrote.
    withTransactionAsync: (nested) => (live ? nested(tx) : Promise.reject(ended())),
  }
  try {
    await withRecovery(() => database.withTransactionAsync(() => fn(tx)))
  } catch (e) {
    // If expo-sqlite's own ROLLBACK got hit by the drain's interrupt loop,
    // the connection is left mid-transaction and the next BEGIN fails. One
    // best-effort retry recovers it.
    try {
      await database.execAsync('ROLLBACK')
    } catch {}
    // An interrupted statement makes SQLite roll back on its own, and
    // expo-sqlite's ROLLBACK then fails with "no transaction is active",
    // which replaces the interrupt's error. The caller needs to see a
    // suspension to know the work is retried after resume, not failed.
    throw cutOff ? new DatabaseSuspendedError() : e
  } finally {
    live = false
    inflight.end()
  }
}

type Statements = Pick<DatabaseAdapter, 'getAllAsync' | 'getFirstAsync' | 'runAsync' | 'execAsync'>

function statements(run: <T>(method: string, args: unknown[]) => Promise<T>): Statements {
  return {
    getAllAsync: <T>(sql: string, ...params: SQLParam[]) =>
      run<T[]>('getAllAsync', [sql, ...params]),
    getFirstAsync: <T>(sql: string, ...params: SQLParam[]) =>
      run<T | null>('getFirstAsync', [sql, ...params]),
    runAsync: (sql: string, ...params: SQLParam[]) =>
      run<SQLRunResult>('runAsync', [sql, ...params]),
    execAsync: (sql: string) => run<void>('execAsync', [sql]),
  }
}

function gatedAdapter(when: WhenGated): DatabaseAdapter {
  // A statement the drain interrupts fails with SQLite's own error, which
  // reads as a real failure. The caller has to see a suspension, so the work
  // is retried after resume rather than counted as failed.
  const write = statements(<T>(method: string, args: unknown[]) =>
    withWriter(when, () =>
      query<T>(method, args).catch((e): never => {
        throw cutOff ? new DatabaseSuspendedError() : e
      }),
    ),
  )
  const read = statements((method, args) => outerRead(when, method, args))
  return {
    getAllAsync: read.getAllAsync,
    getFirstAsync: read.getFirstAsync,
    runAsync: write.runAsync,
    execAsync: write.execAsync,
    withTransactionAsync: (fn) => withWriter(when, () => runTransaction(fn)),
    failFast: () => failFastAdapter,
  }
}

const adapter = gatedAdapter('park')
const failFastAdapter = gatedAdapter('reject')

export function db(): DatabaseAdapter {
  return adapter
}

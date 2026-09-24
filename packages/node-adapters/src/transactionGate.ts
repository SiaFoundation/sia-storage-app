/*
 * The DatabaseAdapter both node drivers share: one SQLite connection serving
 * every flow in the process, with one transaction open at a time.
 *
 * A transaction holds the connection across awaits, and statements from other
 * flows keep arriving meanwhile. Run straight through, a second flow's BEGIN
 * fails with "cannot start a transaction within a transaction", and a plain
 * statement from another flow lands inside the open transaction, committing or
 * rolling back with work it knows nothing about. So transactions run in turn,
 * and a statement issued on the outer adapter waits for the open transaction to
 * end. A transaction body reaches the database through the handle it is given,
 * whose statements run inside the transaction.
 *
 * A body that uses the outer adapter would wait on its own transaction forever.
 * AsyncLocalStorage follows the body across its awaits, which is how that
 * mistake is told apart from another flow's statement and thrown at once.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { DatabaseAdapter, SQLParam, SQLRunResult } from '@siastorage/core/adapters'
import { Mutex } from '@siastorage/core/lib/mutex'
import { logger } from '@siastorage/logger'

/** The synchronous calls a node SQLite driver exposes. */
export type SqliteDriver = {
  all(sql: string, params: SQLParam[]): unknown[]
  get(sql: string, params: SQLParam[]): unknown
  run(sql: string, params: SQLParam[]): SQLRunResult
  exec(sql: string): void
}

export class TransactionMisuseError extends Error {
  constructor() {
    super(
      'Inside a transaction body, use the transaction handle it was given, not the outer adapter',
    )
    this.name = 'TransactionMisuseError'
  }
}

const SLOW_QUERY_MS = 500

function timed<T>(method: string, sql: string, run: () => T): T {
  const start = performance.now()
  const result = run()
  const duration = performance.now() - start
  if (duration > SLOW_QUERY_MS) {
    logger.warn('db', 'slow_query', { method, duration: Math.round(duration), sql })
  }
  return result
}

type Statements = Pick<DatabaseAdapter, 'getAllAsync' | 'getFirstAsync' | 'runAsync' | 'execAsync'>

/** Runs a statement when its turn comes: now, or after an open transaction. */
type Gate = <T>(run: () => T) => Promise<T>

function statements(driver: SqliteDriver, gate: Gate): Statements {
  const call = <T>(method: string, sql: string, run: () => T) => gate(() => timed(method, sql, run))
  return {
    getAllAsync: <T>(sql: string, ...params: SQLParam[]) =>
      call('getAllAsync', sql, () => driver.all(sql, params) as T[]),
    getFirstAsync: <T>(sql: string, ...params: SQLParam[]) =>
      call('getFirstAsync', sql, () => (driver.get(sql, params) as T) ?? null),
    runAsync: (sql: string, ...params: SQLParam[]) =>
      call('runAsync', sql, () => driver.run(sql, params)),
    execAsync: (sql: string) => call('execAsync', sql, () => driver.exec(sql)),
  }
}

export type GatedAdapter = Omit<DatabaseAdapter, 'finalize' | 'close'> & {
  /**
   * Waits for the open transaction and every one queued before this call, then
   * keeps the lock, so no transaction starts again. For shutdown, before the
   * last checkpoint and close.
   */
  retire(): Promise<void>
}

export function createGatedAdapter(driver: SqliteDriver): GatedAdapter {
  // Marks a body's async context. Cleared when its transaction ends, so work a
  // body started and did not await runs normally afterwards. Such work that
  // reaches the outer adapter while the transaction is still open throws, the
  // same as the body itself would.
  const inside = new AsyncLocalStorage<{ open: boolean }>()
  const mutex = new Mutex()
  let open: Promise<void> | null = null

  // With nothing open the loop never awaits, so the statement runs in the
  // caller's own tick and reads issued together in one tick all read one state.
  // Otherwise it runs in the same tick as the check that finds nothing open:
  // the next queued transaction may begin in any later one.
  const outerGate: Gate = async (run) => {
    if (inside.getStore()?.open) throw new TransactionMisuseError()
    while (open) await open
    return run()
  }

  const outer = statements(driver, outerGate)

  return {
    ...outer,
    async retire() {
      await mutex.acquire()
    },
    async withTransactionAsync(fn) {
      if (inside.getStore()?.open) throw new TransactionMisuseError()
      await mutex.runExclusive(async () => {
        const scope = { open: true }
        const tx: DatabaseAdapter = {
          ...statements(driver, async (run) => {
            if (!scope.open) throw new Error('This transaction has ended. Its handle is closed.')
            return run()
          }),
          // A nested op joins, with no savepoint: a throw that escapes the body
          // rolls all of it back, and one the body catches commits what the
          // nested op already wrote.
          withTransactionAsync: async (nested) => {
            if (!scope.open) throw new Error('This transaction has ended. Its handle is closed.')
            return nested(tx)
          },
        }
        let end!: () => void
        open = new Promise((resolve) => {
          end = resolve
        })
        try {
          driver.exec('BEGIN')
          try {
            await inside.run(scope, () => fn(tx))
            driver.exec('COMMIT')
          } catch (e) {
            driver.exec('ROLLBACK')
            throw e
          }
        } finally {
          scope.open = false
          open = null
          end()
        }
      })
    },
  }
}

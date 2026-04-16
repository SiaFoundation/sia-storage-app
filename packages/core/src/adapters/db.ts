export type SQLParam = string | number | boolean | null

export interface SQLRunResult {
  changes: number
  lastInsertRowId: number
}

/**
 * Platform-agnostic database adapter. Every adapter must implement the
 * query surface; lifecycle methods are optional and platform-specific.
 *
 * | Method            | Required | Implemented by  |
 * |-------------------|----------|-----------------|
 * | getAllAsync       | yes      | all             |
 * | getFirstAsync     | yes      | all             |
 * | runAsync          | yes      | all             |
 * | execAsync         | yes      | all             |
 * | withTransactionAsync | yes   | all             |
 * | waitForActive     | no       | mobile only     |
 * | finalize          | no       | node-adapters   |
 * | close             | no       | node-adapters   |
 */
export interface DatabaseAdapter {
  getAllAsync<T>(sql: string, ...params: SQLParam[]): Promise<T[]>
  getFirstAsync<T>(sql: string, ...params: SQLParam[]): Promise<T | null>
  runAsync(sql: string, ...params: SQLParam[]): Promise<SQLRunResult>
  execAsync(sql: string): Promise<void>
  withTransactionAsync(fn: () => Promise<void>): Promise<void>

  /**
   * Resolves once the DB is in a state where queries can dispatch (not
   * suspended). Mobile uses this to let multi-step services pause cleanly
   * across the iOS background gate. Call BEFORE the operation begins —
   * never inside `withTransactionAsync`'s fn, which would deadlock against
   * the suspension manager waiting on the txMutex.
   *
   * Adapters that don't gate (Node, web, tests) omit this. Callers must
   * tolerate `undefined` as "no waiting needed."
   */
  waitForActive?(): Promise<void>

  /**
   * Refreshes query planner stats and (for WAL adapters) truncates the WAL.
   * Call before {@link close} on graceful shutdown so the next start opens
   * a clean, optimized database.
   *
   * Implemented by node-adapters' `createBunDatabase` and
   * `createBetterSqlite3Database`. Mobile keeps a long-lived connection
   * across suspension and never finalizes.
   */
  finalize?(): Promise<void>

  /**
   * Releases the underlying database handle. After `close()`, no further
   * methods may be called on this adapter.
   *
   * Implemented by node-adapters factories. Mobile never closes — its
   * connection lives for the life of the process and is suspended in
   * place via the iOS lifecycle gate.
   */
  close?(): void
}

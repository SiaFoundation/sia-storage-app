export type SQLParam = string | number | boolean | null

export interface SQLRunResult {
  changes: number
  lastInsertRowId: number
}

export interface DatabaseAdapter {
  getAllAsync<T>(sql: string, ...params: SQLParam[]): Promise<T[]>
  getFirstAsync<T>(sql: string, ...params: SQLParam[]): Promise<T | null>
  runAsync(sql: string, ...params: SQLParam[]): Promise<SQLRunResult>
  execAsync(sql: string): Promise<void>
  withTransactionAsync(fn: () => Promise<void>): Promise<void>
  /**
   * If implemented, resolves when the DB is in a state where queries can
   * dispatch (not suspended). Adapters that don't gate (Node, web, tests)
   * omit this; callers must treat `undefined` as "no waiting needed."
   *
   * Mobile uses this to let multi-step services (upload finalize,
   * scanners) pause cleanly across the iOS background gate. Call BEFORE
   * the operation begins — never inside withTransactionAsync's fn, which
   * would deadlock against the suspension manager waiting on the txMutex.
   */
  waitForActive?(): Promise<void>
}

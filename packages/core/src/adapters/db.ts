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
}

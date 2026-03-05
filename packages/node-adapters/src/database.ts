import type {
  DatabaseAdapter,
  SQLParam,
  SQLRunResult,
} from '@siastorage/core/adapters'
import sqlite3 from 'better-sqlite3'

export function createBetterSqlite3Database(
  path = ':memory:',
): DatabaseAdapter & { close(): void } {
  const db = new sqlite3(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  return {
    async getAllAsync<T>(sql: string, ...params: SQLParam[]): Promise<T[]> {
      return db.prepare(sql).all(...params) as T[]
    },

    async getFirstAsync<T>(
      sql: string,
      ...params: SQLParam[]
    ): Promise<T | null> {
      return (db.prepare(sql).get(...params) as T) ?? null
    },

    async runAsync(sql: string, ...params: SQLParam[]): Promise<SQLRunResult> {
      const result = db.prepare(sql).run(...params)
      return {
        changes: result.changes,
        lastInsertRowId: Number(result.lastInsertRowid),
      }
    },

    async execAsync(sql: string): Promise<void> {
      db.exec(sql)
    },

    async withTransactionAsync(fn: () => Promise<void>): Promise<void> {
      db.exec('BEGIN')
      try {
        await fn()
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },

    close() {
      db.close()
    },
  }
}

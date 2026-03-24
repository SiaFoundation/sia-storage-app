import type {
  DatabaseAdapter,
  SQLParam,
  SQLRunResult,
} from '@siastorage/core/adapters'
import { logger } from '@siastorage/logger'
import sqlite3 from 'better-sqlite3'

const SLOW_QUERY_THRESHOLD = 500

function logSlowQuery(method: string, sql: string, start: number) {
  const duration = performance.now() - start
  if (duration > SLOW_QUERY_THRESHOLD) {
    logger.warn('db', 'slow_query', {
      method,
      duration: Math.round(duration),
      sql,
    })
  }
}

export function createBetterSqlite3Database(
  path = ':memory:',
): DatabaseAdapter & { close(): void } {
  const db = new sqlite3(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  return {
    async getAllAsync<T>(sql: string, ...params: SQLParam[]): Promise<T[]> {
      const start = performance.now()
      const result = db.prepare(sql).all(...params) as T[]
      logSlowQuery('getAllAsync', sql, start)
      return result
    },

    async getFirstAsync<T>(
      sql: string,
      ...params: SQLParam[]
    ): Promise<T | null> {
      const start = performance.now()
      const result = (db.prepare(sql).get(...params) as T) ?? null
      logSlowQuery('getFirstAsync', sql, start)
      return result
    },

    async runAsync(sql: string, ...params: SQLParam[]): Promise<SQLRunResult> {
      const start = performance.now()
      const result = db.prepare(sql).run(...params)
      logSlowQuery('runAsync', sql, start)
      return {
        changes: result.changes,
        lastInsertRowId: Number(result.lastInsertRowid),
      }
    },

    async execAsync(sql: string): Promise<void> {
      const start = performance.now()
      db.exec(sql)
      logSlowQuery('execAsync', sql, start)
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

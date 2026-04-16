import type { DatabaseAdapter, SQLParam, SQLRunResult } from '@siastorage/core/adapters'
import { logger } from '@siastorage/logger'
import { Database } from 'bun:sqlite'

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

export function createBunDatabase(path = ':memory:'): DatabaseAdapter {
  const db = new Database(path)
  db.exec('PRAGMA journal_mode = WAL')
  // synchronous = NORMAL moves fsync out of the per-commit path; durability
  // cost only applies to full OS crashes, which sync-down recovers from.
  db.exec('PRAGMA synchronous = NORMAL')
  // Bound the WAL at ~2MB so a long-running daemon doesn't accumulate disk.
  db.exec('PRAGMA wal_autocheckpoint = 500')
  // Wait up to 5s on lock contention before returning SQLITE_BUSY, so CLI
  // clients connecting mid-write don't fail spuriously.
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA foreign_keys = ON')

  return {
    async getAllAsync<T>(sql: string, ...params: SQLParam[]): Promise<T[]> {
      const start = performance.now()
      const result = db.prepare(sql).all(...params) as T[]
      logSlowQuery('getAllAsync', sql, start)
      return result
    },

    async getFirstAsync<T>(sql: string, ...params: SQLParam[]): Promise<T | null> {
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

    /**
     * Refresh query planner stats and truncate the WAL. Call before `close()`
     * on graceful shutdown so the next start opens a clean, optimized database.
     */
    async finalize(): Promise<void> {
      db.exec('PRAGMA optimize')
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    },

    close() {
      db.close()
    },
  }
}

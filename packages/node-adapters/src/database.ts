import type { DatabaseAdapter } from '@siastorage/core/adapters'
import sqlite3 from 'better-sqlite3'
import { createGatedAdapter } from './transactionGate'

export function createBetterSqlite3Database(path = ':memory:'): DatabaseAdapter {
  const db = new sqlite3(path)
  db.pragma('journal_mode = WAL')
  // synchronous = NORMAL moves fsync out of the per-commit path; durability
  // cost only applies to full OS crashes, which sync-down recovers from.
  db.pragma('synchronous = NORMAL')
  // Bound the WAL at ~2MB so a long-running daemon doesn't accumulate disk.
  db.pragma('wal_autocheckpoint = 500')
  // Wait up to 5s on lock contention before returning SQLITE_BUSY, so CLI
  // clients connecting mid-write don't fail spuriously.
  db.pragma('busy_timeout = 5000')
  db.pragma('foreign_keys = ON')

  const { retire, ...adapter } = createGatedAdapter({
    all: (sql, params) => db.prepare(sql).all(...params),
    get: (sql, params) => db.prepare(sql).get(...params),
    run: (sql, params) => {
      const result = db.prepare(sql).run(...params)
      return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) }
    },
    exec: (sql) => db.exec(sql),
  })

  return {
    ...adapter,

    /**
     * Refresh query planner stats and truncate the WAL. Call before `close()`
     * on graceful shutdown so the next start opens a clean, optimized database.
     * Shutdown does not wait for a provider call already running, and closing
     * under its open transaction would roll it back, so this waits for that
     * transaction and lets no other start.
     */
    async finalize(): Promise<void> {
      await retire()
      db.exec('PRAGMA optimize')
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    },

    close() {
      db.close()
    },
  }
}

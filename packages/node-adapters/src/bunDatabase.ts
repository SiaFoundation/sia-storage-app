import type { DatabaseAdapter } from '@siastorage/core/adapters'
import { Database } from 'bun:sqlite'
import { createGatedAdapter } from './transactionGate'

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

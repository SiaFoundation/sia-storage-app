/**
 * Reads a SQLite database that another process writes, such as a CLI daemon's
 * or the app's in an iOS simulator, whose container is a folder on this Mac.
 * Every read sim makes of a device's database goes through here.
 *
 * The connection is read-only, because a read-write one that closes last
 * checkpoints the WAL into the database file, and a read between a kill and
 * a relaunch would then do the recovery the scenario meant the app to do. A
 * read-only connection sees the WAL too, and waits out the writer's
 * checkpoint instead of failing with "database is locked".
 *
 * SQLite can still refuse a read-only read of a WAL a writer left mid-write,
 * with "attempt to write a readonly database". The writer is gone then, so
 * the database and its WAL are copied and the copy is read, which leaves the
 * device's files as the app left them.
 */
import { Database } from 'bun:sqlite'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BUSY_TIMEOUT_MS = 5000

export function readDatabase<T>(path: string, sql: string, params: unknown[] = []): T[] {
  try {
    return query<T>(new Database(path, { readonly: true }), sql, params)
  } catch (e) {
    if (!(e instanceof Error) || !/readonly database/.test(e.message)) throw e
    return readCopy<T>(path, sql, params)
  }
}

/** Reads a copy of the database and its WAL, taken while nothing writes them. */
export function readCopy<T>(path: string, sql: string, params: unknown[] = []): T[] {
  const dir = mkdtempSync(join(tmpdir(), 'sim-db-'))
  try {
    const copy = join(dir, 'copy.db')
    copyFileSync(path, copy)
    if (existsSync(`${path}-wal`)) copyFileSync(`${path}-wal`, `${copy}-wal`)
    return query<T>(new Database(copy), sql, params)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function query<T>(db: Database, sql: string, params: unknown[]): T[] {
  try {
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
    db.exec('PRAGMA query_only = 1')
    return db.query(sql).all(...(params as never[])) as T[]
  } finally {
    db.close()
  }
}

import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readCopy, readDatabase } from '../src/sqlite'

describe('readDatabase', () => {
  const dirs: string[] = []
  const dir = () => {
    const d = mkdtempSync(join(tmpdir(), 'sim-sqlite-'))
    dirs.push(d)
    return d
  }
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  /** A WAL database whose rows are only in its WAL, as a writer killed before a checkpoint leaves it. */
  function killedWriter(): string {
    const live = join(dir(), 'app.db')
    const writer = new Database(live)
    writer.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0')
    writer.exec('CREATE TABLE t (x); INSERT INTO t VALUES (1), (2)')
    const left = join(dir(), 'app.db')
    copyFileSync(live, left)
    copyFileSync(`${live}-wal`, `${left}-wal`)
    writer.close()
    return left
  }

  test('reads the rows a killed writer left only in its WAL', () => {
    const path = killedWriter()
    expect(readDatabase<{ x: number }>(path, 'SELECT x FROM t ORDER BY x')).toEqual([
      { x: 1 },
      { x: 2 },
    ])
  })

  const files = (path: string) =>
    [path, `${path}-wal`].map((f) => (existsSync(f) ? readFileSync(f).toString('hex') : null))

  test('leaves the database and its WAL as the killed writer left them', () => {
    const path = killedWriter()
    const before = files(path)
    readDatabase(path, 'SELECT x FROM t')
    expect(files(path)).toEqual(before)
  })

  test("a copy reads the WAL's rows and leaves the original as it was", () => {
    const path = killedWriter()
    const before = files(path)
    expect(readCopy<{ n: number }>(path, 'SELECT count(*) AS n FROM t')).toEqual([{ n: 2 }])
    expect(files(path)).toEqual(before)
  })

  test('refuses a write', () => {
    expect(() => readDatabase(killedWriter(), 'INSERT INTO t VALUES (3)')).toThrow(/readonly/)
  })

  test('fails on a missing file and does not create it', () => {
    const path = join(dir(), 'missing.db')
    expect(() => readDatabase(path, 'SELECT 1')).toThrow()
    expect(existsSync(path)).toBe(false)
  })
})

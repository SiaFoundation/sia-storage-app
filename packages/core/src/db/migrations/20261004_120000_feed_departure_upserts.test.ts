import { createBetterSqlite3Database } from '@siastorage/node-adapters/database'
import { runMigrations } from '..'
import { coreMigrations, sortMigrations } from '.'
import { migration_20261004_120000_feed_departure_upserts } from './20261004_120000_feed_departure_upserts'

/**
 * A library in the state that stuck sync-down: a folder holding two trashed
 * versions of one file, which deleting the folder clears both of.
 */
async function libraryWithTwoVersionsInAFolder() {
  const db = createBetterSqlite3Database()
  await runMigrations(
    db,
    sortMigrations(coreMigrations).filter(
      (m) => m.id !== migration_20261004_120000_feed_departure_upserts.id,
    ),
  )
  await db.runAsync(
    `INSERT INTO directories (id, path, createdAt, nameSortKey, parentId) VALUES ('d', 'Trips', 1, 'trips', NULL)`,
  )
  for (const [id, updatedAt] of [
    ['v1', 1],
    ['v2', 2],
  ] as const) {
    await db.runAsync(
      `INSERT INTO files (id, name, size, type, kind, createdAt, updatedAt, addedAt, hash, directoryId, stackId, trashedAt)
       VALUES (?, 'notes.txt', 1, 'text/plain', 'file', 1, ?, 1, 'sha256:h', 'd', 's', 5)`,
      id,
      updatedAt,
    )
  }
  return db
}

it('a folder holding two versions of one file could not be deleted, and can once this runs', async () => {
  const db = await libraryWithTwoVersionsInAFolder()
  // Compared by message: better-sqlite3 builds its errors from the class of
  // the first test file to load it, which Jest's rejects.toThrow does not
  // recognise as an Error in any later file.
  const failure = await db.runAsync(`DELETE FROM directories WHERE id = 'd'`).then(
    () => null,
    (e: { message?: string }) => e.message ?? String(e),
  )
  expect(failure).toBe('UNIQUE constraint failed: feed_departures.id, feed_departures.parentId')

  await migration_20261004_120000_feed_departure_upserts.up(db)
  await db.runAsync(`DELETE FROM directories WHERE id = 'd'`)

  expect(
    await db.getAllAsync('SELECT id, kind, parentId, reason FROM feed_departures ORDER BY kind'),
  ).toEqual([
    { id: 'd', kind: 'dir', parentId: '', reason: 'deleted' },
    { id: 's', kind: 'file', parentId: 'd', reason: 'moved' },
  ])
})

it('no trigger writes a departure in a way a firing statement can override', async () => {
  const db = createBetterSqlite3Database()
  await runMigrations(db, sortMigrations(coreMigrations))
  const triggers = await db.getAllAsync<{ name: string; sql: string }>(
    `SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND sql LIKE '%feed_departures%'`,
  )
  expect(triggers.map((t) => t.name).sort()).toEqual([
    'trg_directories_feed_delete',
    'trg_directories_feed_depart',
    'trg_files_feed_delete',
    'trg_files_feed_depart',
    'trg_files_stack_id_change',
  ])
  for (const { name, sql } of triggers) {
    expect({ name, replaces: /\bOR\s+REPLACE\b/i.test(sql) }).toEqual({ name, replaces: false })
    expect({ name, upserts: /ON CONFLICT \(id, parentId\) DO UPDATE/.test(sql) }).toEqual({
      name,
      upserts: true,
    })
  }
})

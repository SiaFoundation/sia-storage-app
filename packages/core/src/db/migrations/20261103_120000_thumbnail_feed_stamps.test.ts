import { createBetterSqlite3Database } from '@siastorage/node-adapters/database'
import type { DatabaseAdapter } from '../../adapters/db'
import { runMigrations } from '..'
import { coreMigrations, sortMigrations } from '.'
import { migration_20261103_120000_thumbnail_feed_stamps } from './20261103_120000_thumbnail_feed_stamps'

async function insertFile(db: DatabaseAdapter, id: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO files (id, name, size, type, kind, createdAt, updatedAt, addedAt, hash)
     VALUES (?, ?, 1, 'image/jpeg', 'file', 1, 1, 1, 'sha256:h')`,
    id,
    `${id}.jpg`,
  )
}

async function insertThumb(
  db: DatabaseAdapter,
  id: string,
  forId: string,
  size: number,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO files (id, name, size, type, kind, createdAt, updatedAt, addedAt, hash, thumbForId, thumbSize)
     VALUES (?, ?, 1, 'image/webp', 'thumb', 1, 1, 1, 'sha256:t', ?, ?)`,
    id,
    `${id}.webp`,
    forId,
    size,
  )
}

async function feedSeq(db: DatabaseAdapter, id: string): Promise<number> {
  return (await db.getFirstAsync<{ feedSeq: number }>(
    'SELECT feedSeq FROM files WHERE id = ?',
    id,
  ))!.feedSeq
}

async function migrated(): Promise<DatabaseAdapter> {
  const db = createBetterSqlite3Database()
  await runMigrations(db, sortMigrations(coreMigrations))
  return db
}

it('leaves the file alone when its thumbnail row arrives without its bytes', async () => {
  const db = await migrated()
  await insertFile(db, 'a')
  const before = await feedSeq(db, 'a')

  await insertThumb(db, 't512', 'a', 512)

  expect(await feedSeq(db, 'a')).toBe(before)
})

it('re-stamps a file each time its 512px thumbnail is recorded on disk', async () => {
  const db = await migrated()
  await insertFile(db, 'a')
  await insertThumb(db, 't512', 'a', 512)
  const before = await feedSeq(db, 'a')

  await db.runAsync(
    `INSERT OR REPLACE INTO fs (fileId, size, addedAt, usedAt) VALUES ('t512', 1, 1, 1)`,
  )
  const afterFirst = await feedSeq(db, 'a')
  await db.runAsync(
    `INSERT OR REPLACE INTO fs (fileId, size, addedAt, usedAt) VALUES ('t512', 1, 2, 2)`,
  )

  expect(afterFirst).toBeGreaterThan(before)
  expect(await feedSeq(db, 'a')).toBeGreaterThan(afterFirst)
})

it('leaves the file alone when its own bytes are recorded on disk', async () => {
  const db = await migrated()
  await insertFile(db, 'a')
  const before = await feedSeq(db, 'a')

  await db.runAsync(`INSERT INTO fs (fileId, size, addedAt, usedAt) VALUES ('a', 1, 1, 1)`)

  expect(await feedSeq(db, 'a')).toBe(before)
})

it('re-stamps every file whose 512px thumbnail is already on disk on upgrade', async () => {
  const db = createBetterSqlite3Database()
  await runMigrations(
    db,
    sortMigrations(coreMigrations).filter(
      (m) => m.id !== migration_20261103_120000_thumbnail_feed_stamps.id,
    ),
  )
  for (const id of ['a', 'b', 'c']) await insertFile(db, id)
  await insertThumb(db, 'ta', 'a', 512)
  await insertThumb(db, 'tb', 'b', 512)
  await insertThumb(db, 'tc', 'c', 64)
  for (const id of ['ta', 'tc']) {
    await db.runAsync(`INSERT INTO fs (fileId, size, addedAt, usedAt) VALUES (?, 1, 1, 1)`, id)
  }
  const anchor = (await db.getFirstAsync<{ seq: number }>(
    'SELECT seq FROM feed_meta WHERE id = 1',
  ))!.seq

  await migration_20261103_120000_thumbnail_feed_stamps.up(db)

  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM files WHERE kind = 'file' AND feedSeq > ? ORDER BY id`,
    anchor,
  )
  expect(rows.map((r) => r.id)).toEqual(['a'])
})

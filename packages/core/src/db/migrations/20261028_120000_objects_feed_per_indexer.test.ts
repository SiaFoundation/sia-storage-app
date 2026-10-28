import { createBetterSqlite3Database } from '@siastorage/node-adapters/database'
import { runMigrations } from '..'
import { coreMigrations, sortMigrations } from '.'
import { migration_20261028_120000_objects_feed_per_indexer } from './20261028_120000_objects_feed_per_indexer'

it('re-stamps every file past an anchor taken before the upgrade, so Finder re-reads its upload state', async () => {
  const db = createBetterSqlite3Database()
  await runMigrations(
    db,
    sortMigrations(coreMigrations).filter(
      (m) => m.id !== migration_20261028_120000_objects_feed_per_indexer.id,
    ),
  )
  for (const id of ['a', 'b']) {
    await db.runAsync(
      `INSERT INTO files (id, name, size, type, kind, createdAt, updatedAt, addedAt, hash)
       VALUES (?, ?, 1, 'text/plain', 'file', 1, 1, 1, 'sha256:h')`,
      id,
      `${id}.txt`,
    )
  }
  const anchor = (await db.getFirstAsync<{ seq: number }>(
    'SELECT seq FROM feed_meta WHERE id = 1',
  ))!.seq

  await migration_20261028_120000_objects_feed_per_indexer.up(db)

  const rows = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM files WHERE feedSeq > ? ORDER BY id',
    anchor,
  )
  expect(rows.map((r) => r.id)).toEqual(['a', 'b'])
})

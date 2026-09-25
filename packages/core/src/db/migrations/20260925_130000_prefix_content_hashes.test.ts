import { createBetterSqlite3Database } from '@siastorage/node-adapters/database'
import { runMigrations } from '..'
import { coreMigrations, sortMigrations } from '.'
import { migration_20260925_130000_prefix_content_hashes } from './20260925_130000_prefix_content_hashes'

it('prefixes bare hex hashes and leaves every other hash alone', async () => {
  const db = createBetterSqlite3Database()
  await runMigrations(
    db,
    sortMigrations(coreMigrations).filter(
      (m) => m.id !== migration_20260925_130000_prefix_content_hashes.id,
    ),
  )
  const bare = 'AB'.repeat(32)
  const rows = [
    ['bare', bare],
    ['prefixed', `sha256:${'cd'.repeat(32)}`],
    ['other', 'x'.repeat(64)],
  ]
  for (const [id, hash] of rows) {
    await db.runAsync(
      `INSERT INTO files (id, name, size, type, kind, createdAt, updatedAt, addedAt, hash)
       VALUES (?, ?, 1, 'text/plain', 'file', 1, 1, 1, ?)`,
      id,
      `${id}.txt`,
      hash,
    )
  }

  await migration_20260925_130000_prefix_content_hashes.up(db)

  const hashes = Object.fromEntries(
    (await db.getAllAsync<{ id: string; hash: string }>('SELECT id, hash FROM files')).map((r) => [
      r.id,
      r.hash,
    ]),
  )
  expect(hashes).toEqual({
    bare: `sha256:${bare.toLowerCase()}`,
    prefixed: `sha256:${'cd'.repeat(32)}`,
    other: 'x'.repeat(64),
  })
  db.close?.()
})

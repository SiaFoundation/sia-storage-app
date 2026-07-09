import { createBetterSqlite3Database } from '@siastorage/node-adapters/database'
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import type { DatabaseAdapter } from '../../adapters/db'
import { migration_0001_init_schema } from './0001_init_schema'
import { migration_0003_create_imports } from './0003_create_imports'

// Seed a `files` row with raw SQL so we control hash/current/localId precisely.
async function insertFileRow(
  db: DatabaseAdapter,
  r: {
    id: string
    name: string
    hash: string
    directoryId: string | null
    current: number
    updatedAt: number
    localId?: string | null
    lostReason?: string | null
    trashedAt?: number | null
    deletedAt?: number | null
  },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO files (id, localId, addedAt, name, size, type, kind, createdAt, updatedAt, hash,
                        directoryId, lostReason, current, trashedAt, deletedAt)
     VALUES (?, ?, ?, ?, 0, 'image/jpeg', 'file', ?, ?, ?, ?, ?, ?, ?, ?)`,
    r.id,
    r.localId ?? null,
    1,
    r.name,
    1,
    r.updatedAt,
    r.hash,
    r.directoryId,
    r.lostReason ?? null,
    r.current,
    r.trashedAt ?? null,
    r.deletedAt ?? null,
  )
}

describe('migration 0003_create_imports', () => {
  let db: DatabaseAdapter

  beforeEach(async () => {
    db = createBetterSqlite3Database()
    await db.withTransactionAsync(() => migration_0001_init_schema.up(db))
  })

  afterEach(() => {
    db.close?.()
  })

  async function runMigration() {
    await db.withTransactionAsync(() => migration_0003_create_imports.up(db))
  }

  it('creates no legacy import when nothing is left to adopt', async () => {
    // A fresh install, or any device whose imports all finalized, has no hash=''
    // placeholders. The synthetic 'legacy' import must not exist, or the imports
    // history would open with an empty "imported before this update" row.
    await insertFileRow(db, {
      id: 'real',
      name: 'a.jpg',
      hash: 'abc',
      directoryId: null,
      current: 1,
      updatedAt: 100,
    })

    await runMigration()

    const legacy = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM imports WHERE id='legacy'`,
    )
    expect(legacy).toBeNull()
    const adopted = await db.getAllAsync<{ id: string }>(`SELECT id FROM import_files`)
    expect(adopted).toEqual([])
  })

  it('leaves trashed and deleted placeholder tombstones in files, unadopted', async () => {
    await insertFileRow(db, {
      id: 'tr',
      name: 'a.jpg',
      hash: '',
      directoryId: null,
      current: 0,
      updatedAt: 100,
      trashedAt: 150,
    })
    await insertFileRow(db, {
      id: 'de',
      name: 'b.jpg',
      hash: '',
      directoryId: null,
      current: 0,
      updatedAt: 100,
      deletedAt: 150,
    })

    await runMigration()

    const adopted = await db.getAllAsync<{ id: string }>(`SELECT id FROM import_files`)
    expect(adopted).toEqual([])
    const rows = await db.getAllAsync<{ id: string }>(`SELECT id FROM files ORDER BY id`)
    expect(rows.map((r) => r.id)).toEqual(['de', 'tr'])
  })

  it('moves a placeholder shadowing a FILED sibling and restores the sibling to current=1', async () => {
    // files.directoryId has a FK to directories, so create the destination dir first.
    await db.runAsync(`INSERT INTO directories (id, path, createdAt) VALUES ('d1', '/d1', 1)`)
    // Placeholder (hash='') won current=1 and demoted its real sibling to current=0.
    await insertFileRow(db, {
      id: 'sib',
      name: 'a.jpg',
      hash: 'abc',
      directoryId: 'd1',
      current: 0,
      updatedAt: 100,
    })
    await insertFileRow(db, {
      id: 'ph',
      name: 'a.jpg',
      hash: '',
      directoryId: 'd1',
      current: 1,
      updatedAt: 200,
      localId: 'asset1',
    })

    await runMigration()

    // Placeholder removed from files, adopted into import_files as pending under 'legacy'.
    const ph = await db.getFirstAsync<{ id: string }>(`SELECT id FROM files WHERE id='ph'`)
    expect(ph).toBeNull()
    const child = await db.getFirstAsync<{ state: string; importId: string; mediaAssetId: string }>(
      `SELECT state, importId, mediaAssetId FROM import_files WHERE id='ph'`,
    )
    expect(child).toEqual({ state: 'pending', importId: 'legacy', mediaAssetId: 'asset1' })

    // The synthetic import that adopts every placeholder. Sealed, because nothing
    // more is ever added to it.
    const legacy = await db.getFirstAsync<{ source: string; sealed: number }>(
      `SELECT source, sealed FROM imports WHERE id='legacy'`,
    )
    expect(legacy).toEqual({ source: 'legacy', sealed: 1 })

    // Sibling restored to current=1 (never two current=1 in the group).
    const sib = await db.getFirstAsync<{ current: number }>(
      `SELECT current FROM files WHERE id='sib'`,
    )
    expect(sib?.current).toBe(1)
    const winners = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM files WHERE name='a.jpg' AND directoryId='d1' AND current=1`,
    )
    expect(winners.map((w) => w.id)).toEqual(['sib'])
  })

  it('restores an UNFILED (directoryId IS NULL) sibling via null-safe comparison', async () => {
    await insertFileRow(db, {
      id: 'sib2',
      name: 'b.jpg',
      hash: 'def',
      directoryId: null,
      current: 0,
      updatedAt: 100,
    })
    await insertFileRow(db, {
      id: 'ph2',
      name: 'b.jpg',
      hash: '',
      directoryId: null,
      current: 1,
      updatedAt: 200,
      localId: 'asset2',
    })
    await insertFileRow(db, {
      id: 'ph2b',
      name: 'b.jpg',
      hash: '',
      directoryId: null,
      current: 0,
      updatedAt: 300,
      localId: 'asset2b',
    })

    await runMigration()

    const sib2 = await db.getFirstAsync<{ current: number }>(
      `SELECT current FROM files WHERE id='sib2'`,
    )
    expect(sib2?.current).toBe(1) // would stay 0 if the recalculation used a non-null-safe `=` comparison
    const remaining = await db.getAllAsync<{ id: string }>(`SELECT id FROM files ORDER BY id`)
    expect(remaining.map((r) => r.id)).toEqual(['sib2'])
    const adopted = await db.getAllAsync<{ id: string }>(`SELECT id FROM import_files ORDER BY id`)
    expect(adopted.map((r) => r.id)).toEqual(['ph2', 'ph2b'])
  })

  it('leaves a group with no placeholder untouched (current recalculation is scoped)', async () => {
    // Guards the scope of the current recalculation: it must only touch groups a
    // placeholder vacated. `keep` is the current row of a group with no placeholder, and
    // it is deliberately NOT the newest in its group. The migration must leave it alone;
    // a recalculation that ignored scope would demote it and hand current to `newer`.
    await insertFileRow(db, {
      id: 'keep',
      name: 'z.jpg',
      hash: 'z1',
      directoryId: null,
      current: 1,
      updatedAt: 100,
    })
    await insertFileRow(db, {
      id: 'newer',
      name: 'z.jpg',
      hash: 'z2',
      directoryId: null,
      current: 0,
      updatedAt: 300,
    })
    // A placeholder in a different group, so the recalculation step actually runs.
    await insertFileRow(db, {
      id: 'ph3',
      name: 'y.jpg',
      hash: '',
      directoryId: null,
      current: 1,
      updatedAt: 200,
      localId: 'asset5',
    })

    await runMigration()

    const keep = await db.getFirstAsync<{ current: number }>(
      `SELECT current FROM files WHERE id='keep'`,
    )
    const newer = await db.getFirstAsync<{ current: number }>(
      `SELECT current FROM files WHERE id='newer'`,
    )
    expect(keep?.current).toBe(1)
    expect(newer?.current).toBe(0)
  })

  it('carries localId into a non-unique mediaAssetId on finalized files', async () => {
    await insertFileRow(db, {
      id: 'final',
      name: 'd.jpg',
      hash: 'xyz',
      directoryId: null,
      current: 1,
      updatedAt: 100,
      localId: 'asset4',
    })

    await runMigration()

    const f = await db.getFirstAsync<{ mediaAssetId: string }>(
      `SELECT mediaAssetId FROM files WHERE id='final'`,
    )
    expect(f?.mediaAssetId).toBe('asset4')

    // mediaAssetId is non-unique: two finalized files may share one (no constraint).
    await insertFileRow(db, {
      id: 'dup',
      name: 'e.jpg',
      hash: 'qrs',
      directoryId: null,
      current: 1,
      updatedAt: 100,
    })
    await expect(
      db.runAsync(`UPDATE files SET mediaAssetId='asset4' WHERE id='dup'`),
    ).resolves.toBeTruthy()
  })

  it('adopts a mixed backlog wholesale: every placeholder moves, real files stay', async () => {
    // A placeholder with no localId was a share or camera import that never
    // finished: no library asset to re-resolve, so it re-drives as ephemeral.
    await db.runAsync(`INSERT INTO directories (id, path, createdAt) VALUES ('d', '/d', 1)`)
    await insertFileRow(db, {
      id: 'p-media',
      name: 'a.jpg',
      hash: '',
      directoryId: 'd',
      current: 0,
      updatedAt: 10,
      localId: 'm1',
    })
    await insertFileRow(db, {
      id: 'p-eph',
      name: 'b.jpg',
      hash: '',
      directoryId: 'd',
      current: 0,
      updatedAt: 20,
    })
    await insertFileRow(db, {
      id: 'p-lost',
      name: 'c.jpg',
      hash: '',
      directoryId: 'd',
      current: 0,
      updatedAt: 30,
      localId: 'm2',
      lostReason: 'session-expired',
    })
    await insertFileRow(db, {
      id: 'real',
      name: 'z.jpg',
      hash: 'abc',
      directoryId: 'd',
      current: 1,
      updatedAt: 40,
      localId: 'm3',
    })

    await runMigration()

    const adopted = await db.getAllAsync<{
      id: string
      state: string
      sourceKind: string
      reason: string | null
    }>(`SELECT id, state, sourceKind, reason FROM import_files ORDER BY id`)
    expect(adopted).toEqual([
      { id: 'p-eph', state: 'pending', sourceKind: 'ephemeral', reason: null },
      { id: 'p-lost', state: 'unavailable', sourceKind: 'media', reason: 'session-expired' },
      { id: 'p-media', state: 'pending', sourceKind: 'media', reason: null },
    ])
    const remaining = await db.getAllAsync<{ id: string }>(`SELECT id FROM files ORDER BY id`)
    expect(remaining.map((r) => r.id)).toEqual(['real'])
  })
})

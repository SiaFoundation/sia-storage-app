/*
 * files.stackId, the id of a file across its versions: every live row of a
 * stack carries one, no two stacks share one, and a new version keeps its
 * stack's. Checked on the triggers and the currency recalculation, then
 * over random sequences of the operations that create, merge, split and
 * empty stacks.
 */
import { createBetterSqlite3Database } from '@siastorage/node-adapters/database'
import { runMigrations } from '..'
import { coreMigrations, sortMigrations } from '../migrations'
import { insertDirectory } from './directories'
import {
  insertFile,
  insertNextVersion,
  moveAllFileVersions,
  recalculateCurrentForFileIds,
  recalculateCurrentForGroups,
  renameAllFileVersions,
  updateFile,
} from './files'
import { deleteObject, insertObject, upsertManyObjects } from './localObjects'
import { db, setupTestDb, teardownTestDb } from './test-setup'
import {
  restoreFilesAndThumbnails,
  tombstoneFilesAndThumbnails,
  trashFilesAndThumbnails,
} from './trash'

beforeEach(setupTestDb)
afterEach(teardownTestDb)

async function file(
  id: string,
  opts: { name?: string; updatedAt?: number; directoryId?: string | null; trashedAt?: number } = {},
): Promise<void> {
  await insertFile(
    db(),
    {
      id,
      name: opts.name ?? `${id}.txt`,
      type: 'text/plain',
      kind: 'file',
      size: 10,
      hash: `sha256:hash-${id}`,
      createdAt: 1000,
      updatedAt: opts.updatedAt ?? 1000,
      mediaAssetId: null,
      addedAt: 1000,
      trashedAt: opts.trashedAt ?? null,
      deletedAt: null,
    },
    { directoryId: opts.directoryId ?? null },
  )
}

async function stackIdsOf(...ids: string[]): Promise<(string | null)[]> {
  return Promise.all(
    ids.map(async (id) => {
      const row = await db().getFirstAsync<{ stackId: string | null }>(
        'SELECT stackId FROM files WHERE id = ?',
        id,
      )
      return row?.stackId ?? null
    }),
  )
}

async function feedSeqOf(id: string): Promise<number> {
  const row = await db().getFirstAsync<{ feedSeq: number }>(
    'SELECT feedSeq FROM files WHERE id = ?',
    id,
  )
  return row?.feedSeq ?? -1
}

async function ledger(): Promise<{ id: string; parentId: string; reason: string }[]> {
  return db().getAllAsync('SELECT id, parentId, reason FROM feed_departures ORDER BY feedSeq')
}

function object(fileId: string, id: string) {
  const empty = new ArrayBuffer(2)
  return {
    fileId,
    indexerURL: 'https://idx.example.com',
    id,
    slabs: [],
    encryptedDataKey: empty,
    encryptedMetadataKey: empty,
    encryptedMetadata: empty,
    dataSignature: empty,
    metadataSignature: empty,
    createdAt: new Date(1000),
    updatedAt: new Date(1000),
  }
}

it('upgrading a library that ran the feed migration gives every live version its stack’s current row id', async () => {
  const fresh = createBetterSqlite3Database()
  const stackIds = '20260925_120000_file_stack_id'
  await runMigrations(fresh, sortMigrations(coreMigrations.filter((m) => m.id !== stackIds)))
  const insert = (id: string, current: number, extra: string, value: string | number | null) =>
    fresh.runAsync(
      `INSERT INTO files (id, name, size, type, kind, createdAt, updatedAt, hash, addedAt,
                          current, ${extra})
       VALUES (?, 'a.txt', 1, 'text/plain', ?, 1, 1, 'h', 1, ?, ?)`,
      id,
      extra === 'thumbForId' ? 'thumb' : 'file',
      current,
      value,
    )
  await insert('cur', 1, 'directoryId', null)
  await insert('old', 0, 'directoryId', null)
  await insert('binned', 0, 'trashedAt', 5)
  await insert('thumb', 1, 'thumbForId', 'cur')

  await runMigrations(fresh, sortMigrations(coreMigrations))

  expect(await fresh.getAllAsync('SELECT id, stackId FROM files ORDER BY id')).toEqual([
    { id: 'binned', stackId: 'binned' },
    { id: 'cur', stackId: 'cur' },
    { id: 'old', stackId: 'cur' },
    { id: 'thumb', stackId: null },
  ])
  // The feed migration's departure trigger recorded a row's own id. The
  // upgrade recreates it to record the stack id the shell names files by.
  await fresh.runAsync(`DELETE FROM files WHERE id = 'old'`)
  expect(await fresh.getAllAsync(`SELECT id, reason FROM feed_departures`)).toEqual([
    { id: 'cur', reason: 'deleted' },
  ])
  fresh.close?.()
})

it('a new row joins the stack at its name, and names itself when the name is free or it is trashed', async () => {
  await file('a', { name: 'doc.txt', updatedAt: 1000 })
  await file('b', { name: 'doc.txt', updatedAt: 2000 })
  await file('c', { name: 'other.txt' })
  await file('d', { name: 'doc.txt', trashedAt: 5 })

  expect(await stackIdsOf('a', 'b', 'c', 'd')).toEqual(['a', 'a', 'c', 'd'])
})

describe('a saved version', () => {
  it('becomes current under the stack’s id, with the replaced row’s tags and a local copy', async () => {
    await file('a', { updatedAt: Date.now() + 60_000 })
    await db().runAsync(`INSERT INTO file_tags (fileId, tagId) VALUES ('a', 'sys:favorites')`)

    expect(await insertNextVersion(db(), 'a', { id: 'n', size: 3, hash: 'sha256:h-n' })).toBe(
      'added',
    )

    expect(await db().getAllAsync(`SELECT id, current, stackId FROM files ORDER BY id`)).toEqual([
      { id: 'a', current: 0, stackId: 'a' },
      { id: 'n', current: 1, stackId: 'a' },
    ])
    expect(await db().getAllAsync(`SELECT tagId FROM file_tags WHERE fileId = 'n'`)).toEqual([
      { tagId: 'sys:favorites' },
    ])
    expect(await db().getFirstAsync(`SELECT size FROM fs WHERE fileId = 'n'`)).toEqual({ size: 3 })
  })

  it('is refused for a file that is no longer live', async () => {
    await file('a', { trashedAt: 5 })

    expect(await insertNextVersion(db(), 'a', { id: 'n', size: 3, hash: 'sha256:h' })).toBe(
      'missing',
    )
    expect(await db().getFirstAsync(`SELECT id FROM files WHERE id = 'n'`)).toBeNull()
  })

  it('is not added when the stack’s newest version already holds the same bytes', async () => {
    await file('a')
    // Another device's newer version of a.txt, carrying the bytes being saved.
    await file('b', { name: 'a.txt', updatedAt: Date.now() + 60_000 })

    expect(await insertNextVersion(db(), 'a', { id: 'n', size: 3, hash: 'sha256:hash-b' })).toBe(
      'unchanged',
    )
    expect(await db().getFirstAsync(`SELECT id FROM files WHERE id = 'n'`)).toBeNull()
  })
})

describe('the upload-state triggers', () => {
  it('re-stamp a file when its first object arrives, and not for later ones', async () => {
    await file('a')
    const created = await feedSeqOf('a')

    await insertObject(db(), object('a', 'o1'))
    const uploaded = await feedSeqOf('a')
    await upsertManyObjects(db(), [object('a', 'o2'), object('a', 'o1')])

    expect(uploaded).toBeGreaterThan(created)
    expect(await feedSeqOf('a')).toBe(uploaded)
  })

  it('re-stamp a file when its last object goes, and not before', async () => {
    await file('a')
    await upsertManyObjects(db(), [object('a', 'o1'), object('a', 'o2')])
    const both = await feedSeqOf('a')

    await deleteObject(db(), 'o1', 'https://idx.example.com')
    expect(await feedSeqOf('a')).toBe(both)
    await deleteObject(db(), 'o2', 'https://idx.example.com')
    expect(await feedSeqOf('a')).toBeGreaterThan(both)
  })
})

describe('stacks meeting and parting', () => {
  it('a merge keeps the newest row’s id and ledgers the other as deleted', async () => {
    await file('a', { name: 'a.txt', updatedAt: 1000 })
    await file('b', { name: 'b.txt', updatedAt: 2000 })
    const before = await feedSeqOf('b')

    // A rename stamps the renamed rows above every clock they had.
    await renameAllFileVersions(db(), 'a.txt', null, 'b.txt')

    expect(await stackIdsOf('a', 'b')).toEqual(['a', 'a'])
    expect(await feedSeqOf('b')).toBeGreaterThan(before)
    expect(await ledger()).toEqual([{ id: 'b', parentId: '', reason: 'deleted' }])
  })

  it('a moved stack is ledgered once, under its id, from the folder it left', async () => {
    const dir = await insertDirectory(db(), 'Docs')
    await file('a', { name: 'a.txt' })
    await insertNextVersion(db(), 'a', { id: 'n', size: 1, hash: 'sha256:h' })

    await moveAllFileVersions(db(), 'a.txt', null, dir.id)

    expect(await ledger()).toEqual([{ id: 'a', parentId: '', reason: 'moved' }])
  })

  it('a rename synced one version at a time keeps the id on the current version', async () => {
    await file('old', { name: 'a.txt', updatedAt: 1000 })
    await file('new', { name: 'a.txt', updatedAt: 2000 })
    const syncRename = async (id: string) => {
      // Sync-down's order: the batch's stacks, then the stack a rename left.
      await db().runAsync(`UPDATE files SET name = 'b.txt' WHERE id = ?`, id)
      await recalculateCurrentForFileIds(db(), [id])
      await recalculateCurrentForGroups(db(), [{ name: 'a.txt', directoryId: null }])
    }

    await syncRename('new')
    const [leftBehind] = await stackIdsOf('old')
    expect(await stackIdsOf('new')).toEqual(['old'])
    expect(leftBehind).not.toBe('old')

    await syncRename('old')
    expect(await stackIdsOf('old', 'new')).toEqual(['old', 'old'])
    expect(await ledger()).toEqual([{ id: leftBehind, parentId: '', reason: 'deleted' }])
  })

  it('a restored old version never takes the id of the file it came from', async () => {
    await file('v1', { name: 'a.txt', updatedAt: 1000 })
    await file('v2', { name: 'a.txt', updatedAt: 2000 })
    await trashFilesAndThumbnails(db(), ['v1'])
    await renameAllFileVersions(db(), 'a.txt', null, 'b.txt')

    await restoreFilesAndThumbnails(db(), ['v1'])

    const [restored, live] = await stackIdsOf('v1', 'v2')
    expect(live).toBe('v1')
    expect(restored).not.toBe('v1')
  })
})

/*
 * After every step, each stack has one current row and one id of its own, a
 * new version keeps its stack's id, and a rename synced into an empty name
 * keeps the id on the version the OS shows.
 */
describe('stack identity over random operations', () => {
  type Row = {
    id: string
    name: string
    directoryId: string | null
    stackId: string
    current: number
    trashedAt: number | null
    deletedAt: number | null
  }

  function rng(seed: number): () => number {
    let s = seed >>> 0
    return () => {
      s = (s + 0x6d2b79f5) >>> 0
      let t = Math.imul(s ^ (s >>> 15), s | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  function expectStacksWhole(label: string, live: Row[]): void {
    const stacks = new Map<string, Row[]>()
    for (const row of live) {
      const key = `${row.name}\0${row.directoryId ?? ''}`
      stacks.set(key, [...(stacks.get(key) ?? []), row])
    }
    const found = [...stacks.values()].map((rows) => ({
      ids: new Set(rows.map((r) => r.stackId)).size,
      current: rows.filter((r) => r.current === 1).length,
    }))
    const stackIds = [...stacks.values()].map((rows) => rows[0].stackId)
    expect({ label, found, shared: stackIds.length - new Set(stackIds).size }).toEqual({
      label,
      found: found.map(() => ({ ids: 1, current: 1 })),
      shared: 0,
    })
  }

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('holds for seed %i', async (seed) => {
    const random = rng(seed)
    const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)]
    const names = ['a.txt', 'b.txt', 'c.txt']
    const dirs = [
      null,
      (await insertDirectory(db(), 'One')).id,
      (await insertDirectory(db(), 'Two')).id,
    ]
    const rows = () =>
      db().getAllAsync<Row>(
        `SELECT id, name, directoryId, stackId, current, trashedAt, deletedAt
         FROM files WHERE kind = 'file'`,
      )
    let clock = 10_000
    let next = 0

    for (let step = 0; step < 150; step++) {
      const all = await rows()
      const live = all.filter((r) => r.trashedAt === null && r.deletedAt === null)
      const trashed = all.filter((r) => r.trashedAt !== null && r.deletedAt === null)
      clock += 1 + Math.floor(random() * 3)
      const op = live.length === 0 ? 0 : Math.floor(random() * 9)
      const target = pick(live)
      const label = `seed ${seed} step ${step} op ${op} on ${target?.id}`

      if (op === 0) {
        await file(`f${next++}`, { name: pick(names), directoryId: pick(dirs), updatedAt: clock })
      } else if (op === 1) {
        const id = `f${next++}`
        await insertNextVersion(db(), target.id, { id, size: 1, hash: `sha256:h-${id}` })
        expect({ label, id: (await stackIdsOf(id))[0] }).toEqual({ label, id: target.stackId })
      } else if (op === 2) {
        const name = pick(names)
        if (name !== target.name) {
          await renameAllFileVersions(db(), target.name, target.directoryId, name)
        }
      } else if (op === 3) {
        const dir = pick(dirs)
        if (dir !== target.directoryId) {
          await moveAllFileVersions(db(), target.name, target.directoryId, dir)
        }
      } else if (op === 4) {
        await updateFile(db(), { id: target.id, name: pick(names) }, { updatedAt: clock - 20 })
      } else if (op === 5) {
        await trashFilesAndThumbnails(db(), [target.id])
      } else if (op === 6 && trashed.length > 0) {
        await restoreFilesAndThumbnails(db(), [pick(trashed).id])
      } else if (op === 7) {
        await tombstoneFilesAndThumbnails(db(), [target.id])
      } else if (op === 8) {
        // Sync-down's shape: rewrite one row's name or folder, recalculate the
        // batch's stacks, then the stack the row left.
        const moved = random() < 0.5
        const name = moved ? target.name : pick(names)
        const dir = moved ? pick(dirs) : target.directoryId
        const intoEmpty = !live.some((r) => r.name === name && r.directoryId === dir)
        await db().runAsync(
          'UPDATE files SET name = ?, directoryId = ? WHERE id = ?',
          name,
          dir,
          target.id,
        )
        await recalculateCurrentForFileIds(db(), [target.id])
        await recalculateCurrentForGroups(db(), [target])
        if (target.current === 1 && intoEmpty) {
          expect({ label, id: (await stackIdsOf(target.id))[0] }).toEqual({
            label,
            id: target.stackId,
          })
        }
      }
      const after = await rows()
      expectStacksWhole(
        label,
        after.filter((r) => r.trashedAt === null && r.deletedAt === null),
      )
    }
  })
})

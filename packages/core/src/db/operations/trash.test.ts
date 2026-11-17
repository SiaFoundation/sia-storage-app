import type { DatabaseAdapter, SQLParam } from '../../adapters/db'
import { insertFile } from './files'
import { insertObject } from './localObjects'
import { db, setupTestDb, teardownTestDb } from './test-setup'
import { deleteDirectoryAndTrashFiles, getOrCreateDirectoryAtPath } from './directories'
import {
  autoPurgeOldTrashedFiles,
  queryTrashEntries,
  restoreTrashEntries,
  tombstoneFilesAndThumbnails,
  tombstoneTrashEntries,
  restoreFilesAndThumbnails,
  trashFilesAndThumbnails,
  trashOlderVersions,
} from './trash'
import { insertShareLink, insertShareLinkFile } from './shareLinks'

function makeFileRecord(id: string, overrides?: Record<string, any>) {
  return {
    id,
    name: `${id}.jpg`,
    type: 'image/jpeg',
    kind: 'file' as const,
    size: 100,
    hash: `sha256:hash-${id}` as const,
    createdAt: 1000,
    updatedAt: 1000,
    mediaAssetId: null,
    addedAt: 1000,
    trashedAt: null,
    deletedAt: null,
    ...overrides,
  }
}

function makeLocalObject(fileId: string, objectId: string) {
  return {
    fileId,
    indexerURL: 'https://idx.example.com',
    id: objectId,
    slabs: [],
    encryptedDataKey: new Uint8Array([1]).buffer,
    encryptedMetadataKey: new Uint8Array([1]).buffer,
    encryptedMetadata: new Uint8Array([1]).buffer,
    dataSignature: new Uint8Array([1]).buffer,
    metadataSignature: new Uint8Array([1]).buffer,
    createdAt: new Date(1000),
    updatedAt: new Date(1000),
  }
}

// Create an object for the file and clear its dirty flag (insertObject sets it),
// so a later assertion proves the mutation under test re-flagged the object.
async function createCleanObject(fileId: string, objectId: string) {
  await insertObject(db(), makeLocalObject(fileId, objectId))
  await db().runAsync('UPDATE objects SET needsSyncUp = 0 WHERE fileId = ?', fileId)
}

async function getFile(id: string) {
  return db().getFirstAsync<{
    trashedAt: number | null
    deletedAt: number | null
    updatedAt: number
  }>('SELECT trashedAt, deletedAt, updatedAt FROM files WHERE id = ?', id)
}

async function syncUpFlag(fileId: string): Promise<number> {
  return (
    (
      await db().getFirstAsync<{ needsSyncUp: number }>(
        'SELECT needsSyncUp FROM objects WHERE fileId = ?',
        fileId,
      )
    )?.needsSyncUp ?? 0
  )
}

beforeEach(setupTestDb)
afterEach(teardownTestDb)

describe('needsSyncUp flagging', () => {
  it('trash, restore, and tombstone each re-flag the file object for sync-up', async () => {
    await insertFile(db(), makeFileRecord('f1', { updatedAt: 1000 }))
    await createCleanObject('f1', 'obj-f1')
    expect(await syncUpFlag('f1')).toBe(0)

    await trashFilesAndThumbnails(db(), ['f1'])
    expect(await syncUpFlag('f1')).toBe(1)

    await db().runAsync('UPDATE objects SET needsSyncUp = 0 WHERE fileId = ?', 'f1')
    await restoreFilesAndThumbnails(db(), ['f1'])
    expect(await syncUpFlag('f1')).toBe(1)

    await db().runAsync('UPDATE objects SET needsSyncUp = 0 WHERE fileId = ?', 'f1')
    await tombstoneFilesAndThumbnails(db(), ['f1'])
    expect(await syncUpFlag('f1')).toBe(1)
  })
})

describe('atomicity', () => {
  // Fails the version recalculation, the last write trashing makes, on the
  // transaction's handle.
  function failingRecalculation(): DatabaseAdapter {
    const adapter = db()
    return {
      ...adapter,
      withTransactionAsync: (fn) =>
        adapter.withTransactionAsync((tx) =>
          fn({
            ...tx,
            runAsync: (sql: string, ...params: SQLParam[]) =>
              sql.includes('SET current')
                ? Promise.reject(new Error('recalculation failed'))
                : tx.runAsync(sql, ...params),
          }),
        ),
    }
  }

  it('trashing writes nothing when the version recalculation fails', async () => {
    await insertFile(db(), makeFileRecord('f1'))
    await createCleanObject('f1', 'obj-f1')

    await expect(trashFilesAndThumbnails(failingRecalculation(), ['f1'])).rejects.toThrow(
      'recalculation failed',
    )

    expect((await getFile('f1'))!.trashedAt).toBeNull()
    expect(await syncUpFlag('f1')).toBe(0)
  })
})

describe('trashFilesAndThumbnails', () => {
  it('sets trashedAt on files', async () => {
    await insertFile(db(), makeFileRecord('f1'))
    await insertFile(db(), makeFileRecord('f2'))

    await trashFilesAndThumbnails(db(), ['f1', 'f2'])

    const f1 = await getFile('f1')
    const f2 = await getFile('f2')
    expect(f1!.trashedAt).not.toBeNull()
    expect(f2!.trashedAt).not.toBeNull()
  })

  it('trashes thumbnails but flags only the parent object (not the thumb object)', async () => {
    await insertFile(db(), makeFileRecord('f1'))
    await insertFile(db(), makeFileRecord('t1', { kind: 'thumb', thumbForId: 'f1', thumbSize: 64 }))
    await createCleanObject('f1', 'obj-f1')
    await createCleanObject('t1', 'obj-t1')

    await trashFilesAndThumbnails(db(), ['f1'])

    const thumb = await getFile('t1')
    expect(thumb!.trashedAt).not.toBeNull()
    // The parent's object is flagged; the thumbnail's trashedAt isn't pushed, so
    // its object stays clean.
    expect(await syncUpFlag('f1')).toBe(1)
    expect(await syncUpFlag('t1')).toBe(0)
  })

  it('bumps updatedAt', async () => {
    await insertFile(db(), makeFileRecord('f1'))

    await trashFilesAndThumbnails(db(), ['f1'])

    const f1 = await getFile('f1')
    expect(f1!.updatedAt).toBeGreaterThan(1000)
  })

  it('no-ops on empty array', async () => {
    await trashFilesAndThumbnails(db(), [])
  })
})

describe('restoreFilesAndThumbnails', () => {
  it('clears trashedAt on files', async () => {
    await insertFile(db(), makeFileRecord('f1'))
    await trashFilesAndThumbnails(db(), ['f1'])

    await restoreFilesAndThumbnails(db(), ['f1'])

    const f1 = await getFile('f1')
    expect(f1!.trashedAt).toBeNull()
  })

  it('restores thumbnails but flags only the parent object (not the thumb object)', async () => {
    await insertFile(db(), makeFileRecord('f1'))
    await insertFile(db(), makeFileRecord('t1', { kind: 'thumb', thumbForId: 'f1', thumbSize: 64 }))
    await trashFilesAndThumbnails(db(), ['f1'])
    await createCleanObject('f1', 'obj-f1')
    await createCleanObject('t1', 'obj-t1')

    await restoreFilesAndThumbnails(db(), ['f1'])

    const thumb = await getFile('t1')
    expect(thumb!.trashedAt).toBeNull()
    expect(await syncUpFlag('f1')).toBe(1)
    expect(await syncUpFlag('t1')).toBe(0)
  })

  it('no-ops on empty array', async () => {
    await restoreFilesAndThumbnails(db(), [])
  })
})

describe('tombstoneFilesAndThumbnails', () => {
  it('sets deletedAt and trashedAt as tombstone', async () => {
    await insertFile(db(), makeFileRecord('f1'))

    await tombstoneFilesAndThumbnails(db(), ['f1'])

    const f1 = await getFile('f1')
    expect(f1!.deletedAt).not.toBeNull()
    expect(f1!.trashedAt).not.toBeNull()
  })

  it('preserves existing trashedAt', async () => {
    await insertFile(db(), makeFileRecord('f1', { trashedAt: 2000 }))

    await tombstoneFilesAndThumbnails(db(), ['f1'])

    const f1 = await getFile('f1')
    expect(f1!.trashedAt).toBe(2000)
  })

  it('tombstones thumbnails and flags both the parent and thumb objects', async () => {
    await insertFile(db(), makeFileRecord('f1'))
    await insertFile(db(), makeFileRecord('t1', { kind: 'thumb', thumbForId: 'f1', thumbSize: 64 }))
    await createCleanObject('f1', 'obj-f1')
    await createCleanObject('t1', 'obj-t1')

    await tombstoneFilesAndThumbnails(db(), ['f1'])

    const thumb = await getFile('t1')
    expect(thumb!.deletedAt).not.toBeNull()
    expect(thumb!.trashedAt).not.toBeNull()
    // Tombstone deletes both remote objects, so both are flagged.
    expect(await syncUpFlag('f1')).toBe(1)
    expect(await syncUpFlag('t1')).toBe(1)
  })

  it('no-ops on empty array', async () => {
    await tombstoneFilesAndThumbnails(db(), [])
  })
})

describe('autoPurgeOldTrashedFiles', () => {
  it('purges files trashed longer than the cutoff', async () => {
    const oldTrashedAt = 1
    await insertFile(db(), makeFileRecord('f1', { trashedAt: oldTrashedAt }))

    const purgedCount = await autoPurgeOldTrashedFiles(db())

    expect(purgedCount).toBe(1)
    const f1 = await getFile('f1')
    expect(f1!.deletedAt).not.toBeNull()
  })

  it('does not purge recently trashed files', async () => {
    await insertFile(db(), makeFileRecord('f1', { trashedAt: Date.now() }))

    const purgedCount = await autoPurgeOldTrashedFiles(db())

    expect(purgedCount).toBe(0)
  })

  it('does not purge already-deleted files', async () => {
    await insertFile(db(), makeFileRecord('f1', { trashedAt: 1, deletedAt: 2 }))

    const purgedCount = await autoPurgeOldTrashedFiles(db())

    expect(purgedCount).toBe(0)
  })

  it('only purges kind=file, not thumbnails', async () => {
    await insertFile(
      db(),
      makeFileRecord('t1', {
        kind: 'thumb',
        thumbForId: 'f1',
        thumbSize: 64,
        trashedAt: 1,
      }),
    )

    const purgedCount = await autoPurgeOldTrashedFiles(db())

    expect(purgedCount).toBe(0)
  })
})

describe('a deleted folder with more files than SQLite binds in one statement', () => {
  // SQLITE_MAX_VARIABLE_NUMBER is 32766, and one id is bound per file.
  const FILES = 33_000

  async function fillFolder(path: string) {
    const dir = await getOrCreateDirectoryAtPath(db(), path)
    await db().runAsync(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
       INSERT INTO files (id, name, size, type, kind, createdAt, updatedAt, addedAt, hash, directoryId, stackId)
       SELECT 'f' || i, 'f' || i || '.txt', 1, 'text/plain', 'file', 1000, 1000, 1000, 'sha256:h' || i, ?, 'f' || i
       FROM n`,
      FILES,
      dir.id,
    )
    return dir
  }

  async function countIn(path: string): Promise<number> {
    const row = await db().getFirstAsync<{ n: number }>(
      `SELECT count(*) AS n FROM files f JOIN directories d ON d.id = f.directoryId
       WHERE d.path = ? AND f.trashedAt IS NULL AND f.deletedAt IS NULL`,
      path,
    )
    return row?.n ?? 0
  }

  it('comes back whole from the trash, and deletes for good', async () => {
    await deleteDirectoryAndTrashFiles(db(), (await fillFolder('Big')).id)
    const [entry] = await queryTrashEntries(db(), 10, 0)
    expect(entry).toMatchObject({ kind: 'folder', files: FILES })

    await restoreTrashEntries(db(), [entry.id])
    expect(await countIn('Big')).toBe(FILES)

    const big = await getOrCreateDirectoryAtPath(db(), 'Big')
    await deleteDirectoryAndTrashFiles(db(), big.id)
    const [again] = await queryTrashEntries(db(), 10, 0)
    await tombstoneTrashEntries(db(), [again.id])
    const deleted = await db().getFirstAsync<{ n: number }>(
      'SELECT count(*) AS n FROM files WHERE deletedAt IS NOT NULL',
    )
    expect(deleted?.n).toBe(FILES)
    // The time limit fails this if delete or restore goes back to a
    // statement per file, which holds the database far longer.
  }, 30_000)
})

describe('trashOlderVersions', () => {
  const INDEXER = 'https://idx.example.com'
  const DAY = 24 * 60 * 60 * 1000
  const NOW = 100 * DAY

  /**
   * A version of notes.txt saved at `updatedAt` and added to this device at
   * `addedAt`, which defaults to `updatedAt`. Uploaded unless `uploaded` is false.
   */
  async function version(
    id: string,
    updatedAt: number,
    opts: { uploaded?: boolean; addedAt?: number } = {},
  ) {
    await insertFile(
      db(),
      makeFileRecord(id, {
        name: 'notes.txt',
        type: 'text/plain',
        updatedAt,
        addedAt: opts.addedAt ?? updatedAt,
      }),
    )
    if (opts.uploaded !== false) await createCleanObject(id, `obj-${id}`)
  }

  async function currentId(): Promise<string | undefined> {
    const row = await db().getFirstAsync<{ id: string }>(
      "SELECT id FROM files WHERE current = 1 AND name = 'notes.txt'",
    )
    return row?.id
  }

  async function trashed(): Promise<string[]> {
    const rows = await db().getAllAsync<{ id: string }>(
      'SELECT id FROM files WHERE trashedAt IS NOT NULL ORDER BY id',
    )
    return rows.map((r) => r.id)
  }

  it('trashes an older version once the version replacing it is a day old', async () => {
    await version('v1', NOW - 3 * DAY)
    await version('v2', NOW - DAY)

    expect(await trashOlderVersions(db(), INDEXER, NOW)).toEqual(['v1'])
    expect(await trashed()).toEqual(['v1'])
  })

  it('leaves an older version while the version replacing it is under a day old', async () => {
    await version('v1', NOW - 3 * DAY)
    await version('v2', NOW - DAY + 1)

    expect(await trashOlderVersions(db(), INDEXER, NOW)).toEqual([])
  })

  it('leaves the current version, however old', async () => {
    await version('v1', NOW - 30 * DAY)

    expect(await trashOlderVersions(db(), INDEXER, NOW)).toEqual([])
  })

  it('leaves an older version that has not uploaded', async () => {
    await version('v1', NOW - 3 * DAY, { uploaded: false })
    await version('v2', NOW - 2 * DAY)

    expect(await trashOlderVersions(db(), INDEXER, NOW)).toEqual([])
  })

  it('leaves an older version uploaded only to another indexer', async () => {
    await version('v1', NOW - 3 * DAY)
    await version('v2', NOW - 2 * DAY)

    expect(await trashOlderVersions(db(), 'https://other.example.com', NOW)).toEqual([])
  })

  it('keeps a version replaced under a day ago while trashing an earlier one', async () => {
    await version('v1', NOW - 5 * DAY)
    await version('v2', NOW - 2 * DAY)
    await version('v3', NOW - DAY / 2)

    expect(await trashOlderVersions(db(), INDEXER, NOW)).toEqual(['v1'])
    await trashOlderVersions(db(), INDEXER, NOW + DAY)
    expect(await trashed()).toEqual(['v1', 'v2'])
    expect(await currentId()).toBe('v3')
  })

  it('puts the older versions of one file in one trash entry', async () => {
    await version('v1', NOW - 5 * DAY)
    await version('v2', NOW - 4 * DAY)
    await version('v3', NOW - 3 * DAY)

    await trashOlderVersions(db(), INDEXER, NOW)

    const entries = await queryTrashEntries(db(), 10, 0)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ name: 'notes.txt', versions: 2, trashedAt: NOW })
  })

  it('leaves an older version that a share link names', async () => {
    await version('v1', NOW - 3 * DAY)
    await version('v2', NOW - 2 * DAY)
    await insertShareLink(db(), {
      publicKey: 'pk',
      seed: '00',
      indexerURL: INDEXER,
      createdAt: NOW,
      expiresAt: null,
      mode: 'snapshot',
    })
    await insertShareLinkFile(db(), 'pk', 'v1', 'shared')

    expect(await trashOlderVersions(db(), INDEXER, NOW)).toEqual([])
  })

  it('keeps the order of versions that span more than one batch', async () => {
    // One more older version than a batch holds, so the oldest lands in a second batch.
    const count = 502
    for (let i = 0; i < count; i++)
      await version(`v${String(i).padStart(3, '0')}`, NOW - 10 * DAY + i)

    expect(await trashOlderVersions(db(), INDEXER, NOW)).toHaveLength(count - 1)

    const rows = await db().getAllAsync<{ id: string }>(
      "SELECT id FROM files WHERE trashedAt IS NOT NULL AND name = 'notes.txt' ORDER BY updatedAt DESC",
    )
    const newestFirst = Array.from(
      { length: count - 1 },
      (_, i) => `v${String(count - 2 - i).padStart(3, '0')}`,
    )
    expect(rows.map((r) => r.id)).toEqual(newestFirst)
  }, 30_000)

  it('reports each batch as it commits, so a later batch failing leaves the first reported', async () => {
    const count = 502
    for (let i = 0; i < count; i++)
      await version(`v${String(i).padStart(3, '0')}`, NOW - 10 * DAY + i)
    // The oldest version is alone in the second batch.
    await db().execAsync(
      `CREATE TRIGGER fail_oldest BEFORE UPDATE ON files
       WHEN NEW.id = 'v000' AND NEW.trashedAt IS NOT NULL
       BEGIN SELECT RAISE(ABORT, 'disk full'); END`,
    )
    const reported: string[][] = []

    await expect(
      trashOlderVersions(db(), INDEXER, NOW, async (ids) => {
        reported.push(ids)
      }),
    ).rejects.toThrow('disk full')

    expect(reported.map((ids) => ids.length)).toEqual([count - 2])
    expect(await trashed()).toEqual([...reported[0]].sort())
  }, 30_000)

  it('trashes every due version across batches when versions it leaves sit between them', async () => {
    // Every third version has not uploaded, so each batch passes over some
    // versions it leaves, and the next batch has to continue below them.
    const count = 1200
    const expected: string[] = []
    for (let i = 0; i < count; i++) {
      const id = `v${String(i).padStart(4, '0')}`
      const uploaded = i % 3 !== 0
      await version(id, NOW - 10 * DAY + i, { uploaded })
      if (uploaded && i < count - 1) expected.push(id)
    }

    const ids = await trashOlderVersions(db(), INDEXER, NOW)

    expect([...ids].sort()).toEqual(expected)
    expect(await trashed()).toEqual(expected)
  }, 30_000)

  it('leaves versions of different files alone', async () => {
    await insertFile(db(), makeFileRecord('a', { name: 'a.txt', updatedAt: NOW - 3 * DAY }))
    await createCleanObject('a', 'obj-a')
    await insertFile(db(), makeFileRecord('b', { name: 'b.txt', updatedAt: NOW - 2 * DAY }))
    await createCleanObject('b', 'obj-b')

    expect(await trashOlderVersions(db(), INDEXER, NOW)).toEqual([])
  })

  it('counts the day from when a newer version was added, not from its capture time', async () => {
    // A photo-library import stamps updatedAt with the capture time, months
    // before the import added it here.
    await version('v1', NOW - 90 * DAY)
    await version('v2', NOW - 60 * DAY, { addedAt: NOW })

    expect(await trashOlderVersions(db(), INDEXER, NOW)).toEqual([])
    expect(await trashOlderVersions(db(), INDEXER, NOW + DAY - 1)).toEqual([])
    expect(await trashOlderVersions(db(), INDEXER, NOW + DAY)).toEqual(['v1'])
  })

  it('leaves an older version added under a day ago, however old the version above it', async () => {
    // An import with an earlier capture time than the file already here
    // arrives as an older version.
    await version('v1', NOW - 60 * DAY)
    await version('v0', NOW - 90 * DAY, { addedAt: NOW })
    expect(await currentId()).toBe('v1')

    expect(await trashOlderVersions(db(), INDEXER, NOW)).toEqual([])
    expect(await trashOlderVersions(db(), INDEXER, NOW + DAY)).toEqual(['v0'])
  })

  it('makes a restored version current over one saved after it was trashed, for a day', async () => {
    await version('v1', NOW - 3 * DAY)
    await version('v2', NOW - 2 * DAY)
    expect(await trashOlderVersions(db(), INDEXER, NOW)).toEqual(['v1'])
    const saved = NOW + 60 * 60 * 1000
    await version('v3', saved)

    const restoredAt = saved + 60 * 60 * 1000
    const clock = jest.spyOn(Date, 'now').mockReturnValue(restoredAt)
    try {
      await restoreFilesAndThumbnails(db(), ['v1'])
    } finally {
      clock.mockRestore()
    }

    expect(await currentId()).toBe('v1')
    expect(await trashOlderVersions(db(), INDEXER, restoredAt + DAY / 2)).toEqual([])
    // The versions the restore replaced go a day after it, and the restored one stays.
    expect(await trashOlderVersions(db(), INDEXER, restoredAt + DAY)).toEqual(['v3', 'v2'])
    expect(await currentId()).toBe('v1')
  })
})

import { insertFile } from './files'
import { insertObject } from './localObjects'
import { db, setupTestDb, teardownTestDb } from './test-setup'
import {
  autoPurgeOldTrashedFiles,
  tombstoneFilesAndThumbnails,
  restoreFilesAndThumbnails,
  trashFilesAndThumbnails,
} from './trash'

function makeFileRecord(id: string, overrides?: Record<string, any>) {
  return {
    id,
    name: `${id}.jpg`,
    type: 'image/jpeg',
    kind: 'file' as const,
    size: 100,
    hash: `hash-${id}`,
    createdAt: 1000,
    updatedAt: 1000,
    localId: null,
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

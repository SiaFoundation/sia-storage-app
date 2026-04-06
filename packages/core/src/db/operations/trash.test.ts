import { insertFileRecord } from './files'
import { db, setupTestDb, teardownTestDb } from './test-setup'
import { autoPurgeOldTrashedFiles, permanentlyDeleteFiles, restoreFiles, trashFiles } from './trash'

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

async function getFile(id: string) {
  return db().getFirstAsync<{
    trashedAt: number | null
    deletedAt: number | null
    updatedAt: number
  }>('SELECT trashedAt, deletedAt, updatedAt FROM files WHERE id = ?', id)
}

beforeEach(setupTestDb)
afterEach(teardownTestDb)

describe('trashFiles', () => {
  it('sets trashedAt on files', async () => {
    await insertFileRecord(db(), makeFileRecord('f1'))
    await insertFileRecord(db(), makeFileRecord('f2'))

    await trashFiles(db(), ['f1', 'f2'])

    const f1 = await getFile('f1')
    const f2 = await getFile('f2')
    expect(f1!.trashedAt).not.toBeNull()
    expect(f2!.trashedAt).not.toBeNull()
  })

  it('trashes thumbnails for the given files', async () => {
    await insertFileRecord(db(), makeFileRecord('f1'))
    await insertFileRecord(
      db(),
      makeFileRecord('t1', { kind: 'thumb', thumbForId: 'f1', thumbSize: 64 }),
    )

    await trashFiles(db(), ['f1'])

    const thumb = await getFile('t1')
    expect(thumb!.trashedAt).not.toBeNull()
  })

  it('bumps updatedAt', async () => {
    await insertFileRecord(db(), makeFileRecord('f1'))

    await trashFiles(db(), ['f1'])

    const f1 = await getFile('f1')
    expect(f1!.updatedAt).toBeGreaterThan(1000)
  })

  it('no-ops on empty array', async () => {
    await trashFiles(db(), [])
  })
})

describe('restoreFiles', () => {
  it('clears trashedAt on files', async () => {
    await insertFileRecord(db(), makeFileRecord('f1'))
    await trashFiles(db(), ['f1'])

    await restoreFiles(db(), ['f1'])

    const f1 = await getFile('f1')
    expect(f1!.trashedAt).toBeNull()
  })

  it('restores thumbnails for the given files', async () => {
    await insertFileRecord(db(), makeFileRecord('f1'))
    await insertFileRecord(
      db(),
      makeFileRecord('t1', { kind: 'thumb', thumbForId: 'f1', thumbSize: 64 }),
    )
    await trashFiles(db(), ['f1'])

    await restoreFiles(db(), ['f1'])

    const thumb = await getFile('t1')
    expect(thumb!.trashedAt).toBeNull()
  })

  it('no-ops on empty array', async () => {
    await restoreFiles(db(), [])
  })
})

describe('permanentlyDeleteFiles', () => {
  it('sets deletedAt and trashedAt as tombstone', async () => {
    await insertFileRecord(db(), makeFileRecord('f1'))

    await permanentlyDeleteFiles(db(), ['f1'])

    const f1 = await getFile('f1')
    expect(f1!.deletedAt).not.toBeNull()
    expect(f1!.trashedAt).not.toBeNull()
  })

  it('preserves existing trashedAt', async () => {
    await insertFileRecord(db(), makeFileRecord('f1', { trashedAt: 2000 }))

    await permanentlyDeleteFiles(db(), ['f1'])

    const f1 = await getFile('f1')
    expect(f1!.trashedAt).toBe(2000)
  })

  it('tombstones thumbnails', async () => {
    await insertFileRecord(db(), makeFileRecord('f1'))
    await insertFileRecord(
      db(),
      makeFileRecord('t1', { kind: 'thumb', thumbForId: 'f1', thumbSize: 64 }),
    )

    await permanentlyDeleteFiles(db(), ['f1'])

    const thumb = await getFile('t1')
    expect(thumb!.deletedAt).not.toBeNull()
    expect(thumb!.trashedAt).not.toBeNull()
  })

  it('no-ops on empty array', async () => {
    await permanentlyDeleteFiles(db(), [])
  })
})

describe('autoPurgeOldTrashedFiles', () => {
  it('purges files trashed longer than the cutoff', async () => {
    const oldTrashedAt = 1
    await insertFileRecord(db(), makeFileRecord('f1', { trashedAt: oldTrashedAt }))

    const purgedCount = await autoPurgeOldTrashedFiles(db())

    expect(purgedCount).toBe(1)
    const f1 = await getFile('f1')
    expect(f1!.deletedAt).not.toBeNull()
  })

  it('does not purge recently trashed files', async () => {
    await insertFileRecord(db(), makeFileRecord('f1', { trashedAt: Date.now() }))

    const purgedCount = await autoPurgeOldTrashedFiles(db())

    expect(purgedCount).toBe(0)
  })

  it('does not purge already-deleted files', async () => {
    await insertFileRecord(db(), makeFileRecord('f1', { trashedAt: 1, deletedAt: 2 }))

    const purgedCount = await autoPurgeOldTrashedFiles(db())

    expect(purgedCount).toBe(0)
  })

  it('only purges kind=file, not thumbnails', async () => {
    await insertFileRecord(
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

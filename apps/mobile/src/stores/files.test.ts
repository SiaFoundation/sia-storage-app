import { initializeDB, resetDb } from '../db'
import { app } from './appService'

describe('files store (core functions with appService)', () => {
  beforeEach(async () => {
    await initializeDB()
  })

  afterEach(async () => {
    await resetDb()
    jest.restoreAllMocks()
  })

  function makeFileRecord(id: string) {
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
    }
  }

  test('createFileRecord persists record', async () => {
    const libSpy = jest.spyOn(app().caches.library, 'invalidateAll')
    const verSpy = jest.spyOn(app().caches.libraryVersion, 'invalidate')
    await app().files.create(makeFileRecord('f1'))
    const record = await app().files.getById('f1')
    expect(record).not.toBeNull()
    expect(record!.name).toBe('f1.jpg')
    expect(libSpy).toHaveBeenCalled()
    expect(verSpy).toHaveBeenCalled()
  })

  test('createFileRecord skips invalidation with skipInvalidation', async () => {
    const libSpy = jest.spyOn(app().caches.library, 'invalidateAll')
    await app().files.create(makeFileRecord('f1'), undefined, {
      skipInvalidation: true,
    })
    expect(libSpy).not.toHaveBeenCalled()
  })

  test('createManyFileRecords persists multiple records', async () => {
    const libSpy = jest.spyOn(app().caches.library, 'invalidateAll')
    const verSpy = jest.spyOn(app().caches.libraryVersion, 'invalidate')
    await app().files.createMany([makeFileRecord('f1'), makeFileRecord('f2')])
    expect(await app().files.getById('f1')).not.toBeNull()
    expect(await app().files.getById('f2')).not.toBeNull()
    expect(libSpy).toHaveBeenCalled()
    expect(verSpy).toHaveBeenCalled()
  })

  test('createManyFileRecords handles empty array', async () => {
    const libSpy = jest.spyOn(app().caches.library, 'invalidateAll')
    await app().files.createMany([])
    expect(libSpy).not.toHaveBeenCalled()
  })

  test('updateFileRecord modifies record', async () => {
    await app().files.create(makeFileRecord('f1'))
    const fileSpy = jest.spyOn(app().caches.fileById, 'invalidate')
    const verSpy = jest.spyOn(app().caches.libraryVersion, 'invalidate')
    await app().files.update({ id: 'f1', name: 'renamed.jpg' })
    const record = await app().files.getById('f1')
    expect(record!.name).toBe('renamed.jpg')
    expect(fileSpy).toHaveBeenCalledWith('f1')
    expect(verSpy).toHaveBeenCalled()
  })

  test('updateFileRecord passes includeUpdatedAt option', async () => {
    await app().files.create(makeFileRecord('f1'))
    const fileSpy = jest.spyOn(app().caches.fileById, 'invalidate')
    const verSpy = jest.spyOn(app().caches.libraryVersion, 'invalidate')
    await app().files.update(
      { id: 'f1', updatedAt: 9999, name: 'updated.jpg' },
      { includeUpdatedAt: true, skipInvalidation: true },
    )
    const record = await app().files.getById('f1')
    expect(record!.updatedAt).toBe(9999)
    expect(fileSpy).not.toHaveBeenCalled()
    expect(verSpy).not.toHaveBeenCalled()
  })

  test('deleteFileRecord removes record', async () => {
    await app().files.create(makeFileRecord('f1'))
    const libSpy = jest.spyOn(app().caches.library, 'invalidateAll')
    const verSpy = jest.spyOn(app().caches.libraryVersion, 'invalidate')
    await app().files.delete('f1')
    const record = await app().files.getById('f1')
    expect(record).toBeNull()
    expect(libSpy).toHaveBeenCalled()
    expect(verSpy).toHaveBeenCalled()
  })

  test('deleteFileRecord skips invalidation with skipInvalidation', async () => {
    await app().files.create(makeFileRecord('f1'))
    const libSpy = jest.spyOn(app().caches.library, 'invalidateAll')
    await app().files.delete('f1', { skipInvalidation: true })
    expect(libSpy).not.toHaveBeenCalled()
  })
})

import { initializeDB, resetDb } from '../db'
import { app } from './appService'

describe('files store (core functions with appService)', () => {
  beforeEach(async () => {
    await initializeDB()
  })

  afterEach(async () => {
    await resetDb()
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
    await app().files.create(makeFileRecord('f1'))
    const record = await app().files.getById('f1')
    expect(record).not.toBeNull()
    expect(record!.name).toBe('f1.jpg')
  })

  test('createManyFileRecords persists multiple records', async () => {
    await app().files.createMany([makeFileRecord('f1'), makeFileRecord('f2')])
    expect(await app().files.getById('f1')).not.toBeNull()
    expect(await app().files.getById('f2')).not.toBeNull()
  })

  test('createManyFileRecords handles empty array', async () => {
    await app().files.createMany([])
  })

  test('updateFileRecord modifies record', async () => {
    await app().files.create(makeFileRecord('f1'))
    await app().files.update({ id: 'f1', name: 'renamed.jpg' })
    const record = await app().files.getById('f1')
    expect(record!.name).toBe('renamed.jpg')
  })

  test('updateFileRecord passes includeUpdatedAt option', async () => {
    await app().files.create(makeFileRecord('f1'))
    await app().files.update(
      { id: 'f1', updatedAt: 9999, name: 'updated.jpg' },
      { includeUpdatedAt: true, skipInvalidation: true },
    )
    const record = await app().files.getById('f1')
    expect(record!.updatedAt).toBe(9999)
  })

  test('deleteFileRecord removes record', async () => {
    await app().files.create(makeFileRecord('f1'))
    await app().files.delete('f1')
    const record = await app().files.getById('f1')
    expect(record).toBeNull()
  })
})

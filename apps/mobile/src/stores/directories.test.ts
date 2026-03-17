import { initializeDB, resetDb } from '../db'
import { app } from './appService'

describe('directories store', () => {
  beforeEach(async () => {
    await initializeDB()
  })

  afterEach(async () => {
    await resetDb()
    jest.restoreAllMocks()
  })

  async function createTestFile(id: string) {
    await app().files.create({
      id,
      name: `${id}.jpg`,
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: `hash-${id}`,
      createdAt: 1000,
      updatedAt: 1000,
      localId: null,
      addedAt: 1000,
      trashedAt: null,
      deletedAt: null,
    })
  }

  test('createDirectory invalidates directory cache', async () => {
    const spy = jest.spyOn(app().caches.directories, 'invalidate')
    await app().directories.create('Photos')
    expect(spy).toHaveBeenCalledWith('all')
  })

  test('deleteDirectory removes directory', async () => {
    const dir = await app().directories.create('Photos')
    await app().directories.delete(dir.id)
    const dirs = await app().directories.getAll()
    expect(dirs.find((d: { id: string }) => d.id === dir.id)).toBeUndefined()
  })

  test('deleteDirectoryAndTrashFiles trashes associated files', async () => {
    const dir = await app().directories.create('Photos')
    await createTestFile('f1')
    await app().directories.moveFile('f1', dir.id)

    await app().directories.deleteAndTrashFiles(dir.id)

    const record = await app().files.getById('f1')
    expect(record!.trashedAt).not.toBeNull()
  })

  test('renameDirectory updates name', async () => {
    const dir = await app().directories.create('Photos')
    await app().directories.rename(dir.id, 'Images')
    const dirs = await app().directories.getAll()
    expect(dirs.find((d: { id: string }) => d.id === dir.id)?.name).toBe(
      'Images',
    )
  })

  test('syncDirectoryFromMetadata skips when undefined', async () => {
    await createTestFile('f1')
    await app().directories.syncFromMetadata('f1', 'Photos')

    const dirsBefore = await app().directories.getAll()
    await app().directories.syncFromMetadata('f1', undefined)
    const dirsAfter = await app().directories.getAll()

    expect(dirsAfter.length).toBe(dirsBefore.length)
  })

  test('syncDirectoryFromMetadata creates directory for file', async () => {
    await createTestFile('f1')
    await app().directories.syncFromMetadata('f1', 'Photos')

    const dirs = await app().directories.getAll()
    expect(dirs.some((d: { name: string }) => d.name === 'Photos')).toBe(true)
  })
})

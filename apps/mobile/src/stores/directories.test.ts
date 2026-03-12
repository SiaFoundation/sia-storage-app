import { initializeDB, resetDb } from '../db'
import {
  createDirectory,
  deleteDirectory,
  deleteDirectoryAndTrashFiles,
  directoriesSwr,
  moveFileToDirectory,
  renameDirectory,
  syncDirectoryFromMetadata,
} from './directories'
import { createFileRecord } from './files'

jest.mock('./librarySwr', () => ({
  libraryStats: {
    key: jest.fn((...parts: string[]) => [`mock/${parts.join('/')}`]),
    invalidateAll: jest.fn(),
  },
  invalidateCacheLibraryAllStats: jest.fn(),
  invalidateCacheLibraryLists: jest.fn(),
}))

const { invalidateCacheLibraryAllStats, invalidateCacheLibraryLists } =
  require('./librarySwr') as {
    invalidateCacheLibraryAllStats: jest.Mock
    invalidateCacheLibraryLists: jest.Mock
  }

describe('directories store (mobile wrappers)', () => {
  beforeEach(async () => {
    await initializeDB()
  })

  afterEach(async () => {
    await resetDb()
    jest.clearAllMocks()
  })

  async function createTestFile(id: string) {
    await createFileRecord({
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
    const spy = jest.spyOn(directoriesSwr, 'invalidate')
    await createDirectory('Photos')
    expect(spy).toHaveBeenCalledWith('all')
  })

  test('deleteDirectory invalidates library lists', async () => {
    const dir = await createDirectory('Photos')
    jest.clearAllMocks()
    await deleteDirectory(dir.id)
    expect(invalidateCacheLibraryLists).toHaveBeenCalled()
  })

  test('deleteDirectoryAndTrashFiles invalidates stats and lists', async () => {
    const dir = await createDirectory('Photos')
    await createTestFile('f1')
    await moveFileToDirectory('f1', dir.id)
    jest.clearAllMocks()

    await deleteDirectoryAndTrashFiles(dir.id)

    expect(invalidateCacheLibraryAllStats).toHaveBeenCalled()
    expect(invalidateCacheLibraryLists).toHaveBeenCalled()
  })

  test('renameDirectory invalidates library lists', async () => {
    const dir = await createDirectory('Photos')
    jest.clearAllMocks()
    await renameDirectory(dir.id, 'Images')
    expect(invalidateCacheLibraryLists).toHaveBeenCalled()
  })

  test('syncDirectoryFromMetadata skips when undefined', async () => {
    await createTestFile('f1')
    await syncDirectoryFromMetadata('f1', 'Photos')
    jest.clearAllMocks()

    await syncDirectoryFromMetadata('f1', undefined)
    expect(invalidateCacheLibraryLists).not.toHaveBeenCalled()
  })

  test('syncDirectoryFromMetadata invalidates on defined name', async () => {
    await createTestFile('f1')
    await syncDirectoryFromMetadata('f1', 'Photos')
    expect(invalidateCacheLibraryLists).toHaveBeenCalled()
  })
})

import { initializeDB, resetDb } from '../db'
import {
  createFileRecord,
  createManyFileRecords,
  deleteFileRecord,
  readFileRecord,
  updateFileRecord,
} from './files'

jest.mock('./librarySwr', () => ({
  libraryStats: {
    key: jest.fn((...parts: string[]) => [`mock/${parts.join('/')}`]),
    invalidateAll: jest.fn(),
  },
  invalidateCacheLibraryAllStats: jest.fn().mockResolvedValue(undefined),
  invalidateCacheLibraryLists: jest.fn(),
}))

const { invalidateCacheLibraryAllStats, invalidateCacheLibraryLists } =
  require('./librarySwr') as {
    invalidateCacheLibraryAllStats: jest.Mock
    invalidateCacheLibraryLists: jest.Mock
  }

describe('files store (mobile wrappers)', () => {
  beforeEach(async () => {
    await initializeDB()
  })

  afterEach(async () => {
    await resetDb()
    jest.clearAllMocks()
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

  test('createFileRecord invalidates stats and lists', async () => {
    await createFileRecord(makeFileRecord('f1'))
    expect(invalidateCacheLibraryAllStats).toHaveBeenCalled()
    expect(invalidateCacheLibraryLists).toHaveBeenCalled()
  })

  test('createFileRecord skips invalidation when triggerUpdate=false', async () => {
    await createFileRecord(makeFileRecord('f1'), false)
    expect(invalidateCacheLibraryAllStats).not.toHaveBeenCalled()
    expect(invalidateCacheLibraryLists).not.toHaveBeenCalled()
  })

  test('createManyFileRecords invalidates on non-empty', async () => {
    await createManyFileRecords([makeFileRecord('f1'), makeFileRecord('f2')])
    expect(invalidateCacheLibraryAllStats).toHaveBeenCalled()
  })

  test('createManyFileRecords skips invalidation on empty', async () => {
    await createManyFileRecords([])
    expect(invalidateCacheLibraryAllStats).not.toHaveBeenCalled()
  })

  test('updateFileRecord invalidates library lists', async () => {
    await createFileRecord(makeFileRecord('f1'))
    jest.clearAllMocks()
    await updateFileRecord({ id: 'f1', name: 'renamed.jpg' })
    expect(invalidateCacheLibraryLists).toHaveBeenCalled()
  })

  test('updateFileRecord skips invalidation when triggerUpdate=false', async () => {
    await createFileRecord(makeFileRecord('f1'))
    jest.clearAllMocks()
    await updateFileRecord({ id: 'f1', name: 'renamed.jpg' }, false)
    expect(invalidateCacheLibraryLists).not.toHaveBeenCalled()
  })

  test('updateFileRecord passes includeUpdatedAt option', async () => {
    await createFileRecord(makeFileRecord('f1'))
    await updateFileRecord(
      { id: 'f1', updatedAt: 9999, name: 'updated.jpg' },
      false,
      { includeUpdatedAt: true },
    )
    const record = await readFileRecord('f1')
    expect(record!.updatedAt).toBe(9999)
  })

  test('deleteFileRecord invalidates stats and lists', async () => {
    await createFileRecord(makeFileRecord('f1'))
    jest.clearAllMocks()
    await deleteFileRecord('f1')
    expect(invalidateCacheLibraryAllStats).toHaveBeenCalled()
    expect(invalidateCacheLibraryLists).toHaveBeenCalled()
  })

  test('deleteFileRecord skips invalidation when triggerUpdate=false', async () => {
    await createFileRecord(makeFileRecord('f1'))
    jest.clearAllMocks()
    await deleteFileRecord('f1', false)
    expect(invalidateCacheLibraryAllStats).not.toHaveBeenCalled()
    expect(invalidateCacheLibraryLists).not.toHaveBeenCalled()
  })
})

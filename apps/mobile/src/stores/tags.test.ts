import { initializeDB, resetDb } from '../db'
import { createFileRecord } from './files'
import {
  addTagToFile,
  createTag,
  deleteTag,
  readTagsForFile,
  renameTag,
  syncTagsFromMetadata,
  tagsSwr,
  toggleFavorite,
} from './tags'

jest.mock('./librarySwr', () => ({
  libraryStats: {
    key: jest.fn((...parts: string[]) => [`mock/${parts.join('/')}`]),
    invalidateAll: jest.fn(),
  },
  invalidateCacheLibraryAllStats: jest.fn(),
  invalidateCacheLibraryLists: jest.fn(),
}))

const { invalidateCacheLibraryLists } = require('./librarySwr') as {
  invalidateCacheLibraryLists: jest.Mock
}

describe('tags store (mobile wrappers)', () => {
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

  test('createTag invalidates cache', async () => {
    const spy = jest.spyOn(tagsSwr, 'invalidateAll')
    await createTag('vacation')
    expect(spy).toHaveBeenCalled()
  })

  test('addTagToFile invalidates library lists', async () => {
    await createTestFile('f1')
    await addTagToFile('f1', 'tag1')
    expect(invalidateCacheLibraryLists).toHaveBeenCalled()
  })

  test('toggleFavorite invalidates library lists', async () => {
    await createTestFile('f1')
    await toggleFavorite('f1')
    expect(invalidateCacheLibraryLists).toHaveBeenCalled()
  })

  test('renameTag invalidates library lists', async () => {
    const tag = await createTag('old')
    jest.clearAllMocks()
    await renameTag(tag.id, 'new')
    expect(invalidateCacheLibraryLists).toHaveBeenCalled()
  })

  test('deleteTag invalidates library lists', async () => {
    const tag = await createTag('toDelete')
    jest.clearAllMocks()
    await deleteTag(tag.id)
    expect(invalidateCacheLibraryLists).toHaveBeenCalled()
  })

  test('syncTagsFromMetadata skips core call when undefined', async () => {
    await createTestFile('f1')
    await addTagToFile('f1', 'existing')
    jest.clearAllMocks()

    await syncTagsFromMetadata('f1', undefined)

    expect(invalidateCacheLibraryLists).not.toHaveBeenCalled()
    const tags = await readTagsForFile('f1')
    expect(tags.some((t) => t.name === 'existing')).toBe(true)
  })

  test('syncTagsFromMetadata invalidates on defined tags', async () => {
    await createTestFile('f1')
    await syncTagsFromMetadata('f1', ['newTag'])
    expect(invalidateCacheLibraryLists).toHaveBeenCalled()
  })
})

import { db, initializeDB, resetDb } from '../db'
import { createFileRecord } from './files'
import { buildLibraryQueryParts } from './library'
import { addTagToFile } from './tags'

jest.mock('./localObjects', () => ({
  readLocalObjectsForFiles: jest.fn().mockResolvedValue({}),
}))

describe('library tag filtering', () => {
  beforeEach(async () => {
    await initializeDB()
  })

  afterEach(async () => {
    await resetDb()
    jest.clearAllMocks()
  })

  async function createTestFile(id: string, type: string = 'image/jpeg') {
    await createFileRecord({
      id,
      name: `${id}.jpg`,
      type,
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

  async function createFileWithTags(id: string, tagNames: string[]) {
    await createTestFile(id)
    for (const name of tagNames) {
      await addTagToFile(id, name)
    }
  }

  describe('buildLibraryQueryParts with tags', () => {
    test('filters files having ALL selected tags (AND logic)', async () => {
      await createFileWithTags('file-1', ['a', 'b'])
      await createFileWithTags('file-2', ['a', 'c'])
      await createFileWithTags('file-3', ['a', 'b', 'c'])

      const tagA = await db().getFirstAsync<{ id: string }>(
        "SELECT id FROM tags WHERE name = 'a'",
      )
      const tagB = await db().getFirstAsync<{ id: string }>(
        "SELECT id FROM tags WHERE name = 'b'",
      )

      const { where, params } = buildLibraryQueryParts({
        tags: [tagA!.id, tagB!.id],
        tableAlias: 'files',
      })

      const rows = await db().getAllAsync<{ id: string }>(
        `SELECT id FROM files ${where}`,
        ...params,
      )

      expect(rows.map((r) => r.id).sort()).toEqual(['file-1', 'file-3'])
    })

    test('returns no files when none have all tags', async () => {
      await createFileWithTags('file-1', ['a'])
      await createFileWithTags('file-2', ['b'])

      const tagA = await db().getFirstAsync<{ id: string }>(
        "SELECT id FROM tags WHERE name = 'a'",
      )
      const tagB = await db().getFirstAsync<{ id: string }>(
        "SELECT id FROM tags WHERE name = 'b'",
      )

      const { where, params } = buildLibraryQueryParts({
        tags: [tagA!.id, tagB!.id],
        tableAlias: 'files',
      })

      const rows = await db().getAllAsync<{ id: string }>(
        `SELECT id FROM files ${where}`,
        ...params,
      )

      expect(rows).toHaveLength(0)
    })

    test('works with single tag filter', async () => {
      await createFileWithTags('file-1', ['a'])
      await createFileWithTags('file-2', ['b'])
      await createFileWithTags('file-3', ['a', 'b'])

      const tagA = await db().getFirstAsync<{ id: string }>(
        "SELECT id FROM tags WHERE name = 'a'",
      )

      const { where, params } = buildLibraryQueryParts({
        tags: [tagA!.id],
        tableAlias: 'files',
      })

      const rows = await db().getAllAsync<{ id: string }>(
        `SELECT id FROM files ${where}`,
        ...params,
      )

      expect(rows.map((r) => r.id).sort()).toEqual(['file-1', 'file-3'])
    })

    test('combines with category filters', async () => {
      await createTestFile('video-1', 'video/mp4')
      await createTestFile('image-1', 'image/jpeg')
      await addTagToFile('video-1', 'tag1')
      await addTagToFile('image-1', 'tag1')

      const tag = await db().getFirstAsync<{ id: string }>(
        "SELECT id FROM tags WHERE name = 'tag1'",
      )

      const { where, params } = buildLibraryQueryParts({
        tags: [tag!.id],
        categories: ['Video'],
        tableAlias: 'files',
      })

      const rows = await db().getAllAsync<{ id: string }>(
        `SELECT id FROM files ${where}`,
        ...params,
      )

      expect(rows.map((r) => r.id)).toEqual(['video-1'])
    })

    test('combines with search query', async () => {
      await createFileWithTags('abc', ['tag1'])
      await createFileWithTags('xyz', ['tag1'])

      const tag = await db().getFirstAsync<{ id: string }>(
        "SELECT id FROM tags WHERE name = 'tag1'",
      )

      const { where, params } = buildLibraryQueryParts({
        tags: [tag!.id],
        query: 'abc',
        tableAlias: 'files',
      })

      const rows = await db().getAllAsync<{ id: string }>(
        `SELECT id FROM files ${where}`,
        ...params,
      )

      expect(rows.map((r) => r.id)).toEqual(['abc'])
    })

    test('returns all files when no tags selected', async () => {
      await createTestFile('file-1')
      await createTestFile('file-2')

      const { where, params } = buildLibraryQueryParts({
        tags: [],
        tableAlias: 'files',
      })

      const rows = await db().getAllAsync<{ id: string }>(
        `SELECT id FROM files ${where}`,
        ...params,
      )

      expect(rows).toHaveLength(2)
    })
  })
})

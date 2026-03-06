import { insertFileRecord } from './files'
import {
  buildLibraryQueryParts,
  queryDirectoryFileCount,
  queryFileCountWithFilters,
  queryFilePositionInSortedList,
  queryLibraryFileCount,
  queryMediaFileCount,
  querySortedFileIds,
  queryTagFileCount,
  queryUnfiledFileCount,
  UNFILED_DIRECTORY_ID,
} from './library'
import { addTagToFile } from './tags'
import { db, setupTestDb, teardownTestDb } from './test-setup'

beforeEach(setupTestDb)
afterEach(teardownTestDb)

async function createTestFile(
  id: string,
  overrides?: Partial<{
    type: string
    name: string | null
    createdAt: number
    addedAt: number
    size: number
    directoryId: string
  }>,
) {
  await insertFileRecord(db(), {
    id,
    name: overrides?.name ?? `${id}.jpg`,
    type: overrides?.type ?? 'image/jpeg',
    kind: 'file',
    size: overrides?.size ?? 100,
    hash: `hash-${id}`,
    createdAt: overrides?.createdAt ?? 1000,
    updatedAt: overrides?.createdAt ?? 1000,
    localId: null,
    addedAt: overrides?.addedAt ?? overrides?.createdAt ?? 1000,
    trashedAt: null,
    deletedAt: null,
  })
  if (overrides?.directoryId) {
    await db().runAsync(
      'UPDATE files SET directoryId = ? WHERE id = ?',
      overrides.directoryId,
      id,
    )
  }
}

describe('buildLibraryQueryParts', () => {
  describe('tag filtering', () => {
    async function createFileWithTags(id: string, tagNames: string[]) {
      await createTestFile(id)
      for (const name of tagNames) {
        await addTagToFile(db(), id, name)
      }
    }

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
      await createTestFile('video-1', { type: 'video/mp4' })
      await createTestFile('image-1', { type: 'image/jpeg' })
      await addTagToFile(db(), 'video-1', 'tag1')
      await addTagToFile(db(), 'image-1', 'tag1')

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

describe('library count queries', () => {
  test('queryLibraryFileCount counts active files', async () => {
    await createTestFile('f1')
    await createTestFile('f2')
    const count = await queryLibraryFileCount(db())
    expect(count).toBe(2)
  })

  test('queryMediaFileCount counts image/video/audio', async () => {
    await createTestFile('img', { type: 'image/jpeg' })
    await createTestFile('vid', { type: 'video/mp4' })
    await createTestFile('doc', { type: 'application/pdf' })
    const count = await queryMediaFileCount(db())
    expect(count).toBe(2)
  })

  test('queryTagFileCount counts files with tag', async () => {
    await createTestFile('f1')
    await createTestFile('f2')
    await addTagToFile(db(), 'f1', 'mytag')
    const tag = await db().getFirstAsync<{ id: string }>(
      "SELECT id FROM tags WHERE name = 'mytag'",
    )
    const count = await queryTagFileCount(db(), tag!.id)
    expect(count).toBe(1)
  })

  test('queryUnfiledFileCount counts files without directory', async () => {
    await createTestFile('f1')
    await createTestFile('f2')
    await db().runAsync(
      "INSERT INTO directories (id, name, createdAt) VALUES ('dir1', 'Folder', 1000)",
    )
    await db().runAsync("UPDATE files SET directoryId = 'dir1' WHERE id = 'f1'")
    const count = await queryUnfiledFileCount(db())
    expect(count).toBe(1)
  })

  test('queryDirectoryFileCount counts files in directory', async () => {
    await createTestFile('f1')
    await createTestFile('f2')
    await db().runAsync(
      "INSERT INTO directories (id, name, createdAt) VALUES ('dir1', 'Folder', 1000)",
    )
    await db().runAsync("UPDATE files SET directoryId = 'dir1' WHERE id = 'f1'")
    const count = await queryDirectoryFileCount(db(), 'dir1')
    expect(count).toBe(1)
  })

  test('queryDirectoryFileCount with UNFILED_DIRECTORY_ID returns unfiled', async () => {
    await createTestFile('f1')
    await createTestFile('f2')
    await db().runAsync(
      "INSERT INTO directories (id, name, createdAt) VALUES ('dir1', 'Folder', 1000)",
    )
    await db().runAsync("UPDATE files SET directoryId = 'dir1' WHERE id = 'f1'")
    const count = await queryDirectoryFileCount(db(), UNFILED_DIRECTORY_ID)
    expect(count).toBe(1)
  })
})

describe('queryFileCountWithFilters', () => {
  test('returns correct count with no filters', async () => {
    await createTestFile('f1', { createdAt: 1000 })
    await createTestFile('f2', { createdAt: 2000 })
    await createTestFile('f3', { createdAt: 3000 })
    const count = await queryFileCountWithFilters(db(), {})
    expect(count).toBe(3)
  })

  test('returns 0 for empty database', async () => {
    const count = await queryFileCountWithFilters(db(), {})
    expect(count).toBe(0)
  })

  test('filters by category', async () => {
    await createTestFile('img-1', { type: 'image/jpeg', createdAt: 1000 })
    await createTestFile('vid-1', { type: 'video/mp4', createdAt: 2000 })
    await createTestFile('img-2', { type: 'image/jpeg', createdAt: 3000 })

    const imageCount = await queryFileCountWithFilters(db(), {
      categories: ['Image'],
    })
    expect(imageCount).toBe(2)

    const videoCount = await queryFileCountWithFilters(db(), {
      categories: ['Video'],
    })
    expect(videoCount).toBe(1)
  })
})

describe('queryFilePositionInSortedList', () => {
  const base = 1000

  async function seedDateRecords() {
    await createTestFile('file-a', { createdAt: base })
    await createTestFile('file-b', { createdAt: base + 10 })
    await createTestFile('file-c', { createdAt: base + 20 })
    await createTestFile('file-d', { createdAt: base + 30 })
    await createTestFile('file-e', { createdAt: base + 40 })
  }

  async function seedNameRecords() {
    await createTestFile('id-3', { name: 'a.jpg', createdAt: base })
    await createTestFile('id-1', { name: 'b.jpg', createdAt: base + 10 })
    await createTestFile('id-5', { name: 'c.jpg', createdAt: base + 20 })
    await createTestFile('id-2', { name: 'd.jpg', createdAt: base + 30 })
    await createTestFile('id-4', { name: 'e.jpg', createdAt: base + 40 })
  }

  async function seedAddedRecords() {
    await createTestFile('file-a', { createdAt: base, addedAt: base + 40 })
    await createTestFile('file-b', {
      createdAt: base + 10,
      addedAt: base + 20,
    })
    await createTestFile('file-c', {
      createdAt: base + 20,
      addedAt: base + 30,
    })
    await createTestFile('file-d', { createdAt: base + 30, addedAt: base })
    await createTestFile('file-e', {
      createdAt: base + 40,
      addedAt: base + 10,
    })
  }

  async function seedSizeRecords() {
    await createTestFile('file-a', { createdAt: base, size: 500 })
    await createTestFile('file-b', { createdAt: base + 10, size: 200 })
    await createTestFile('file-c', { createdAt: base + 20, size: 800 })
    await createTestFile('file-d', { createdAt: base + 30, size: 100 })
    await createTestFile('file-e', { createdAt: base + 40, size: 1000 })
  }

  describe('DATE sorting (DESC)', () => {
    test('returns correct position for middle file', async () => {
      await seedDateRecords()
      const position = await queryFilePositionInSortedList(db(), 'file-c', {
        sortBy: 'DATE',
        sortDir: 'DESC',
      })
      expect(position).toBe(2)
    })

    test('returns 0 for first file', async () => {
      await seedDateRecords()
      const position = await queryFilePositionInSortedList(db(), 'file-e', {
        sortBy: 'DATE',
        sortDir: 'DESC',
      })
      expect(position).toBe(0)
    })

    test('returns last position for last file', async () => {
      await seedDateRecords()
      const position = await queryFilePositionInSortedList(db(), 'file-a', {
        sortBy: 'DATE',
        sortDir: 'DESC',
      })
      expect(position).toBe(4)
    })

    test('returns 0 for nonexistent file', async () => {
      await seedDateRecords()
      const position = await queryFilePositionInSortedList(
        db(),
        'nonexistent',
        { sortBy: 'DATE', sortDir: 'DESC' },
      )
      expect(position).toBe(0)
    })
  })

  describe('DATE sorting (ASC)', () => {
    test('returns correct position in ascending order', async () => {
      await seedDateRecords()
      const position = await queryFilePositionInSortedList(db(), 'file-c', {
        sortBy: 'DATE',
        sortDir: 'ASC',
      })
      expect(position).toBe(2)
    })

    test('returns 0 for first file in ASC', async () => {
      await seedDateRecords()
      const position = await queryFilePositionInSortedList(db(), 'file-a', {
        sortBy: 'DATE',
        sortDir: 'ASC',
      })
      expect(position).toBe(0)
    })
  })

  describe('NAME sorting (ASC)', () => {
    test('returns correct position in alphabetical order', async () => {
      await seedNameRecords()
      const position = await queryFilePositionInSortedList(db(), 'id-5', {
        sortBy: 'NAME',
        sortDir: 'ASC',
      })
      expect(position).toBe(2)
    })

    test('returns 0 for first alphabetical file', async () => {
      await seedNameRecords()
      const position = await queryFilePositionInSortedList(db(), 'id-3', {
        sortBy: 'NAME',
        sortDir: 'ASC',
      })
      expect(position).toBe(0)
    })
  })

  describe('NAME sorting (DESC)', () => {
    test('returns correct position in reverse alphabetical order', async () => {
      await seedNameRecords()
      const position = await queryFilePositionInSortedList(db(), 'id-5', {
        sortBy: 'NAME',
        sortDir: 'DESC',
      })
      expect(position).toBe(2)
    })
  })

  describe('ADDED sorting (DESC)', () => {
    test('returns correct position for middle file', async () => {
      await seedAddedRecords()
      const position = await queryFilePositionInSortedList(db(), 'file-b', {
        sortBy: 'ADDED',
        sortDir: 'DESC',
      })
      expect(position).toBe(2)
    })

    test('returns 0 for first file', async () => {
      await seedAddedRecords()
      const position = await queryFilePositionInSortedList(db(), 'file-a', {
        sortBy: 'ADDED',
        sortDir: 'DESC',
      })
      expect(position).toBe(0)
    })

    test('returns last position for last file', async () => {
      await seedAddedRecords()
      const position = await queryFilePositionInSortedList(db(), 'file-d', {
        sortBy: 'ADDED',
        sortDir: 'DESC',
      })
      expect(position).toBe(4)
    })
  })

  describe('SIZE sorting (DESC)', () => {
    test('returns correct position for middle file', async () => {
      await seedSizeRecords()
      const position = await queryFilePositionInSortedList(db(), 'file-a', {
        sortBy: 'SIZE',
        sortDir: 'DESC',
      })
      expect(position).toBe(2)
    })

    test('returns 0 for first file', async () => {
      await seedSizeRecords()
      const position = await queryFilePositionInSortedList(db(), 'file-e', {
        sortBy: 'SIZE',
        sortDir: 'DESC',
      })
      expect(position).toBe(0)
    })

    test('returns last position for last file', async () => {
      await seedSizeRecords()
      const position = await queryFilePositionInSortedList(db(), 'file-d', {
        sortBy: 'SIZE',
        sortDir: 'DESC',
      })
      expect(position).toBe(4)
    })
  })

  describe('tie-breaking by ID', () => {
    test('breaks DATE ties using ID', async () => {
      await createTestFile('file-c', { createdAt: base })
      await createTestFile('file-a', { createdAt: base })
      await createTestFile('file-b', { createdAt: base })

      const positionC = await queryFilePositionInSortedList(db(), 'file-c', {
        sortBy: 'DATE',
        sortDir: 'DESC',
      })
      const positionB = await queryFilePositionInSortedList(db(), 'file-b', {
        sortBy: 'DATE',
        sortDir: 'DESC',
      })
      const positionA = await queryFilePositionInSortedList(db(), 'file-a', {
        sortBy: 'DATE',
        sortDir: 'DESC',
      })

      expect(positionC).toBe(0)
      expect(positionB).toBe(1)
      expect(positionA).toBe(2)
    })

    test('breaks NAME ties using ID', async () => {
      await createTestFile('file-c', { name: 'same.jpg', createdAt: base })
      await createTestFile('file-a', {
        name: 'same.jpg',
        createdAt: base + 10,
      })
      await createTestFile('file-b', {
        name: 'same.jpg',
        createdAt: base + 20,
      })

      const positionA = await queryFilePositionInSortedList(db(), 'file-a', {
        sortBy: 'NAME',
        sortDir: 'ASC',
      })
      const positionB = await queryFilePositionInSortedList(db(), 'file-b', {
        sortBy: 'NAME',
        sortDir: 'ASC',
      })
      const positionC = await queryFilePositionInSortedList(db(), 'file-c', {
        sortBy: 'NAME',
        sortDir: 'ASC',
      })

      expect(positionA).toBe(0)
      expect(positionB).toBe(1)
      expect(positionC).toBe(2)
    })
  })

  describe('category filtering', () => {
    test('returns correct position with category filter', async () => {
      await createTestFile('img-1', { type: 'image/jpeg', createdAt: base })
      await createTestFile('vid-1', { type: 'video/mp4', createdAt: base + 10 })
      await createTestFile('img-2', {
        type: 'image/jpeg',
        createdAt: base + 20,
      })
      await createTestFile('vid-2', {
        type: 'video/mp4',
        createdAt: base + 30,
      })
      await createTestFile('img-3', {
        type: 'image/jpeg',
        createdAt: base + 40,
      })

      const position = await queryFilePositionInSortedList(db(), 'img-2', {
        sortBy: 'DATE',
        sortDir: 'DESC',
        categories: ['Image'],
      })
      expect(position).toBe(1)
    })

    test('returns 0 when file filtered out by category', async () => {
      await createTestFile('img-1', { type: 'image/jpeg', createdAt: base })

      const position = await queryFilePositionInSortedList(db(), 'img-1', {
        sortBy: 'DATE',
        sortDir: 'DESC',
        categories: ['Video'],
      })
      expect(position).toBe(0)
    })
  })
})

describe('querySortedFileIds', () => {
  const base = 1000

  test('returns IDs in sort order', async () => {
    await createTestFile('file-a', { createdAt: base })
    await createTestFile('file-b', { createdAt: base + 10 })
    await createTestFile('file-c', { createdAt: base + 20 })
    await createTestFile('file-d', { createdAt: base + 30 })
    await createTestFile('file-e', { createdAt: base + 40 })

    const ids = await querySortedFileIds(
      db(),
      { sortBy: 'DATE', sortDir: 'DESC' },
      5,
      0,
    )
    expect(ids).toEqual(['file-e', 'file-d', 'file-c', 'file-b', 'file-a'])
  })

  test('respects limit and offset', async () => {
    await createTestFile('file-a', { createdAt: base })
    await createTestFile('file-b', { createdAt: base + 10 })
    await createTestFile('file-c', { createdAt: base + 20 })
    await createTestFile('file-d', { createdAt: base + 30 })
    await createTestFile('file-e', { createdAt: base + 40 })

    const ids = await querySortedFileIds(
      db(),
      { sortBy: 'DATE', sortDir: 'DESC' },
      2,
      1,
    )
    expect(ids).toEqual(['file-d', 'file-c'])
  })

  test('returns empty array for empty database', async () => {
    const ids = await querySortedFileIds(
      db(),
      { sortBy: 'DATE', sortDir: 'DESC' },
      10,
      0,
    )
    expect(ids).toEqual([])
  })

  test('returns IDs in ADDED sort order', async () => {
    await createTestFile('file-a', { createdAt: base, addedAt: base + 40 })
    await createTestFile('file-b', {
      createdAt: base + 10,
      addedAt: base + 20,
    })
    await createTestFile('file-c', {
      createdAt: base + 20,
      addedAt: base + 30,
    })
    await createTestFile('file-d', { createdAt: base + 30, addedAt: base })
    await createTestFile('file-e', {
      createdAt: base + 40,
      addedAt: base + 10,
    })

    const ids = await querySortedFileIds(
      db(),
      { sortBy: 'ADDED', sortDir: 'DESC' },
      5,
      0,
    )
    expect(ids).toEqual(['file-a', 'file-c', 'file-b', 'file-e', 'file-d'])
  })

  test('returns IDs in SIZE sort order', async () => {
    await createTestFile('file-a', { createdAt: base, size: 500 })
    await createTestFile('file-b', { createdAt: base + 10, size: 200 })
    await createTestFile('file-c', { createdAt: base + 20, size: 800 })
    await createTestFile('file-d', { createdAt: base + 30, size: 100 })
    await createTestFile('file-e', { createdAt: base + 40, size: 1000 })

    const ids = await querySortedFileIds(
      db(),
      { sortBy: 'SIZE', sortDir: 'DESC' },
      5,
      0,
    )
    expect(ids).toEqual(['file-e', 'file-c', 'file-a', 'file-b', 'file-d'])
  })
})

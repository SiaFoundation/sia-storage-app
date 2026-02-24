import { initializeDB, resetDb } from '../db'
import { createFileRecord, readFileRecord } from './files'
import {
  addTagToFile,
  addTagToFiles,
  createTag,
  deleteTag,
  getOrCreateTag,
  readAllTagsWithCounts,
  readIsFavorite,
  readTagNamesForFile,
  readTagsForFile,
  removeTagFromFile,
  searchTags,
  syncTagsFromMetadata,
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

describe('tags store', () => {
  beforeEach(async () => {
    await initializeDB()
  })

  afterEach(async () => {
    await resetDb()
    jest.clearAllMocks()
  })

  function userOnly<T extends { system: number }>(tags: T[]): T[] {
    return tags.filter((t) => !t.system)
  }

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
    })
  }

  describe('createTag', () => {
    test('creates tag with correct fields', async () => {
      const tag = await createTag('vacation')
      expect(tag.name).toBe('vacation')
      expect(tag.id).toBeDefined()
      expect(tag.createdAt).toBeDefined()
      expect(tag.usedAt).toBeDefined()
    })

    test('trims whitespace from name', async () => {
      const tag = await createTag('  travel  ')
      expect(tag.name).toBe('travel')
    })

    test('throws on empty name', async () => {
      await expect(createTag('')).rejects.toThrow('Tag name cannot be empty')
      await expect(createTag('   ')).rejects.toThrow('Tag name cannot be empty')
    })

    test('throws on duplicate name (case-insensitive)', async () => {
      await createTag('Work')
      await expect(createTag('work')).rejects.toThrow()
      await expect(createTag('WORK')).rejects.toThrow()
    })
  })

  describe('getOrCreateTag', () => {
    test('returns existing tag (case-insensitive match)', async () => {
      const original = await createTag('Travel')
      const found = await getOrCreateTag('travel')
      expect(found.id).toBe(original.id)
      expect(found.name).toBe('Travel')
    })

    test('creates new tag if not found', async () => {
      const tag = await getOrCreateTag('NewTag')
      expect(tag.name).toBe('NewTag')
      expect(tag.id).toBeDefined()
    })

    test('updates usedAt on existing tag', async () => {
      const original = await createTag('Beach')
      const originalUsedAt = original.usedAt

      await new Promise((r) => setTimeout(r, 10))

      const found = await getOrCreateTag('beach')
      expect(found.usedAt).toBeGreaterThan(originalUsedAt)
    })

    test('throws on empty name', async () => {
      await expect(getOrCreateTag('')).rejects.toThrow(
        'Tag name cannot be empty',
      )
    })
  })

  describe('searchTags', () => {
    test('returns matching tags ordered by usedAt', async () => {
      await createTag('vacation')
      await new Promise((r) => setTimeout(r, 10))
      await createTag('video')
      await new Promise((r) => setTimeout(r, 10))
      await createTag('vintage')

      const results = userOnly(await searchTags('v'))
      expect(results).toHaveLength(3)
      expect(results[0].name).toBe('vintage')
      expect(results[1].name).toBe('video')
      expect(results[2].name).toBe('vacation')
    })

    test('matches case-insensitively', async () => {
      await createTag('Work')
      const results = await searchTags('WORK')
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Work')
    })

    test('escapes special characters in query', async () => {
      await createTag('100%')
      await createTag('100_percent')

      const results = await searchTags('100%')
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('100%')
    })

    test('respects limit parameter', async () => {
      await createTag('tag1')
      await createTag('tag2')
      await createTag('tag3')

      const results = await searchTags('tag', 2)
      expect(results).toHaveLength(2)
    })

    test('returns empty array for no matches', async () => {
      await createTag('vacation')
      const results = await searchTags('xyz')
      expect(results).toEqual([])
    })

    test('returns all tags ordered by usedAt when query is empty', async () => {
      await createTag('aaa')
      await new Promise((r) => setTimeout(r, 10))
      await createTag('bbb')

      const results = userOnly(await searchTags(''))
      expect(results).toHaveLength(2)
      expect(results[0].name).toBe('bbb')
    })
  })

  describe('readTagsForFile', () => {
    test('returns tags for file ordered by name', async () => {
      await createTestFile('file-1')
      await addTagToFile('file-1', 'zebra')
      await addTagToFile('file-1', 'alpha')
      await addTagToFile('file-1', 'beta')

      const tags = userOnly(await readTagsForFile('file-1'))
      expect(tags).toHaveLength(3)
      expect(tags[0].name).toBe('alpha')
      expect(tags[1].name).toBe('beta')
      expect(tags[2].name).toBe('zebra')
    })

    test('returns empty array for file with no user tags', async () => {
      await createTestFile('file-1')
      const tags = userOnly(await readTagsForFile('file-1'))
      expect(tags).toHaveLength(0)
    })
  })

  describe('readTagNamesForFile', () => {
    test('returns tag names for file', async () => {
      await createTestFile('file-1')
      await addTagToFile('file-1', 'tag1')
      await addTagToFile('file-1', 'tag2')

      const names = await readTagNamesForFile('file-1')
      expect(names).toContain('tag1')
      expect(names).toContain('tag2')
    })

    test('returns undefined for file with no tags', async () => {
      await createTestFile('file-1')
      const names = await readTagNamesForFile('file-1')
      expect(names).toBeUndefined()
    })
  })

  describe('readAllTagsWithCounts', () => {
    test('returns all tags with correct file counts', async () => {
      await createTestFile('file-1')
      await createTestFile('file-2')

      await addTagToFile('file-1', 'shared')
      await addTagToFile('file-2', 'shared')
      await addTagToFile('file-1', 'unique')

      const tags = userOnly(await readAllTagsWithCounts())
      expect(tags).toHaveLength(2)

      const shared = tags.find((t) => t.name === 'shared')
      expect(shared?.fileCount).toBe(2)

      const unique = tags.find((t) => t.name === 'unique')
      expect(unique?.fileCount).toBe(1)
    })

    test('returns 0 count for unused tags', async () => {
      await createTag('orphan')
      const tags = userOnly(await readAllTagsWithCounts())
      expect(tags).toHaveLength(1)
      expect(tags[0].fileCount).toBe(0)
    })
  })

  describe('addTagToFile', () => {
    test('creates junction entry', async () => {
      await createTestFile('file-1')
      await addTagToFile('file-1', 'tag1')

      const tags = userOnly(await readTagsForFile('file-1'))
      expect(tags).toHaveLength(1)
      expect(tags[0].name).toBe('tag1')
    })

    test('creates new tag if name not found', async () => {
      await createTestFile('file-1')
      await addTagToFile('file-1', 'newTag')

      const tags = userOnly(await readTagsForFile('file-1'))
      expect(tags).toHaveLength(1)
      expect(tags[0].name).toBe('newTag')
    })

    test('ignores duplicate add (same file+tag)', async () => {
      await createTestFile('file-1')
      await addTagToFile('file-1', 'tag1')
      await addTagToFile('file-1', 'tag1')

      const tags = userOnly(await readTagsForFile('file-1'))
      expect(tags).toHaveLength(1)
    })

    test('uses existing tag (case-insensitive)', async () => {
      await createTestFile('file-1')
      await createTestFile('file-2')

      await addTagToFile('file-1', 'Work')
      await addTagToFile('file-2', 'work')

      const allTags = userOnly(await readAllTagsWithCounts())
      expect(allTags).toHaveLength(1)
      expect(allTags[0].fileCount).toBe(2)
    })

    test('bumps file updatedAt', async () => {
      await createTestFile('file-1')
      const before = await readFileRecord('file-1')
      expect(before!.updatedAt).toBe(1000)

      await addTagToFile('file-1', 'tag1')

      const after = await readFileRecord('file-1')
      expect(after!.updatedAt).toBeGreaterThan(1000)
    })
  })

  describe('addTagToFiles', () => {
    test('creates junction entries for all files', async () => {
      await createTestFile('file-1')
      await createTestFile('file-2')
      await createTestFile('file-3')
      await addTagToFiles(['file-1', 'file-2', 'file-3'], 'tag1')

      for (const id of ['file-1', 'file-2', 'file-3']) {
        const tags = userOnly(await readTagsForFile(id))
        expect(tags).toHaveLength(1)
        expect(tags[0].name).toBe('tag1')
      }
    })

    test('creates new tag if name not found', async () => {
      await createTestFile('file-1')
      await addTagToFiles(['file-1'], 'brandNew')

      const tags = userOnly(await readTagsForFile('file-1'))
      expect(tags).toHaveLength(1)
      expect(tags[0].name).toBe('brandNew')
    })

    test('ignores duplicate add (same file+tag)', async () => {
      await createTestFile('file-1')
      await addTagToFiles(['file-1', 'file-1'], 'tag1')

      const tags = userOnly(await readTagsForFile('file-1'))
      expect(tags).toHaveLength(1)
    })

    test('uses existing tag (case-insensitive)', async () => {
      await createTestFile('file-1')
      await createTestFile('file-2')
      await addTagToFile('file-1', 'Work')
      await addTagToFiles(['file-2'], 'work')

      const allTags = userOnly(await readAllTagsWithCounts())
      expect(allTags).toHaveLength(1)
      expect(allTags[0].fileCount).toBe(2)
    })

    test('bumps updatedAt for all files', async () => {
      await createTestFile('file-1')
      await createTestFile('file-2')

      await addTagToFiles(['file-1', 'file-2'], 'tag1')

      const f1 = await readFileRecord('file-1')
      const f2 = await readFileRecord('file-2')
      expect(f1!.updatedAt).toBeGreaterThan(1000)
      expect(f2!.updatedAt).toBeGreaterThan(1000)
    })

    test('handles empty array', async () => {
      await expect(addTagToFiles([], 'tag1')).resolves.not.toThrow()
    })
  })

  describe('removeTagFromFile', () => {
    test('removes junction entry', async () => {
      await createTestFile('file-1')
      await addTagToFile('file-1', 'tag1')
      await addTagToFile('file-1', 'tag2')

      const tagToRemove = (await readTagsForFile('file-1')).find(
        (t) => t.name === 'tag1',
      )!
      await removeTagFromFile('file-1', tagToRemove.id)

      const tags = userOnly(await readTagsForFile('file-1'))
      expect(tags).toHaveLength(1)
      expect(tags[0].name).toBe('tag2')
    })

    test('does not delete the tag itself', async () => {
      await createTestFile('file-1')
      await addTagToFile('file-1', 'tag1')

      const tag = userOnly(await readTagsForFile('file-1'))[0]
      await removeTagFromFile('file-1', tag.id)

      const allTags = await readAllTagsWithCounts()
      expect(allTags.find((t) => t.id === tag.id)).toBeDefined()
    })

    test('handles removing non-existent relationship', async () => {
      await createTestFile('file-1')
      await createTag('tag1')
      const tag = (await readAllTagsWithCounts())[0]

      await expect(removeTagFromFile('file-1', tag.id)).resolves.not.toThrow()
    })

    test('bumps file updatedAt', async () => {
      await createTestFile('file-1')
      await addTagToFile('file-1', 'tag1')

      const before = await readFileRecord('file-1')
      const beforeUpdatedAt = before!.updatedAt

      const tag = (await readTagsForFile('file-1'))[0]
      await removeTagFromFile('file-1', tag.id)

      const after = await readFileRecord('file-1')
      expect(after!.updatedAt).toBeGreaterThanOrEqual(beforeUpdatedAt)
    })
  })

  describe('syncTagsFromMetadata', () => {
    test('populates junction table from tag names', async () => {
      await createTestFile('file-1')
      await syncTagsFromMetadata('file-1', ['vacation', 'beach'])

      const tags = userOnly(await readTagsForFile('file-1'))
      expect(tags.map((t) => t.name).sort()).toEqual(['beach', 'vacation'])
    })

    test('creates new tags for unknown names', async () => {
      await createTestFile('file-1')
      await syncTagsFromMetadata('file-1', ['newTag1', 'newTag2'])

      const allTags = userOnly(await readAllTagsWithCounts())
      expect(allTags).toHaveLength(2)
    })

    test('clears existing user tags before sync', async () => {
      await createTestFile('file-1')
      await addTagToFile('file-1', 'oldTag')

      await syncTagsFromMetadata('file-1', ['newTag'])

      const tags = userOnly(await readTagsForFile('file-1'))
      expect(tags).toHaveLength(1)
      expect(tags[0].name).toBe('newTag')
    })

    test('handles empty tags array', async () => {
      await createTestFile('file-1')
      await addTagToFile('file-1', 'tag1')

      await syncTagsFromMetadata('file-1', [])

      const tags = userOnly(await readTagsForFile('file-1'))
      expect(tags).toHaveLength(0)
    })

    test('preserves system tags when clearing user tags', async () => {
      await createTestFile('file-1')
      await toggleFavorite('file-1')
      await addTagToFile('file-1', 'tag1')

      await syncTagsFromMetadata('file-1', [])

      const allTags = await readTagsForFile('file-1')
      const systemTags = allTags.filter((t) => t.system)
      expect(systemTags.length).toBe(1)
      expect(systemTags[0].name).toBe('Favorites')
    })

    test('preserves local tags when metadata tags are undefined', async () => {
      await createTestFile('file-1')
      await addTagToFile('file-1', 'tag1')

      await syncTagsFromMetadata('file-1', undefined)

      const tags = userOnly(await readTagsForFile('file-1'))
      expect(tags).toHaveLength(1)
      expect(tags[0].name).toBe('tag1')
    })

    test('clears user tags when metadata tags are empty array', async () => {
      await createTestFile('file-1')
      await addTagToFile('file-1', 'tag1')

      await syncTagsFromMetadata('file-1', [])

      const tags = userOnly(await readTagsForFile('file-1'))
      expect(tags).toHaveLength(0)
    })

    test('remote tags win when metadata has explicit tags', async () => {
      await createTestFile('file-1')
      await addTagToFile('file-1', 'localTag')

      await syncTagsFromMetadata('file-1', ['remoteTag1', 'remoteTag2'])

      const tags = userOnly(await readTagsForFile('file-1'))
      expect(tags.map((t) => t.name).sort()).toEqual([
        'remoteTag1',
        'remoteTag2',
      ])
    })

    test('local tags survive when metadata has no tag data', async () => {
      await createTestFile('file-1')
      await addTagToFile('file-1', 'localTag')

      await syncTagsFromMetadata('file-1', undefined)

      const tags = userOnly(await readTagsForFile('file-1'))
      expect(tags).toHaveLength(1)
      expect(tags[0].name).toBe('localTag')
    })

    test('explicit empty array removes all user tags', async () => {
      await createTestFile('file-1')
      await addTagToFile('file-1', 'tag1')
      await addTagToFile('file-1', 'tag2')

      await syncTagsFromMetadata('file-1', [])

      const tags = userOnly(await readTagsForFile('file-1'))
      expect(tags).toHaveLength(0)
    })
  })

  describe('favorites', () => {
    test('toggleFavorite adds and removes', async () => {
      await createTestFile('file-1')

      expect(await readIsFavorite('file-1')).toBe(false)

      await toggleFavorite('file-1')
      expect(await readIsFavorite('file-1')).toBe(true)

      await toggleFavorite('file-1')
      expect(await readIsFavorite('file-1')).toBe(false)
    })
  })

  describe('deleteTag', () => {
    test('deletes user tag', async () => {
      const tag = await createTag('myTag')
      await deleteTag(tag.id)
      const tags = userOnly(await readAllTagsWithCounts())
      expect(tags).toHaveLength(0)
    })

    test('prevents deleting system tags', async () => {
      await expect(deleteTag('sys:favorites')).rejects.toThrow(
        'System tags cannot be deleted',
      )
    })
  })
})

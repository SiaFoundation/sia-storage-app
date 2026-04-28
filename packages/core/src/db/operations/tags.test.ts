import { insertFile } from './files'
import {
  addTagToFile,
  addTagToFiles,
  deleteTag,
  ensureSystemTags,
  getOrCreateTag,
  insertTag,
  queryAllTagsWithCounts,
  queryIsFavorite,
  queryTagNamesForFile,
  queryTagsByPrefix,
  queryTagsForFile,
  removeTagFromFile,
  renameTag,
  SYSTEM_TAGS,
  syncManyTagsFromMetadata,
  syncTagsFromMetadata,
  toggleFavorite,
} from './tags'
import { db, setupTestDb, teardownTestDb } from './test-setup'

async function createTestFile(id: string) {
  await insertFile(db(), {
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

beforeEach(setupTestDb)
afterEach(teardownTestDb)

describe('ensureSystemTags', () => {
  it('creates Favorites system tag', async () => {
    await ensureSystemTags(db())
    const tags = await queryAllTagsWithCounts(db())
    const fav = tags.find((t) => t.id === SYSTEM_TAGS.favorites.id)
    expect(fav).toBeDefined()
    expect(fav!.name).toBe('Favorites')
    expect(fav!.system).toBe(1)
  })

  it('is idempotent', async () => {
    await ensureSystemTags(db())
    await ensureSystemTags(db())
    const tags = await queryAllTagsWithCounts(db())
    const favs = tags.filter((t) => t.id === SYSTEM_TAGS.favorites.id)
    expect(favs).toHaveLength(1)
  })
})

describe('insertTag', () => {
  it('creates tag with correct fields', async () => {
    const tag = await insertTag(db(), 'Travel')
    expect(tag.name).toBe('Travel')
    expect(tag.system).toBe(0)
    expect(tag.id).toBeDefined()
    expect(tag.createdAt).toBeGreaterThan(0)
    expect(tag.usedAt).toBeGreaterThan(0)
  })

  it('trims name', async () => {
    const tag = await insertTag(db(), '  Travel  ')
    expect(tag.name).toBe('Travel')
  })

  it('throws on empty name', async () => {
    await expect(insertTag(db(), '   ')).rejects.toThrow('Tag name cannot be empty')
  })

  it('allows same name with different case', async () => {
    await insertTag(db(), 'Travel')
    const tag = await insertTag(db(), 'travel')
    expect(tag.name).toBe('travel')
  })

  it('throws on exact duplicate name', async () => {
    await insertTag(db(), 'Travel')
    await expect(insertTag(db(), 'Travel')).rejects.toThrow('already exists')
  })
})

describe('getOrCreateTag', () => {
  it('creates separate tag for different case', async () => {
    const original = await insertTag(db(), 'Travel')
    const result = await getOrCreateTag(db(), 'travel')
    expect(result.id).not.toBe(original.id)
    expect(result.name).toBe('travel')
  })

  it('creates new tag if not found', async () => {
    const tag = await getOrCreateTag(db(), 'NewTag')
    expect(tag.name).toBe('NewTag')
    expect(tag.system).toBe(0)
  })

  it('throws on empty name', async () => {
    await expect(getOrCreateTag(db(), '  ')).rejects.toThrow('Tag name cannot be empty')
  })
})

describe('queryTagsForFile', () => {
  it('returns tags for file ordered by name', async () => {
    await createTestFile('f1')
    const _tagB = await insertTag(db(), 'Bravo')
    const _tagA = await insertTag(db(), 'Alpha')
    await addTagToFile(db(), 'f1', 'Bravo')
    await addTagToFile(db(), 'f1', 'Alpha')
    const tags = await queryTagsForFile(db(), 'f1')
    expect(tags.map((t) => t.name)).toEqual(['Alpha', 'Bravo'])
  })

  it('returns empty array if no tags', async () => {
    await createTestFile('f1')
    const tags = await queryTagsForFile(db(), 'f1')
    expect(tags).toEqual([])
  })
})

describe('queryTagNamesForFile', () => {
  it('returns names', async () => {
    await createTestFile('f1')
    await addTagToFile(db(), 'f1', 'Alpha')
    const names = await queryTagNamesForFile(db(), 'f1')
    expect(names).toEqual(['Alpha'])
  })

  it('returns undefined if no tags', async () => {
    await createTestFile('f1')
    const names = await queryTagNamesForFile(db(), 'f1')
    expect(names).toBeUndefined()
  })
})

describe('queryAllTagsWithCounts', () => {
  it('includes system tags', async () => {
    await ensureSystemTags(db())
    const tags = await queryAllTagsWithCounts(db())
    expect(tags.some((t) => t.system === 1)).toBe(true)
  })

  it('counts active files only', async () => {
    await createTestFile('f1')
    await createTestFile('f2')
    await addTagToFile(db(), 'f1', 'Tag1')
    await addTagToFile(db(), 'f2', 'Tag1')
    const tags = await queryAllTagsWithCounts(db())
    const tag1 = tags.find((t) => t.name === 'Tag1')
    expect(tag1!.fileCount).toBe(2)
  })

  it('returns 0 count for unused tags', async () => {
    await insertTag(db(), 'Orphan')
    const tags = await queryAllTagsWithCounts(db())
    const orphan = tags.find((t) => t.name === 'Orphan')
    expect(orphan!.fileCount).toBe(0)
  })

  it('excludes trashed files from count', async () => {
    await insertFile(db(), {
      id: 'trashed',
      name: 'trashed.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-trashed',
      createdAt: 1000,
      updatedAt: 1000,
      localId: null,
      addedAt: 1000,
      trashedAt: 2000,
      deletedAt: null,
    })
    await addTagToFile(db(), 'trashed', 'Tag1')
    const tags = await queryAllTagsWithCounts(db())
    const tag1 = tags.find((t) => t.name === 'Tag1')
    expect(tag1!.fileCount).toBe(0)
  })
})

describe('queryTagsByPrefix', () => {
  it('matches prefix (case-insensitive)', async () => {
    await insertTag(db(), 'Travel')
    await insertTag(db(), 'Trash')
    await insertTag(db(), 'Food')
    const results = await queryTagsByPrefix(db(), 'tra')
    expect(results.map((t) => t.name).sort()).toEqual(['Trash', 'Travel'])
  })

  it('returns all by usedAt when empty query', async () => {
    await insertTag(db(), 'Alpha')
    await insertTag(db(), 'Beta')
    const results = await queryTagsByPrefix(db(), '')
    expect(results.length).toBeGreaterThanOrEqual(2)
    const names = results.map((t) => t.name)
    expect(names).toContain('Alpha')
    expect(names).toContain('Beta')
  })

  it('respects limit', async () => {
    await insertTag(db(), 'A1')
    await insertTag(db(), 'A2')
    await insertTag(db(), 'A3')
    const results = await queryTagsByPrefix(db(), 'A', 2)
    expect(results).toHaveLength(2)
  })

  it('returns empty for no matches', async () => {
    await insertTag(db(), 'Travel')
    const results = await queryTagsByPrefix(db(), 'xyz')
    expect(results).toEqual([])
  })

  it('escapes LIKE special chars', async () => {
    await insertTag(db(), '100%done')
    await insertTag(db(), '100items')
    const results = await queryTagsByPrefix(db(), '100%')
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('100%done')
  })
})

describe('toggleFavorite', () => {
  beforeEach(async () => {
    await ensureSystemTags(db())
  })

  it('adds favorite when not favorited', async () => {
    await createTestFile('f1')
    await toggleFavorite(db(), 'f1')
    expect(await queryIsFavorite(db(), 'f1')).toBe(true)
  })

  it('removes favorite when already favorited', async () => {
    await createTestFile('f1')
    await toggleFavorite(db(), 'f1')
    await toggleFavorite(db(), 'f1')
    expect(await queryIsFavorite(db(), 'f1')).toBe(false)
  })

  it('bumps file updatedAt', async () => {
    await createTestFile('f1')
    await toggleFavorite(db(), 'f1')
    const row = await db().getFirstAsync<{ updatedAt: number }>(
      'SELECT updatedAt FROM files WHERE id = ?',
      'f1',
    )
    expect(row!.updatedAt).toBeGreaterThan(1000)
  })
})

describe('queryIsFavorite', () => {
  beforeEach(async () => {
    await ensureSystemTags(db())
  })

  it('returns true when favorited', async () => {
    await createTestFile('f1')
    await toggleFavorite(db(), 'f1')
    expect(await queryIsFavorite(db(), 'f1')).toBe(true)
  })

  it('returns false when not favorited', async () => {
    await createTestFile('f1')
    expect(await queryIsFavorite(db(), 'f1')).toBe(false)
  })
})

describe('renameTag', () => {
  it('renames and bumps file updatedAt', async () => {
    await createTestFile('f1')
    const tag = await insertTag(db(), 'OldName')
    await addTagToFile(db(), 'f1', 'OldName')
    await renameTag(db(), tag.id, 'NewName')
    const tags = await queryTagsForFile(db(), 'f1')
    expect(tags[0].name).toBe('NewName')
    const row = await db().getFirstAsync<{ updatedAt: number }>(
      'SELECT updatedAt FROM files WHERE id = ?',
      'f1',
    )
    expect(row!.updatedAt).toBeGreaterThan(1000)
  })

  it('throws on empty name', async () => {
    const tag = await insertTag(db(), 'Tag1')
    await expect(renameTag(db(), tag.id, '  ')).rejects.toThrow('Tag name cannot be empty')
  })

  it('throws on system tag', async () => {
    await ensureSystemTags(db())
    await expect(renameTag(db(), SYSTEM_TAGS.favorites.id, 'NewFav')).rejects.toThrow(
      'System tags cannot be renamed',
    )
  })

  it('throws on duplicate name', async () => {
    const tag = await insertTag(db(), 'Tag1')
    await insertTag(db(), 'Tag2')
    await expect(renameTag(db(), tag.id, 'Tag2')).rejects.toThrow('already exists')
  })

  it('no-ops if tag not found', async () => {
    await expect(renameTag(db(), 'nonexistent', 'Name')).resolves.toBeUndefined()
  })
})

describe('addTagToFile', () => {
  it('adds tag to file', async () => {
    await createTestFile('f1')
    await addTagToFile(db(), 'f1', 'Tag1')
    const tags = await queryTagsForFile(db(), 'f1')
    expect(tags).toHaveLength(1)
    expect(tags[0].name).toBe('Tag1')
  })

  it('creates tag if needed', async () => {
    await createTestFile('f1')
    await addTagToFile(db(), 'f1', 'BrandNew')
    const tags = await queryTagsByPrefix(db(), 'BrandNew')
    expect(tags).toHaveLength(1)
  })

  it('bumps file updatedAt', async () => {
    await createTestFile('f1')
    await addTagToFile(db(), 'f1', 'Tag1')
    const row = await db().getFirstAsync<{ updatedAt: number }>(
      'SELECT updatedAt FROM files WHERE id = ?',
      'f1',
    )
    expect(row!.updatedAt).toBeGreaterThan(1000)
  })

  it('ignores duplicate', async () => {
    await createTestFile('f1')
    await addTagToFile(db(), 'f1', 'Tag1')
    await addTagToFile(db(), 'f1', 'Tag1')
    const tags = await queryTagsForFile(db(), 'f1')
    expect(tags).toHaveLength(1)
  })

  it('treats different case as separate tags', async () => {
    await createTestFile('f1')
    await createTestFile('f2')
    await addTagToFile(db(), 'f1', 'Work')
    await addTagToFile(db(), 'f2', 'work')
    const tags = await queryAllTagsWithCounts(db())
    const upper = tags.find((t) => t.name === 'Work')
    const lower = tags.find((t) => t.name === 'work')
    expect(upper!.fileCount).toBe(1)
    expect(lower!.fileCount).toBe(1)
  })
})

describe('addTagToFiles', () => {
  it('adds to multiple files', async () => {
    await createTestFile('f1')
    await createTestFile('f2')
    await addTagToFiles(db(), ['f1', 'f2'], 'Shared')
    const t1 = await queryTagsForFile(db(), 'f1')
    const t2 = await queryTagsForFile(db(), 'f2')
    expect(t1).toHaveLength(1)
    expect(t2).toHaveLength(1)
    expect(t1[0].name).toBe('Shared')
  })

  it('handles empty array', async () => {
    await expect(addTagToFiles(db(), [], 'Tag1')).resolves.toBeUndefined()
  })
})

describe('removeTagFromFile', () => {
  it('removes tag and bumps file updatedAt', async () => {
    await createTestFile('f1')
    await addTagToFile(db(), 'f1', 'Tag1')
    const tags = await queryTagsForFile(db(), 'f1')
    await removeTagFromFile(db(), 'f1', tags[0].id)
    const after = await queryTagsForFile(db(), 'f1')
    expect(after).toHaveLength(0)
    const row = await db().getFirstAsync<{ updatedAt: number }>(
      'SELECT updatedAt FROM files WHERE id = ?',
      'f1',
    )
    expect(row!.updatedAt).toBeGreaterThan(1000)
  })

  it('does not delete the tag itself', async () => {
    await createTestFile('f1')
    await addTagToFile(db(), 'f1', 'Tag1')
    const tags = await queryTagsForFile(db(), 'f1')
    await removeTagFromFile(db(), 'f1', tags[0].id)
    const allTags = await queryAllTagsWithCounts(db())
    expect(allTags.find((t) => t.name === 'Tag1')).toBeDefined()
  })

  it('handles non-existent relationship gracefully', async () => {
    await createTestFile('f1')
    const tag = await insertTag(db(), 'Tag1')
    await expect(removeTagFromFile(db(), 'f1', tag.id)).resolves.toBeUndefined()
  })
})

describe('syncTagsFromMetadata', () => {
  it('clears user tags and sets from list', async () => {
    await createTestFile('f1')
    await addTagToFile(db(), 'f1', 'OldTag')
    await syncTagsFromMetadata(db(), 'f1', ['NewTag1', 'NewTag2'])
    const names = await queryTagNamesForFile(db(), 'f1')
    expect(names!.sort()).toEqual(['NewTag1', 'NewTag2'])
  })

  it('creates new tags for unknown names', async () => {
    await createTestFile('f1')
    await syncTagsFromMetadata(db(), 'f1', ['BrandNew1', 'BrandNew2'])
    const names = await queryTagNamesForFile(db(), 'f1')
    expect(names!.sort()).toEqual(['BrandNew1', 'BrandNew2'])
  })

  it('clears user tags when given empty array', async () => {
    await createTestFile('f1')
    await addTagToFile(db(), 'f1', 'Tag1')
    await addTagToFile(db(), 'f1', 'Tag2')
    await syncTagsFromMetadata(db(), 'f1', [])
    const names = await queryTagNamesForFile(db(), 'f1')
    expect(names).toBeUndefined()
  })

  it('remote tags replace local tags', async () => {
    await createTestFile('f1')
    await addTagToFile(db(), 'f1', 'LocalTag')
    await syncTagsFromMetadata(db(), 'f1', ['RemoteTag1', 'RemoteTag2'])
    const names = await queryTagNamesForFile(db(), 'f1')
    expect(names!.sort()).toEqual(['RemoteTag1', 'RemoteTag2'])
  })

  it('preserves system tags', async () => {
    await ensureSystemTags(db())
    await createTestFile('f1')
    await toggleFavorite(db(), 'f1')
    await syncTagsFromMetadata(db(), 'f1', ['UserTag'])
    const isFav = await queryIsFavorite(db(), 'f1')
    expect(isFav).toBe(true)
    const names = await queryTagNamesForFile(db(), 'f1')
    expect(names).toContain('UserTag')
    expect(names).toContain('Favorites')
  })

  it('preserves system tags when clearing user tags', async () => {
    await ensureSystemTags(db())
    await createTestFile('f1')
    await toggleFavorite(db(), 'f1')
    await addTagToFile(db(), 'f1', 'UserTag')
    await syncTagsFromMetadata(db(), 'f1', [])
    const isFav = await queryIsFavorite(db(), 'f1')
    expect(isFav).toBe(true)
    const names = await queryTagNamesForFile(db(), 'f1')
    expect(names).toEqual(['Favorites'])
  })

  it('no-ops on undefined', async () => {
    await createTestFile('f1')
    await addTagToFile(db(), 'f1', 'Existing')
    await syncTagsFromMetadata(db(), 'f1', undefined)
    const names = await queryTagNamesForFile(db(), 'f1')
    expect(names).toEqual(['Existing'])
  })
})

describe('deleteTag', () => {
  it('deletes tag and file_tags', async () => {
    await createTestFile('f1')
    const tag = await insertTag(db(), 'ToDelete')
    await addTagToFile(db(), 'f1', 'ToDelete')
    await deleteTag(db(), tag.id)
    const tags = await queryTagsForFile(db(), 'f1')
    expect(tags).toHaveLength(0)
    const all = await queryTagsByPrefix(db(), 'ToDelete')
    expect(all).toHaveLength(0)
  })

  it('throws on system tag', async () => {
    await ensureSystemTags(db())
    await expect(deleteTag(db(), SYSTEM_TAGS.favorites.id)).rejects.toThrow(
      'System tags cannot be deleted',
    )
  })
})

describe('syncManyTagsFromMetadata', () => {
  it('creates each unique tag exactly once across files', async () => {
    await createTestFile('f1')
    await createTestFile('f2')
    await syncManyTagsFromMetadata(db(), [
      { fileId: 'f1', tagNames: ['vacation', 'beach'] },
      { fileId: 'f2', tagNames: ['vacation', 'sunset'] },
    ])
    const all = await queryAllTagsWithCounts(db())
    const userTags = all
      .filter((t) => t.system === 0)
      .map((t) => t.name)
      .sort()
    expect(userTags).toEqual(['beach', 'sunset', 'vacation'])

    expect((await queryTagNamesForFile(db(), 'f1'))?.sort()).toEqual(['beach', 'vacation'])
    expect((await queryTagNamesForFile(db(), 'f2'))?.sort()).toEqual(['sunset', 'vacation'])
  })

  it('reuses existing tags rather than inserting duplicates', async () => {
    await getOrCreateTag(db(), 'vacation')
    await createTestFile('f1')
    await syncManyTagsFromMetadata(db(), [{ fileId: 'f1', tagNames: ['vacation', 'beach'] }])
    const all = await queryAllTagsWithCounts(db())
    const matches = all.filter((t) => t.name === 'vacation')
    expect(matches).toHaveLength(1)
  })

  it('updates usedAt for every tag in the batch', async () => {
    await createTestFile('f1')

    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'))
    await syncManyTagsFromMetadata(db(), [{ fileId: 'f1', tagNames: ['old'] }])

    jest.useFakeTimers().setSystemTime(new Date('2026-04-28T12:00:00Z'))
    await syncManyTagsFromMetadata(db(), [{ fileId: 'f1', tagNames: ['old', 'fresh'] }])

    const all = await queryAllTagsWithCounts(db())
    const old = all.find((t) => t.name === 'old')!
    const fresh = all.find((t) => t.name === 'fresh')!
    const expected = new Date('2026-04-28T12:00:00Z').getTime()
    expect(old.usedAt).toBe(expected)
    expect(fresh.usedAt).toBe(expected)

    jest.useRealTimers()
  })

  it('is idempotent on rerun', async () => {
    await createTestFile('f1')
    await syncManyTagsFromMetadata(db(), [{ fileId: 'f1', tagNames: ['a', 'b'] }])
    const before = (await queryTagNamesForFile(db(), 'f1'))?.sort()
    await syncManyTagsFromMetadata(db(), [{ fileId: 'f1', tagNames: ['a', 'b'] }])
    const after = (await queryTagNamesForFile(db(), 'f1'))?.sort()
    expect(after).toEqual(before)
  })

  it('skips empty/whitespace-only names', async () => {
    await createTestFile('f1')
    await syncManyTagsFromMetadata(db(), [{ fileId: 'f1', tagNames: ['', '  ', 'real'] }])
    const names = await queryTagNamesForFile(db(), 'f1')
    expect(names).toEqual(['real'])
  })
})

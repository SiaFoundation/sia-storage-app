import { insertFile, trashAllFileVersions } from './files'
import { insertObject } from './localObjects'
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
  removeTagFromFiles,
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
    hash: `sha256:hash-${id}`,
    createdAt: 1000,
    updatedAt: 1000,
    mediaAssetId: null,
    addedAt: 1000,
    trashedAt: null,
    deletedAt: null,
  })
}

// The dirty flag lives on objects, so a file needs an object before a mutation
// can flag it. Insert one with the flag cleared to observe a mutation set it.
async function createTestFileWithObject(id: string) {
  await createTestFile(id)
  await insertObject(db(), {
    fileId: id,
    indexerURL: 'https://idx.example.com',
    id: `obj-${id}`,
    slabs: [],
    encryptedDataKey: new ArrayBuffer(1),
    encryptedMetadataKey: new ArrayBuffer(1),
    encryptedMetadata: new ArrayBuffer(1),
    dataSignature: new ArrayBuffer(1),
    metadataSignature: new ArrayBuffer(1),
    createdAt: new Date(1000),
    updatedAt: new Date(1000),
  })
  await clearSyncUpFlag(id)
}

async function clearSyncUpFlag(fileId: string): Promise<void> {
  await db().runAsync('UPDATE objects SET needsSyncUp = 0 WHERE fileId = ?', fileId)
}

async function syncUpFlag(fileId: string): Promise<number> {
  return (
    (
      await db().getFirstAsync<{ needsSyncUp: number }>(
        'SELECT needsSyncUp FROM objects WHERE fileId = ?',
        fileId,
      )
    )?.needsSyncUp ?? 0
  )
}

beforeEach(setupTestDb)
afterEach(teardownTestDb)

// A version of `name` at the top of the library, with a clean object.
async function createVersion(id: string, name: string, updatedAt: number) {
  await insertFile(db(), {
    id,
    name,
    type: 'image/jpeg',
    kind: 'file',
    size: 100,
    hash: `sha256:hash-${id}`,
    createdAt: updatedAt,
    updatedAt,
    mediaAssetId: null,
    addedAt: updatedAt,
    trashedAt: null,
    deletedAt: null,
  })
  await insertObject(db(), {
    fileId: id,
    indexerURL: 'https://idx.example.com',
    id: `obj-${id}`,
    slabs: [],
    encryptedDataKey: new ArrayBuffer(1),
    encryptedMetadataKey: new ArrayBuffer(1),
    encryptedMetadata: new ArrayBuffer(1),
    dataSignature: new ArrayBuffer(1),
    metadataSignature: new ArrayBuffer(1),
    createdAt: new Date(updatedAt),
    updatedAt: new Date(updatedAt),
  })
}

async function stamps(): Promise<Record<string, { updatedAt: number; current: number }>> {
  const rows = await db().getAllAsync<{ id: string; updatedAt: number; current: number }>(
    'SELECT id, updatedAt, current FROM files',
  )
  return Object.fromEntries(rows.map((r) => [r.id, { updatedAt: r.updatedAt, current: r.current }]))
}

/** Ids of `name`'s live versions, newest first, the way the library orders them. */
async function versionOrder(name: string): Promise<string[]> {
  const rows = await db().getAllAsync<{ id: string }>(
    `SELECT id FROM files WHERE name = ? AND trashedAt IS NULL AND deletedAt IS NULL
     ORDER BY updatedAt DESC, id DESC`,
    name,
  )
  return rows.map((r) => r.id)
}

async function clearAllSyncUpFlags(): Promise<void> {
  await db().runAsync('UPDATE objects SET needsSyncUp = 0')
}

describe('needsSyncUp flagging', () => {
  it('addTagToFile, toggleFavorite, and removeTagFromFile each flag the file object', async () => {
    await createTestFileWithObject('f1')
    expect(await syncUpFlag('f1')).toBe(0)

    await addTagToFile(db(), 'f1', 'vacation')
    expect(await syncUpFlag('f1')).toBe(1)

    const tags = await queryTagsForFile(db(), 'f1')
    const vacation = tags.find((t) => t.name === 'vacation')!
    await clearSyncUpFlag('f1')
    await removeTagFromFile(db(), 'f1', vacation.id)
    expect(await syncUpFlag('f1')).toBe(1)

    await clearSyncUpFlag('f1')
    await toggleFavorite(db(), 'f1')
    expect(await syncUpFlag('f1')).toBe(1)
  })

  it('addTagToFiles and removeTagFromFiles flag every targeted file object', async () => {
    await createTestFileWithObject('a')
    await createTestFileWithObject('b')

    await addTagToFiles(db(), ['a', 'b'], 'trip')
    expect(await syncUpFlag('a')).toBe(1)
    expect(await syncUpFlag('b')).toBe(1)

    const tagId = (await queryTagsForFile(db(), 'a')).find((t) => t.name === 'trip')!.id
    await clearSyncUpFlag('a')
    await clearSyncUpFlag('b')
    await removeTagFromFiles(db(), ['a', 'b'], tagId)
    expect(await syncUpFlag('a')).toBe(1)
    expect(await syncUpFlag('b')).toBe(1)
  })

  it('renameTag flags objects of every file carrying the tag', async () => {
    await createTestFileWithObject('f1')
    const tag = await insertTag(db(), 'OldName')
    await addTagToFile(db(), 'f1', 'OldName')
    await clearSyncUpFlag('f1')

    await renameTag(db(), tag.id, 'NewName')
    expect(await syncUpFlag('f1')).toBe(1)
  })

  it('deleteTag flags objects of every file carrying the tag', async () => {
    await createTestFileWithObject('f1')
    const tag = await insertTag(db(), 'Doomed')
    await addTagToFile(db(), 'f1', 'Doomed')
    await clearSyncUpFlag('f1')

    await deleteTag(db(), tag.id)
    expect(await syncUpFlag('f1')).toBe(1)
  })
})

describe("tag changes keep each file's versions in order", () => {
  // Ids sort against the save order, so a tie on updatedAt would put the
  // older version first and a test would see it.
  beforeEach(async () => {
    await ensureSystemTags(db())
    await createVersion('c-v1', 'photo.jpg', 1000)
    await createVersion('b-v2', 'photo.jpg', 2000)
    await createVersion('a-v3', 'photo.jpg', 3000)
    await clearAllSyncUpFlags()
  })

  it('renaming a tag only an older version carries stamps it below the newer version and leaves that one alone', async () => {
    const tag = await insertTag(db(), 'trip')
    await addTagToFile(db(), 'b-v2', 'trip')
    await clearAllSyncUpFlags()
    const before = await stamps()

    await renameTag(db(), tag.id, 'holiday')

    const after = await stamps()
    expect(await versionOrder('photo.jpg')).toEqual(['a-v3', 'b-v2', 'c-v1'])
    expect(after['a-v3'].current).toBe(1)
    expect(after['b-v2'].updatedAt).toBeGreaterThan(before['b-v2'].updatedAt)
    expect(after['b-v2'].updatedAt).toBeLessThan(before['a-v3'].updatedAt)
    expect(after['a-v3'].updatedAt).toBe(before['a-v3'].updatedAt)
    expect(after['c-v1'].updatedAt).toBe(before['c-v1'].updatedAt)
    expect(await syncUpFlag('a-v3')).toBe(0)
    expect(await syncUpFlag('b-v2')).toBe(1)
    expect(await syncUpFlag('c-v1')).toBe(0)
  })

  it('favoriting an older version again and again keeps finding room below the newer version', async () => {
    const before = await stamps()
    let last = before['b-v2'].updatedAt

    for (let n = 0; n < 5; n++) {
      await toggleFavorite(db(), 'b-v2')
      const after = await stamps()
      expect(after['b-v2'].updatedAt).toBeGreaterThan(last)
      expect(after['a-v3'].updatedAt).toBe(before['a-v3'].updatedAt)
      last = after['b-v2'].updatedAt
    }
    expect(await syncUpFlag('a-v3')).toBe(0)
  })

  it('an older version with no room below the newer one lifts the newer one just above it', async () => {
    await db().runAsync('UPDATE files SET updatedAt = 2001 WHERE id = ?', 'a-v3')

    await toggleFavorite(db(), 'b-v2')

    const after = await stamps()
    expect(await versionOrder('photo.jpg')).toEqual(['a-v3', 'b-v2', 'c-v1'])
    expect(after['b-v2'].updatedAt).toBeGreaterThan(2000)
    expect(after['a-v3'].updatedAt).toBeGreaterThan(after['b-v2'].updatedAt)
    expect(after['c-v1'].updatedAt).toBe(1000)
    expect(await syncUpFlag('a-v3')).toBe(1)
    expect(await syncUpFlag('c-v1')).toBe(0)
  })

  it('an older version tied on updatedAt with the newer one moves both apart in their order', async () => {
    // Equal stamps order by id, and a-v3 sorts below b-v2, so tie b-v2 with c-v1 instead.
    await db().runAsync('UPDATE files SET updatedAt = 1000 WHERE id = ?', 'b-v2')
    expect(await versionOrder('photo.jpg')).toEqual(['a-v3', 'c-v1', 'b-v2'])

    await toggleFavorite(db(), 'b-v2')

    const after = await stamps()
    expect(await versionOrder('photo.jpg')).toEqual(['a-v3', 'c-v1', 'b-v2'])
    expect(after['c-v1'].updatedAt).toBeGreaterThan(after['b-v2'].updatedAt)
    expect(after['b-v2'].updatedAt).toBeGreaterThan(1000)
    expect(after['a-v3'].updatedAt).toBe(3000)
  })

  it('deleting a tag every version carries keeps the newest version current', async () => {
    const tag = await insertTag(db(), 'trip')
    await addTagToFiles(db(), ['a-v3', 'b-v2', 'c-v1'], 'trip')
    await clearAllSyncUpFlags()
    const before = await stamps()

    await deleteTag(db(), tag.id)

    const after = await stamps()
    expect(await versionOrder('photo.jpg')).toEqual(['a-v3', 'b-v2', 'c-v1'])
    expect(after['a-v3'].current).toBe(1)
    for (const id of ['a-v3', 'b-v2', 'c-v1']) {
      expect(after[id].updatedAt).toBeGreaterThan(before[id].updatedAt)
      expect(await syncUpFlag(id)).toBe(1)
    }
  })

  it('tagging, untagging and favoriting an older version keeps the newest version current', async () => {
    await addTagToFile(db(), 'c-v1', 'trip')
    expect(await versionOrder('photo.jpg')).toEqual(['a-v3', 'b-v2', 'c-v1'])

    const tagId = (await queryTagsForFile(db(), 'c-v1'))[0].id
    await removeTagFromFile(db(), 'c-v1', tagId)
    expect(await versionOrder('photo.jpg')).toEqual(['a-v3', 'b-v2', 'c-v1'])

    await addTagToFiles(db(), ['b-v2'], 'trip')
    await removeTagFromFiles(db(), ['b-v2'], tagId)
    await toggleFavorite(db(), 'c-v1')
    expect(await versionOrder('photo.jpg')).toEqual(['a-v3', 'b-v2', 'c-v1'])
    expect((await stamps())['a-v3'].current).toBe(1)
  })

  it('favoriting the newest version leaves the older versions unstamped and unflagged', async () => {
    const before = await stamps()

    await toggleFavorite(db(), 'a-v3')

    const after = await stamps()
    expect(after['a-v3'].updatedAt).toBeGreaterThan(before['a-v3'].updatedAt)
    expect(after['b-v2'].updatedAt).toBe(before['b-v2'].updatedAt)
    expect(after['c-v1'].updatedAt).toBe(before['c-v1'].updatedAt)
    expect(await syncUpFlag('a-v3')).toBe(1)
    expect(await syncUpFlag('b-v2')).toBe(0)
  })

  it('a newest version stamped in the future keeps its stamp above the stamped older one', async () => {
    const future = Date.now() + 60_000
    await db().runAsync('UPDATE files SET updatedAt = ? WHERE id = ?', future, 'a-v3')

    await toggleFavorite(db(), 'b-v2')

    const after = await stamps()
    expect(after['a-v3'].updatedAt).toBe(future)
    expect(after['b-v2'].updatedAt).toBeGreaterThan(2000)
    expect(await versionOrder('photo.jpg')).toEqual(['a-v3', 'b-v2', 'c-v1'])
  })

  it('favoriting the newest version when its stamp is ahead of the clock moves it one past that stamp', async () => {
    const future = Date.now() + 60_000
    await db().runAsync('UPDATE files SET updatedAt = ? WHERE id = ?', future, 'a-v3')

    await toggleFavorite(db(), 'a-v3')

    expect((await stamps())['a-v3'].updatedAt).toBe(future + 1)
  })

  it('a tag change on another file leaves the versions of this one alone', async () => {
    await createVersion('other', 'other.jpg', 5000)
    await clearAllSyncUpFlags()
    const before = await stamps()

    await addTagToFile(db(), 'other', 'trip')

    const after = await stamps()
    for (const id of ['a-v3', 'b-v2', 'c-v1']) {
      expect(after[id].updatedAt).toBe(before[id].updatedAt)
      expect(await syncUpFlag(id)).toBe(0)
    }
  })

  it('renaming a tag an older trashed version carries keeps the versions in order for restore', async () => {
    const tag = await insertTag(db(), 'trip')
    await addTagToFile(db(), 'c-v1', 'trip')
    await trashAllFileVersions(db(), 'photo.jpg', null)
    const trashedOrder = async () =>
      (
        await db().getAllAsync<{ id: string }>(
          'SELECT id FROM files WHERE trashedAt IS NOT NULL ORDER BY updatedAt DESC, id DESC',
        )
      ).map((r) => r.id)
    expect(await trashedOrder()).toEqual(['a-v3', 'b-v2', 'c-v1'])
    await clearAllSyncUpFlags()

    await renameTag(db(), tag.id, 'holiday')

    expect(await trashedOrder()).toEqual(['a-v3', 'b-v2', 'c-v1'])
    expect(await syncUpFlag('c-v1')).toBe(1)
  })
})

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
      hash: 'sha256:hash-trashed',
      createdAt: 1000,
      updatedAt: 1000,
      mediaAssetId: null,
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

  it('matches a decomposed prefix against a tag stored composed', async () => {
    await insertTag(db(), 'Été'.normalize('NFC'))
    const results = await queryTagsByPrefix(db(), 'Ét'.normalize('NFD'))
    expect(results.map((t) => t.name)).toEqual(['Été'.normalize('NFC')])
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

  it('keeps a file favorited when the list names Favorites', async () => {
    await ensureSystemTags(db())
    await createTestFile('f1')
    await toggleFavorite(db(), 'f1')
    await syncTagsFromMetadata(db(), 'f1', ['Favorites', 'UserTag'])
    expect(await queryIsFavorite(db(), 'f1')).toBe(true)
    expect(await queryTagNamesForFile(db(), 'f1')).toEqual(['Favorites', 'UserTag'])
  })

  it('unfavorites a file when the list leaves out Favorites', async () => {
    await ensureSystemTags(db())
    await createTestFile('f1')
    await toggleFavorite(db(), 'f1')
    await addTagToFile(db(), 'f1', 'UserTag')
    await syncTagsFromMetadata(db(), 'f1', ['UserTag'])
    expect(await queryIsFavorite(db(), 'f1')).toBe(false)
    expect(await queryTagNamesForFile(db(), 'f1')).toEqual(['UserTag'])
  })

  it('unfavorites a file when the list is empty', async () => {
    await ensureSystemTags(db())
    await createTestFile('f1')
    await toggleFavorite(db(), 'f1')
    await syncTagsFromMetadata(db(), 'f1', [])
    expect(await queryIsFavorite(db(), 'f1')).toBe(false)
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

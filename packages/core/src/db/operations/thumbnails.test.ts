import { insertFileRecord } from './files'
import { db, setupTestDb, teardownTestDb } from './test-setup'
import {
  queryBestThumbnailByFileId,
  queryThumbnailExistsForFileIdAndSize,
  queryThumbnailFileInfoByFileIds,
  queryThumbnailSizesForFileId,
  queryThumbnailsByFileId,
} from './thumbnails'

async function createTestFile(id: string, overrides?: Record<string, any>) {
  await insertFileRecord(db(), {
    id,
    name: `${id}.jpg`,
    type: 'image/jpeg',
    kind: 'file',
    size: 100,
    hash: `hash-${id}`,
    createdAt: 1000,
    updatedAt: 1000,
    localId: `local-${id}`,
    addedAt: 1000,
    trashedAt: null,
    deletedAt: null,
    ...overrides,
  })
}

async function createThumbnail(id: string, parentId: string, thumbSize: 64 | 512) {
  await insertFileRecord(db(), {
    id,
    name: `${id}.jpg`,
    type: 'image/jpeg',
    kind: 'thumb',
    size: 50,
    hash: `hash-${id}`,
    createdAt: 1000,
    updatedAt: 1000,
    localId: null,
    addedAt: 1000,
    trashedAt: null,
    deletedAt: null,
    thumbForId: parentId,
    thumbSize,
  })
}

beforeEach(setupTestDb)
afterEach(teardownTestDb)

describe('queryThumbnailsByFileId', () => {
  it('returns thumbnails ordered by size', async () => {
    await createTestFile('f1')
    await createThumbnail('t1', 'f1', 512)
    await createThumbnail('t2', 'f1', 64)

    const thumbs = await queryThumbnailsByFileId(db(), 'f1')
    expect(thumbs).toHaveLength(2)
    expect(thumbs[0].thumbSize).toBe(64)
    expect(thumbs[1].thumbSize).toBe(512)
  })

  it('returns empty for no thumbnails', async () => {
    await createTestFile('f1')
    const thumbs = await queryThumbnailsByFileId(db(), 'f1')
    expect(thumbs).toEqual([])
  })
})

describe('queryThumbnailSizesForFileId', () => {
  it('returns sorted size array', async () => {
    await createTestFile('f1')
    await createThumbnail('t1', 'f1', 512)
    await createThumbnail('t2', 'f1', 64)

    const sizes = await queryThumbnailSizesForFileId(db(), 'f1')
    expect(sizes).toEqual([64, 512])
  })

  it('returns empty for no thumbnails', async () => {
    await createTestFile('f1')
    const sizes = await queryThumbnailSizesForFileId(db(), 'f1')
    expect(sizes).toEqual([])
  })
})

describe('queryThumbnailExistsForFileIdAndSize', () => {
  it('returns true when exists', async () => {
    await createTestFile('f1')
    await createThumbnail('t1', 'f1', 64)

    const exists = await queryThumbnailExistsForFileIdAndSize(db(), 'f1', 64)
    expect(exists).toBe(true)
  })

  it('returns false when not exists', async () => {
    await createTestFile('f1')

    const exists = await queryThumbnailExistsForFileIdAndSize(db(), 'f1', 64)
    expect(exists).toBe(false)
  })
})

describe('queryBestThumbnailByFileId', () => {
  it('returns largest thumb <= requested size', async () => {
    await createTestFile('f1')
    await createThumbnail('t1', 'f1', 64)
    await createThumbnail('t2', 'f1', 512)

    const best = await queryBestThumbnailByFileId(db(), 'f1', 512)
    expect(best).not.toBeNull()
    expect(best?.thumbSize).toBe(512)

    const bestSmall = await queryBestThumbnailByFileId(db(), 'f1', 64)
    expect(bestSmall).not.toBeNull()
    expect(bestSmall?.thumbSize).toBe(64)
  })

  it('returns null when none exist', async () => {
    await createTestFile('f1')

    const best = await queryBestThumbnailByFileId(db(), 'f1', 512)
    expect(best).toBeNull()
  })
})

describe('queryThumbnailFileInfoByFileIds', () => {
  it('returns id, type, localId for thumbnails of given file IDs', async () => {
    await createTestFile('f1')
    await createTestFile('f2')
    await createThumbnail('t1', 'f1', 64)
    await createThumbnail('t2', 'f2', 512)

    const infos = await queryThumbnailFileInfoByFileIds(db(), ['f1', 'f2'])
    expect(infos).toHaveLength(2)
    const ids = infos.map((i) => i.id).sort()
    expect(ids).toEqual(['t1', 't2'])
    expect(infos[0]).toHaveProperty('type')
    expect(infos[0]).toHaveProperty('localId')
  })

  it('returns empty for empty input', async () => {
    const infos = await queryThumbnailFileInfoByFileIds(db(), [])
    expect(infos).toEqual([])
  })
})

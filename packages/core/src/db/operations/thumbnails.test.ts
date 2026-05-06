import { insertFile } from './files'
import { upsertFsMeta } from './fs'
import { db, setupTestDb, teardownTestDb } from './test-setup'
import {
  queryBestThumbnailByFileId,
  queryThumbnailCandidatePage,
  queryThumbnailExistsForFileIdAndSize,
  queryThumbnailFileInfoByFileIds,
  queryThumbnailScanProgress,
  queryThumbnailSizesForFileId,
  queryThumbnailSizesForFileIds,
  queryThumbnailsByFileId,
} from './thumbnails'

const DEFAULT_ALLOWED = ['image/jpeg', 'image/png', 'video/mp4']

async function createTestFile(id: string, overrides?: Record<string, any>) {
  await insertFile(db(), {
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
  await upsertFsMeta(db(), { fileId: id, size: 100, addedAt: 1000, usedAt: 1000 })
}

async function createThumbnail(id: string, parentId: string, thumbSize: 64 | 512) {
  await insertFile(db(), {
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

describe('queryThumbnailSizesForFileIds', () => {
  it('returns a map of fileId to sorted sizes for each file', async () => {
    await createTestFile('f1')
    await createTestFile('f2')
    await createTestFile('f3')
    await createThumbnail('t1', 'f1', 512)
    await createThumbnail('t2', 'f1', 64)
    await createThumbnail('t3', 'f2', 64)

    const sizes = await queryThumbnailSizesForFileIds(db(), ['f1', 'f2', 'f3'])
    expect(sizes.get('f1')).toEqual([64, 512])
    expect(sizes.get('f2')).toEqual([64])
    expect(sizes.get('f3')).toEqual([])
  })

  it('returns an empty map when given no fileIds', async () => {
    const sizes = await queryThumbnailSizesForFileIds(db(), [])
    expect(sizes.size).toBe(0)
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

describe('queryThumbnailCandidatePage allowlist', () => {
  it('includes only files whose type is in allowedTypes', async () => {
    await createTestFile('jpeg', { type: 'image/jpeg' })
    await createTestFile('png', { type: 'image/png' })
    await createTestFile('raw', { type: 'image/x-canon-cr3' })
    await createTestFile('jxl', { type: 'image/jxl' })
    await createTestFile('mp4', { type: 'video/mp4' })
    await createTestFile('mkv', { type: 'video/x-matroska' })

    const rows = await queryThumbnailCandidatePage(db(), 10, undefined, DEFAULT_ALLOWED)
    const ids = rows.map((r) => r.id).sort()
    expect(ids).toEqual(['jpeg', 'mp4', 'png'])
  })

  it('returns no rows when allowedTypes is empty', async () => {
    await createTestFile('jpeg')
    const rows = await queryThumbnailCandidatePage(db(), 10, undefined, [])
    expect(rows).toEqual([])
  })

  it('skips files whose thumbnails are already complete', async () => {
    await createTestFile('jpeg')
    // 64 and 512 are the ThumbSizes (both must exist to be complete)
    await createThumbnail('thumb64', 'jpeg', 64)
    await createThumbnail('thumb512', 'jpeg', 512)
    const rows = await queryThumbnailCandidatePage(db(), 10, undefined, DEFAULT_ALLOWED)
    expect(rows).toEqual([])
  })
})

describe('queryThumbnailScanProgress', () => {
  it('counts only allowed types as originals', async () => {
    await createTestFile('jpeg')
    await createTestFile('raw', { type: 'image/x-canon-cr3' })
    await createTestFile('mp4', { type: 'video/mp4' })
    await createThumbnail('thumb', 'jpeg', 64)

    const progress = await queryThumbnailScanProgress(db(), DEFAULT_ALLOWED)
    expect(progress.originals).toBe(2)
    expect(progress.thumbs).toBe(1)
  })

  it('returns 0 originals when allowedTypes is empty (but still counts thumbs)', async () => {
    await createTestFile('jpeg')
    await createThumbnail('thumb', 'jpeg', 64)

    const progress = await queryThumbnailScanProgress(db(), [])
    expect(progress.originals).toBe(0)
    expect(progress.thumbs).toBe(1)
  })
})

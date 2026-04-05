import { ThumbSizes } from '@siastorage/core/types'
import { initializeDB, resetDb } from '../db'
import { app } from '../stores/appService'
import { getThumbnailScanner, runThumbnailScanner } from './thumbnailScanner'

let getFsFileUriMock: jest.SpyInstance
let generateMock: jest.SpyInstance
let generateVideoMock: jest.SpyInstance

const thumbData = new ArrayBuffer(100)
const thumbResult = { data: thumbData, mimeType: 'image/webp' }

beforeEach(async () => {
  getThumbnailScanner().reset()
  await initializeDB()
  jest.clearAllMocks()

  getFsFileUriMock = jest.spyOn(app().fs, 'getFileUri').mockResolvedValue('file://source.jpg')
  const { rnfsStat } = (global as unknown as { __rnfs: { rnfsStat: jest.Mock } }).__rnfs
  rnfsStat.mockResolvedValue({ size: 100 })

  generateMock = jest.spyOn(app().thumbnails, 'generate').mockResolvedValue(thumbResult)
  generateVideoMock = jest.spyOn(app().thumbnails, 'generateVideo').mockResolvedValue(thumbResult)
})

afterEach(async () => {
  await resetDb()
})

describe('thumbnailScanner', () => {
  it('returns early when no candidates found', async () => {
    const result = await runThumbnailScanner()
    expect(result.produced).toHaveLength(0)
    expect(result.attempts).toHaveLength(0)
    expect(result.skippedNoSource).toHaveLength(0)
  })

  it('skips files without source URI', async () => {
    const now = Date.now()
    await app().files.create({
      id: 'file1',
      name: 'test.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 1000,
      hash: 'hash1',
      createdAt: now,
      updatedAt: now,
      addedAt: now,
      localId: 'local-file1',
      trashedAt: null,
      deletedAt: null,
    })
    getFsFileUriMock.mockResolvedValue(null)
    const result = await runThumbnailScanner()
    expect(result.skippedNoSource).toEqual([{ fileId: 'file1', hash: 'hash1' }])
    expect(await app().files.queryCount({ limit: 100, order: 'ASC' })).toBe(1)
  })

  it('skips files that already have all thumbnail sizes', async () => {
    const now = Date.now()
    await app().files.create({
      id: 'file1',
      name: 'test.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 1000,
      hash: 'hash1',
      createdAt: now,
      updatedAt: now,
      addedAt: now,
      localId: 'local-file1',
      trashedAt: null,
      deletedAt: null,
    })
    for (const size of ThumbSizes) {
      await app().files.create({
        id: `thumb-${size}`,
        name: 'thumbnail.webp',
        type: 'image/webp',
        kind: 'thumb',
        size: 100,
        hash: `thumb-hash-${size}`,
        createdAt: now,
        updatedAt: now,
        addedAt: now,
        localId: null,
        thumbForId: 'file1',
        thumbSize: size,
        trashedAt: null,
        deletedAt: null,
      })
    }
    getFsFileUriMock.mockResolvedValue('file://test.jpg')
    const result = await runThumbnailScanner()
    expect(result.produced).toHaveLength(0)
    expect(result.attempts).toHaveLength(0)
    expect(result.skippedFullyCovered).toHaveLength(0)
    expect(await app().files.queryCount({ limit: 100, order: 'ASC' })).toBe(3)
  })

  it('generates a missing thumbnail (64px)', async () => {
    const now = Date.now()
    await app().files.create({
      id: 'file1',
      name: 'test.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 1000,
      hash: 'hash1',
      createdAt: now,
      updatedAt: now,
      addedAt: now,
      localId: 'local-file1',
      trashedAt: null,
      deletedAt: null,
    })
    for (const size of ThumbSizes) {
      if (size === 64) continue
      await app().files.create({
        id: `thumb-${size}`,
        name: 'thumbnail.webp',
        type: 'image/webp',
        kind: 'thumb',
        size: 100,
        hash: `thumb-hash-${size}`,
        createdAt: now,
        updatedAt: now,
        addedAt: now,
        localId: null,
        thumbForId: 'file1',
        thumbSize: size,
        trashedAt: null,
        deletedAt: null,
      })
    }
    getFsFileUriMock.mockResolvedValue('file://test.jpg')
    const result = await runThumbnailScanner()
    const producedSizes = result.produced
      .filter((p) => p.originalId === 'file1')
      .map((p) => p.size)
      .sort((a, b) => a - b)
    expect(producedSizes).toEqual([64])
    const sizes = await app().thumbnails.getSizesForFile('file1')
    expect(sizes).toEqual([...ThumbSizes].sort((a, b) => a - b))
    expect(await app().files.queryCount({ limit: 100, order: 'ASC' })).toBe(3)
  })

  it('pages past skipped candidates to find eligible originals', async () => {
    const now = Date.now()
    const noSourceIds = new Set<string>()
    for (let i = 0; i < 5; i++) {
      const id = `nosource-${i}`
      noSourceIds.add(id)
      await app().files.create({
        id,
        name: `no-source-${i}.jpg`,
        type: 'image/jpeg',
        kind: 'file',
        size: 1000,
        hash: `nosource-hash-${i}`,
        createdAt: now - i,
        updatedAt: now - i,
        addedAt: now - i,
        localId: `local-nosource-${i}`,
        trashedAt: null,
        deletedAt: null,
      })
    }

    for (let i = 0; i < 10; i++) {
      const id = `covered-${i}`
      await app().files.create({
        id,
        name: `covered-${i}.jpg`,
        type: 'image/jpeg',
        kind: 'file',
        size: 1000,
        hash: `covered-hash-${i}`,
        createdAt: now - 100 - i,
        updatedAt: now - 100 - i,
        addedAt: now - 100 - i,
        localId: `local-covered-${i}`,
        trashedAt: null,
        deletedAt: null,
      })
      for (const size of ThumbSizes) {
        await app().files.create({
          id: `${id}-thumb-${size}`,
          name: 'thumbnail.webp',
          type: 'image/webp',
          kind: 'thumb',
          size: 100,
          hash: `${id}-thumb-hash-${size}`,
          createdAt: now - 100 - i,
          updatedAt: now - 100 - i,
          addedAt: now - 100 - i,
          localId: null,
          thumbForId: `covered-${i}`,
          thumbSize: size,
          trashedAt: null,
          deletedAt: null,
        })
      }
    }

    await app().files.create({
      id: 'eligible-1',
      name: 'eligible.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 1000,
      hash: 'eligible-hash-1',
      createdAt: now - 500,
      updatedAt: now - 500,
      addedAt: now - 500,
      localId: 'local-eligible-1',
      trashedAt: null,
      deletedAt: null,
    })

    getFsFileUriMock.mockImplementation(async ({ id }: { id: string }) => {
      if (noSourceIds.has(id)) return null
      return 'file://source.jpg'
    })

    const result = await runThumbnailScanner()

    const producedForEligible = result.produced
      .filter((p) => p.originalId === 'eligible-1')
      .map((p) => p.size)
      .sort((a, b) => a - b)
    expect(producedForEligible).toEqual([...ThumbSizes].sort((a, b) => a - b))
    expect(result.skippedNoSource.map((s) => s.fileId).sort((a, b) => a.localeCompare(b))).toEqual(
      [...noSourceIds].sort((a, b) => a.localeCompare(b)),
    )
  })

  it('skips generation for an exact existing size', async () => {
    const now = Date.now()
    await app().files.create({
      id: 'file1',
      name: 'test.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 1000,
      hash: 'hash1',
      createdAt: now,
      updatedAt: now,
      addedAt: now,
      localId: null,
      trashedAt: null,
      deletedAt: null,
    })
    await app().files.create({
      id: 'thumb-64',
      name: 'thumbnail.webp',
      type: 'image/webp',
      kind: 'thumb',
      size: 100,
      hash: 'thumb-hash-64',
      createdAt: now,
      updatedAt: now,
      addedAt: now,
      localId: null,
      thumbForId: 'file1',
      thumbSize: 64,
      trashedAt: null,
      deletedAt: null,
    })
    getFsFileUriMock.mockResolvedValue('file://test.jpg')
    const result = await runThumbnailScanner()
    expect(result.produced.filter((p) => p.size === 64)).toHaveLength(0)
    expect(await app().files.queryCount({ limit: 100, order: 'ASC' })).toBe(3)
  })

  it('generates thumbnails for video files using captured frames', async () => {
    const now = Date.now()
    await app().files.create({
      id: 'video1',
      name: 'clip.mp4',
      type: 'video/mp4',
      kind: 'file',
      size: 5_000_000,
      hash: 'video-hash-1',
      createdAt: now,
      updatedAt: now,
      addedAt: now,
      localId: 'local-video1',
      trashedAt: null,
      deletedAt: null,
    })

    const result = await runThumbnailScanner()

    expect(generateVideoMock).toHaveBeenCalledTimes(ThumbSizes.length)
    const producedForVideo = result.produced
      .filter((p) => p.originalId === 'video1')
      .map((p) => p.size)
      .sort((a, b) => a - b)
    expect(producedForVideo).toEqual([...ThumbSizes].sort((a, b) => a - b))
    const sizes = await app().thumbnails.getSizesForFile('video1')
    expect(sizes).toEqual([...ThumbSizes].sort((a, b) => a - b))
  })

  it('limits production per tick (20)', async () => {
    const now = Date.now()
    for (let i = 0; i < 15; i++) {
      await app().files.create({
        id: `file${i}`,
        name: `test${i}.jpg`,
        type: 'image/jpeg',
        kind: 'file',
        size: 1000,
        hash: `hash${i}`,
        createdAt: now,
        updatedAt: now,
        addedAt: now,
        localId: `local-${i}`,
        trashedAt: null,
        deletedAt: null,
      })
    }
    getFsFileUriMock.mockResolvedValue('file://test.jpg')
    const result = await runThumbnailScanner()
    expect(result.produced).toHaveLength(20)
  })

  it('falls back to error when generation fails', async () => {
    const now = Date.now()
    await app().files.create({
      id: 'file1',
      name: 'test.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 1000,
      hash: 'hash1',
      createdAt: now,
      updatedAt: now,
      addedAt: now,
      localId: 'local-file1',
      trashedAt: null,
      deletedAt: null,
    })
    getFsFileUriMock.mockResolvedValue('file://test.jpg')
    generateMock.mockRejectedValue(new Error('Failed to get size'))
    const result = await runThumbnailScanner()
    expect(result.errors).toHaveLength(ThumbSizes.length)
    expect(result.errors[0]).toMatchObject({
      originalId: 'file1',
      originalHash: 'hash1',
      size: 64,
    })
  })

  it('stops immediately when signal is already aborted', async () => {
    const now = Date.now()
    await app().files.create({
      id: 'file1',
      name: 'test.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 1000,
      hash: 'hash1',
      createdAt: now,
      updatedAt: now,
      addedAt: now,
      localId: 'local-file1',
      trashedAt: null,
      deletedAt: null,
    })
    getFsFileUriMock.mockResolvedValue('file://test.jpg')

    const ac = new AbortController()
    ac.abort()
    const result = await runThumbnailScanner(ac.signal)
    expect(result.produced).toHaveLength(0)
    expect(result.processedCandidates).toBe(0)
    expect(generateMock).not.toHaveBeenCalled()
  })

  it('stops mid-scan when signal is aborted', async () => {
    const now = Date.now()
    for (let i = 0; i < 5; i++) {
      await app().files.create({
        id: `file${i}`,
        name: `test${i}.jpg`,
        type: 'image/jpeg',
        kind: 'file',
        size: 1000,
        hash: `hash${i}`,
        createdAt: now - i,
        updatedAt: now - i,
        addedAt: now - i,
        localId: `local-${i}`,
        trashedAt: null,
        deletedAt: null,
      })
    }
    getFsFileUriMock.mockResolvedValue('file://test.jpg')

    const ac = new AbortController()
    let generateCalls = 0
    generateMock.mockImplementation(async () => {
      generateCalls++
      if (generateCalls >= 2) ac.abort()
      return thumbResult
    })

    const result = await runThumbnailScanner(ac.signal)
    expect(result.produced.length).toBeGreaterThan(0)
    expect(result.produced.length).toBeLessThan(ThumbSizes.length * 5)
  })

  it('logs and continues when generation throws', async () => {
    const now = Date.now()
    await app().files.create({
      id: 'file1',
      name: 'test.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 1000,
      hash: 'hash1',
      createdAt: now,
      updatedAt: now,
      addedAt: now,
      localId: 'local-file1',
      trashedAt: null,
      deletedAt: null,
    })
    getFsFileUriMock.mockResolvedValue('file://test.jpg')
    generateMock.mockRejectedValue(new Error('Manipulation failed'))
    const result = await runThumbnailScanner()
    expect(result.errors).toHaveLength(ThumbSizes.length)
    expect(result.errors[0]).toMatchObject({
      originalId: 'file1',
      originalHash: 'hash1',
      size: 64,
    })
    const sizes = await app().thumbnails.getSizesForFile('file1')
    expect(sizes).not.toContain(64)
  })
})

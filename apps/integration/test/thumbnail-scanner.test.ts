import { ThumbSizes } from '@siastorage/core/types'
import { createTestApp, type TestApp } from './app'

let app: TestApp
let hashCounter: number

beforeEach(async () => {
  hashCounter = 0
  app = createTestApp(undefined, {
    fsIO: {},
    thumbnail: {},
    crypto: { sha256: async () => `thumb-hash-${++hashCounter}` },
    detectMimeType: async () => 'image/jpeg',
  })
  await app.start()
})

afterEach(async () => {
  await app.shutdown()
})

describe('ThumbnailScanner', () => {
  it('returns early when no candidates found', async () => {
    const result = await app.thumbnailScanner.runScan()
    expect(result.produced).toHaveLength(0)
    expect(result.attempts).toHaveLength(0)
    expect(result.skippedNoSource).toHaveLength(0)
  })

  it('skips files without source URI', async () => {
    const now = Date.now()
    const noSourceApp = createTestApp(undefined, {
      fsIO: {
        size: async () => ({ value: null, error: 'not_found' as const }),
      },
      thumbnail: {},
      crypto: { sha256: async () => `thumb-hash-${++hashCounter}` },
      detectMimeType: async () => 'image/jpeg',
    })
    await noSourceApp.start()

    await noSourceApp.createFileRecord({
      id: 'file1',
      name: 'test.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 1000,
      hash: 'hash1',
      createdAt: now,
      updatedAt: now,
      localId: 'local-file1',
    })

    const result = await noSourceApp.thumbnailScanner.runScan()
    expect(result.skippedNoSource).toEqual([{ fileId: 'file1', hash: 'hash1' }])
    await noSourceApp.shutdown()
  })

  it('skips files that already have all thumbnail sizes', async () => {
    const now = Date.now()
    await app.createFileRecord({
      id: 'file1',
      name: 'test.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 1000,
      hash: 'hash1',
      createdAt: now,
      updatedAt: now,
      localId: 'local-file1',
    })
    for (const size of ThumbSizes) {
      await app.createFileRecord({
        id: `thumb-${size}`,
        name: 'thumbnail.webp',
        type: 'image/webp',
        kind: 'thumb',
        size: 100,
        hash: `thumb-hash-${size}`,
        createdAt: now,
        updatedAt: now,
        localId: null,
        thumbForId: 'file1',
        thumbSize: size,
      })
    }
    const result = await app.thumbnailScanner.runScan()
    expect(result.produced).toHaveLength(0)
    expect(result.attempts).toHaveLength(0)
    expect(result.skippedFullyCovered).toHaveLength(0)
  })

  it('generates a missing thumbnail (64px)', async () => {
    const now = Date.now()
    await app.createFileRecord({
      id: 'file1',
      name: 'test.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 1000,
      hash: 'hash1',
      createdAt: now,
      updatedAt: now,
      localId: 'local-file1',
    })
    for (const size of ThumbSizes) {
      if (size === 64) continue
      await app.createFileRecord({
        id: `thumb-${size}`,
        name: 'thumbnail.webp',
        type: 'image/webp',
        kind: 'thumb',
        size: 100,
        hash: `thumb-hash-${size}`,
        createdAt: now,
        updatedAt: now,
        localId: null,
        thumbForId: 'file1',
        thumbSize: size,
      })
    }
    const result = await app.thumbnailScanner.runScan()
    const producedSizes = result.produced
      .filter((p) => p.originalId === 'file1')
      .map((p) => p.size)
      .sort((a, b) => a - b)
    expect(producedSizes).toEqual([64])
    const sizes = await app.app.thumbnails.getSizesForFile('file1')
    expect(sizes).toEqual([...ThumbSizes].sort((a, b) => a - b))
  })

  it('pages past skipped candidates to find eligible originals', async () => {
    const now = Date.now()
    const noSourceIds = new Set<string>()
    for (let i = 0; i < 5; i++) {
      noSourceIds.add(`nosource-${i}`)
    }

    const customApp = createTestApp(undefined, {
      fsIO: {
        size: async (fileId) =>
          noSourceIds.has(fileId)
            ? { value: null, error: 'not_found' as const }
            : { value: 1000 },
      },
      thumbnail: {},
      crypto: { sha256: async () => `thumb-hash-${++hashCounter}` },
      detectMimeType: async () => 'image/jpeg',
    })
    await customApp.start()

    for (let i = 0; i < 5; i++) {
      await customApp.createFileRecord({
        id: `nosource-${i}`,
        name: `no-source-${i}.jpg`,
        type: 'image/jpeg',
        kind: 'file',
        size: 1000,
        hash: `nosource-hash-${i}`,
        createdAt: now - i,
        updatedAt: now - i,
        addedAt: now - i,
        localId: `local-nosource-${i}`,
      })
    }

    for (let i = 0; i < 10; i++) {
      const id = `covered-${i}`
      await customApp.createFileRecord({
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
      })
      for (const size of ThumbSizes) {
        await customApp.createFileRecord({
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
        })
      }
    }

    await customApp.createFileRecord({
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
    })

    const result = await customApp.thumbnailScanner.runScan()

    const producedForEligible = result.produced
      .filter((p) => p.originalId === 'eligible-1')
      .map((p) => p.size)
      .sort((a, b) => a - b)
    expect(producedForEligible).toEqual([...ThumbSizes].sort((a, b) => a - b))
    expect(
      result.skippedNoSource
        .map((s) => s.fileId)
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual([...noSourceIds].sort((a, b) => a.localeCompare(b)))
    await customApp.shutdown()
  })

  it('skips generation for an exact existing size', async () => {
    const now = Date.now()
    await app.createFileRecord({
      id: 'file1',
      name: 'test.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 1000,
      hash: 'hash1',
      createdAt: now,
      updatedAt: now,
      localId: null,
    })
    await app.createFileRecord({
      id: 'thumb-64',
      name: 'thumbnail.webp',
      type: 'image/webp',
      kind: 'thumb',
      size: 100,
      hash: 'thumb-hash-64',
      createdAt: now,
      updatedAt: now,
      localId: null,
      thumbForId: 'file1',
      thumbSize: 64,
    })
    const result = await app.thumbnailScanner.runScan()
    expect(result.produced.filter((p) => p.size === 64)).toHaveLength(0)
  })

  it('generates thumbnails for video files', async () => {
    const now = Date.now()
    const videoAdapter = {
      generateImageThumbnail: jest.fn().mockResolvedValue({
        data: new ArrayBuffer(64),
        mimeType: 'image/webp',
      }),
      generateImageThumbnails: jest.fn().mockResolvedValue(new Map()),
      generateVideoThumbnail: jest.fn().mockResolvedValue({
        data: new ArrayBuffer(64),
        mimeType: 'image/webp',
      }),
    }
    const videoApp = createTestApp(undefined, {
      fsIO: {},
      thumbnail: videoAdapter,
      crypto: { sha256: async () => `thumb-hash-${++hashCounter}` },
      detectMimeType: async () => 'video/mp4',
    })
    await videoApp.start()

    await videoApp.createFileRecord({
      id: 'video1',
      name: 'clip.mp4',
      type: 'video/mp4',
      kind: 'file',
      size: 5_000_000,
      hash: 'video-hash-1',
      createdAt: now,
      updatedAt: now,
      localId: 'local-video1',
    })

    const result = await videoApp.thumbnailScanner.runScan()

    expect(videoAdapter.generateVideoThumbnail).toHaveBeenCalledTimes(
      ThumbSizes.length,
    )
    const producedForVideo = result.produced
      .filter((p) => p.originalId === 'video1')
      .map((p) => p.size)
      .sort((a, b) => a - b)
    expect(producedForVideo).toEqual([...ThumbSizes].sort((a, b) => a - b))
    const sizes = await videoApp.app.thumbnails.getSizesForFile('video1')
    expect(sizes).toEqual([...ThumbSizes].sort((a, b) => a - b))
    await videoApp.shutdown()
  })

  it('limits production per tick (20)', async () => {
    const now = Date.now()
    for (let i = 0; i < 15; i++) {
      await app.createFileRecord({
        id: `file${i}`,
        name: `test${i}.jpg`,
        type: 'image/jpeg',
        kind: 'file',
        size: 1000,
        hash: `hash${i}`,
        createdAt: now,
        updatedAt: now,
        localId: `local-${i}`,
      })
    }
    const result = await app.thumbnailScanner.runScan()
    expect(result.produced).toHaveLength(20)
  })

  it('stops immediately when signal is already aborted', async () => {
    const now = Date.now()
    await app.createFileRecord({
      id: 'file1',
      name: 'test.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 1000,
      hash: 'hash1',
      createdAt: now,
      updatedAt: now,
      localId: 'local-file1',
    })

    const ac = new AbortController()
    ac.abort()
    const result = await app.thumbnailScanner.runScan(ac.signal)
    expect(result.produced).toHaveLength(0)
    expect(result.processedCandidates).toBe(0)
  })

  it('stops mid-scan when signal is aborted', async () => {
    const now = Date.now()
    const ac = new AbortController()
    let calls = 0

    const abortApp = createTestApp(undefined, {
      fsIO: {},
      thumbnail: {
        async generateImageThumbnail() {
          calls++
          if (calls >= 2) ac.abort()
          return { data: new ArrayBuffer(64), mimeType: 'image/webp' }
        },
        async generateImageThumbnails() {
          return new Map()
        },
        async generateVideoThumbnail() {
          return { data: new ArrayBuffer(64), mimeType: 'image/webp' }
        },
      },
      crypto: { sha256: async () => `thumb-hash-${++hashCounter}` },
      detectMimeType: async () => 'image/jpeg',
    })
    await abortApp.start()

    for (let i = 0; i < 5; i++) {
      await abortApp.createFileRecord({
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
      })
    }

    const result = await abortApp.thumbnailScanner.runScan(ac.signal)
    expect(result.produced.length).toBeGreaterThan(0)
    expect(result.produced.length).toBeLessThan(ThumbSizes.length * 5)
    await abortApp.shutdown()
  })

  it('logs and continues when adapter throws', async () => {
    const now = Date.now()
    const errorApp = createTestApp(undefined, {
      fsIO: {},
      thumbnail: {
        async generateImageThumbnail() {
          throw new Error('Manipulation failed')
        },
        async generateImageThumbnails() {
          return new Map()
        },
        async generateVideoThumbnail() {
          throw new Error('Manipulation failed')
        },
      },
      crypto: { sha256: async () => `thumb-hash-${++hashCounter}` },
      detectMimeType: async () => 'image/jpeg',
    })
    await errorApp.start()

    await errorApp.createFileRecord({
      id: 'file1',
      name: 'test.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 1000,
      hash: 'hash1',
      createdAt: now,
      updatedAt: now,
      localId: 'local-file1',
    })

    const result = await errorApp.thumbnailScanner.runScan()
    expect(result.errors).toHaveLength(ThumbSizes.length)
    expect(result.errors[0]).toMatchObject({
      originalId: 'file1',
      originalHash: 'hash1',
      size: 64,
    })
    const sizes = await errorApp.app.thumbnails.getSizesForFile('file1')
    expect(sizes).not.toContain(64)
    await errorApp.shutdown()
  })
})

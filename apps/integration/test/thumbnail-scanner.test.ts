import type { DatabaseAdapter } from '@siastorage/core/adapters'
import { runMigrations } from '@siastorage/core/db'
import { coreMigrations, sortMigrations } from '@siastorage/core/db/migrations'
import {
  insertFileRecord,
  queryThumbnailSizesForFileId,
} from '@siastorage/core/db/operations'
import {
  type ThumbnailDeps,
  ThumbnailScanner,
} from '@siastorage/core/services/thumbnailScanner'
import { ThumbSizes } from '@siastorage/core/types'
import { createBetterSqlite3Database } from '@siastorage/node-adapters/database'

let db: DatabaseAdapter & { close(): void }
let scanner: ThumbnailScanner
let hashCounter: number

function createMockDeps(overrides?: Partial<ThumbnailDeps>): ThumbnailDeps {
  return {
    db,
    thumbnailAdapter: {
      async generateImageThumbnail() {
        return { data: new ArrayBuffer(64), mimeType: 'image/webp' }
      },
      async generateImageThumbnails(_sourcePath: string, sizes: number[]) {
        const results = new Map()
        for (const size of sizes) {
          results.set(size, {
            data: new ArrayBuffer(64),
            mimeType: 'image/webp',
          })
        }
        return results
      },
      async generateVideoThumbnail() {
        return { data: new ArrayBuffer(64), mimeType: 'image/webp' }
      },
    },
    async detectMimeType() {
      return 'image/jpeg'
    },
    async getFsFileUri() {
      return 'file://source.jpg'
    },
    async copyToFs(_file, data) {
      return {
        uri: 'file://thumb.webp',
        size: data.byteLength,
        hash: `thumb-hash-${++hashCounter}`,
      }
    },
    ...overrides,
  }
}

beforeEach(async () => {
  db = createBetterSqlite3Database()
  await runMigrations(db, sortMigrations(coreMigrations))
  scanner = new ThumbnailScanner()
  hashCounter = 0
})

afterEach(() => {
  scanner.reset()
  db.close()
})

describe('ThumbnailScanner', () => {
  it('returns early when no candidates found', async () => {
    scanner.initialize(createMockDeps())
    const result = await scanner.runScan()
    expect(result.produced).toHaveLength(0)
    expect(result.attempts).toHaveLength(0)
    expect(result.skippedNoSource).toHaveLength(0)
  })

  it('skips files without source URI', async () => {
    const now = Date.now()
    await insertFileRecord(db, {
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
    scanner.initialize(
      createMockDeps({
        async getFsFileUri() {
          return null
        },
      }),
    )
    const result = await scanner.runScan()
    expect(result.skippedNoSource).toEqual([{ fileId: 'file1', hash: 'hash1' }])
  })

  it('skips files that already have all thumbnail sizes', async () => {
    const now = Date.now()
    await insertFileRecord(db, {
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
      await insertFileRecord(db, {
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
    scanner.initialize(createMockDeps())
    const result = await scanner.runScan()
    expect(result.produced).toHaveLength(0)
    expect(result.attempts).toHaveLength(0)
    expect(result.skippedFullyCovered).toHaveLength(0)
  })

  it('generates a missing thumbnail (64px)', async () => {
    const now = Date.now()
    await insertFileRecord(db, {
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
      await insertFileRecord(db, {
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
    scanner.initialize(createMockDeps())
    const result = await scanner.runScan()
    const producedSizes = result.produced
      .filter((p) => p.originalId === 'file1')
      .map((p) => p.size)
      .sort((a, b) => a - b)
    expect(producedSizes).toEqual([64])
    const sizes = await queryThumbnailSizesForFileId(db, 'file1')
    expect(sizes).toEqual([...ThumbSizes].sort((a, b) => a - b))
  })

  it('pages past skipped candidates to find eligible originals', async () => {
    const now = Date.now()
    const noSourceIds = new Set<string>()
    for (let i = 0; i < 5; i++) {
      const id = `nosource-${i}`
      noSourceIds.add(id)
      await insertFileRecord(db, {
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
      await insertFileRecord(db, {
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
        await insertFileRecord(db, {
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

    await insertFileRecord(db, {
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

    scanner.initialize(
      createMockDeps({
        async getFsFileUri({ id }: { id: string }) {
          if (noSourceIds.has(id)) return null
          return 'file://source.jpg'
        },
      }),
    )

    const result = await scanner.runScan()

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
  })

  it('skips generation for an exact existing size', async () => {
    const now = Date.now()
    await insertFileRecord(db, {
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
    await insertFileRecord(db, {
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
    scanner.initialize(createMockDeps())
    const result = await scanner.runScan()
    expect(result.produced.filter((p) => p.size === 64)).toHaveLength(0)
  })

  it('generates thumbnails for video files', async () => {
    const now = Date.now()
    await insertFileRecord(db, {
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
    scanner.initialize(
      createMockDeps({
        thumbnailAdapter: videoAdapter,
        async detectMimeType() {
          return 'video/mp4'
        },
      }),
    )

    const result = await scanner.runScan()

    expect(videoAdapter.generateVideoThumbnail).toHaveBeenCalledTimes(
      ThumbSizes.length,
    )
    const producedForVideo = result.produced
      .filter((p) => p.originalId === 'video1')
      .map((p) => p.size)
      .sort((a, b) => a - b)
    expect(producedForVideo).toEqual([...ThumbSizes].sort((a, b) => a - b))
    const sizes = await queryThumbnailSizesForFileId(db, 'video1')
    expect(sizes).toEqual([...ThumbSizes].sort((a, b) => a - b))
  })

  it('limits production per tick (10)', async () => {
    const now = Date.now()
    for (let i = 0; i < 15; i++) {
      await insertFileRecord(db, {
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
    scanner.initialize(createMockDeps())
    const result = await scanner.runScan()
    expect(result.produced).toHaveLength(20)
  })

  it('stops immediately when signal is already aborted', async () => {
    const now = Date.now()
    await insertFileRecord(db, {
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
    const adapter = {
      generateImageThumbnail: jest.fn(),
      generateImageThumbnails: jest.fn(),
      generateVideoThumbnail: jest.fn(),
    }
    scanner.initialize(createMockDeps({ thumbnailAdapter: adapter }))

    const ac = new AbortController()
    ac.abort()
    const result = await scanner.runScan(ac.signal)
    expect(result.produced).toHaveLength(0)
    expect(result.processedCandidates).toBe(0)
    expect(adapter.generateImageThumbnail).not.toHaveBeenCalled()
  })

  it('stops mid-scan when signal is aborted', async () => {
    const now = Date.now()
    for (let i = 0; i < 5; i++) {
      await insertFileRecord(db, {
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

    const ac = new AbortController()
    let calls = 0
    scanner.initialize(
      createMockDeps({
        thumbnailAdapter: {
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
      }),
    )

    const result = await scanner.runScan(ac.signal)
    expect(result.produced.length).toBeGreaterThan(0)
    expect(result.produced.length).toBeLessThan(ThumbSizes.length * 5)
  })

  it('logs and continues when adapter throws', async () => {
    const now = Date.now()
    await insertFileRecord(db, {
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
    scanner.initialize(
      createMockDeps({
        thumbnailAdapter: {
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
      }),
    )
    const result = await scanner.runScan()
    expect(result.errors).toHaveLength(ThumbSizes.length)
    expect(result.errors[0]).toMatchObject({
      originalId: 'file1',
      originalHash: 'hash1',
      size: 64,
    })
    const sizes = await queryThumbnailSizesForFileId(db, 'file1')
    expect(sizes).not.toContain(64)
  })
})

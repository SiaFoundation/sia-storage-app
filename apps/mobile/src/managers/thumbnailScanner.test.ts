import {
  ImageManipulator,
  type ImageManipulatorContext,
} from 'expo-image-manipulator'
import * as VideoThumbnails from 'expo-video-thumbnails'
import { Image } from 'react-native'
import { initializeDB, resetDb } from '../db'
import { calculateContentHash } from '../lib/contentHash'
import {
  createFileRecord,
  readAllFileRecordsCount,
  ThumbSizes,
} from '../stores/files'
import { getFsFileUri } from '../stores/fs'
import { readThumbnailSizesForFileId } from '../stores/thumbnails'
import { getThumbnailScanner, runThumbnailScanner } from './thumbnailScanner'

jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { WEBP: 'webp' },
}))
jest.mock('expo-video-thumbnails', () => ({
  getThumbnailAsync: jest.fn(),
}))
jest.mock('../lib/contentHash', () => ({ calculateContentHash: jest.fn() }))

const getFsFileUriMock = jest.mocked(getFsFileUri)
const calculateContentHashMock = jest.mocked(calculateContentHash)
const imageGetSizeMock = jest.mocked(Image.getSize)
const imageManipulatorMock = jest.mocked(ImageManipulator.manipulate)
const videoThumbMock = jest.mocked(VideoThumbnails.getThumbnailAsync)

beforeEach(async () => {
  getThumbnailScanner().reset()
  await initializeDB()
  jest.clearAllMocks()

  getFsFileUriMock.mockResolvedValue('file://source.jpg')
  let hashCounter = 0
  calculateContentHashMock.mockImplementation(
    async () => `sha256:thumb-hash-${++hashCounter}`,
  )

  imageGetSizeMock.mockImplementation((_, ok) => {
    ok?.(1920, 1080)
    return Promise.resolve()
  })
  imageManipulatorMock.mockImplementation(() => {
    const renderAsync = jest.fn().mockResolvedValue({
      saveAsync: jest.fn().mockResolvedValue({
        uri: 'file://temp/thumb.webp',
        width: 64,
        height: 36,
      }),
    })
    return {
      resize: jest.fn().mockReturnThis(),
      renderAsync,
    } as unknown as ImageManipulatorContext
  })
  videoThumbMock.mockResolvedValue({
    uri: 'file://frame.jpg',
    width: 1920,
    height: 1080,
  })
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
    await createFileRecord({
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
    expect(await readAllFileRecordsCount({ limit: 100, order: 'ASC' })).toBe(1)
  })

  it('skips files that already have all thumbnail sizes', async () => {
    const now = Date.now()
    await createFileRecord({
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
      await createFileRecord({
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
    expect(await readAllFileRecordsCount({ limit: 100, order: 'ASC' })).toBe(3)
  })

  it('generates a missing thumbnail (64px)', async () => {
    const now = Date.now()
    await createFileRecord({
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
      await createFileRecord({
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
    calculateContentHashMock.mockResolvedValue('sha256:thumb-64')
    const result = await runThumbnailScanner()
    const producedSizes = result.produced
      .filter((p) => p.originalId === 'file1')
      .map((p) => p.size)
      .sort((a, b) => a - b)
    expect(producedSizes).toEqual([64])
    const sizes = await readThumbnailSizesForFileId('file1')
    expect(sizes).toEqual([...ThumbSizes].sort((a, b) => a - b))
    expect(await readAllFileRecordsCount({ limit: 100, order: 'ASC' })).toBe(3)
  })

  it('pages past skipped candidates to find eligible originals', async () => {
    const now = Date.now()
    const noSourceIds = new Set<string>()
    for (let i = 0; i < 5; i++) {
      const id = `nosource-${i}`
      noSourceIds.add(id)
      await createFileRecord({
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
      await createFileRecord({
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
        await createFileRecord({
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

    await createFileRecord({
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
    expect(
      result.skippedNoSource
        .map((s) => s.fileId)
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual([...noSourceIds].sort((a, b) => a.localeCompare(b)))
  })

  it('skips generation for an exact existing size', async () => {
    const now = Date.now()
    await createFileRecord({
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
    await createFileRecord({
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
    expect(await readAllFileRecordsCount({ limit: 100, order: 'ASC' })).toBe(3)
  })

  it('generates thumbnails for video files using captured frames', async () => {
    const now = Date.now()
    await createFileRecord({
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
    let counter = 0
    calculateContentHashMock.mockImplementation(
      async () => `sha256:video-thumb-${++counter}`,
    )

    const result = await runThumbnailScanner()

    expect(videoThumbMock).toHaveBeenCalledTimes(ThumbSizes.length)
    const producedForVideo = result.produced
      .filter((p) => p.originalId === 'video1')
      .map((p) => p.size)
      .sort((a, b) => a - b)
    expect(producedForVideo).toEqual([...ThumbSizes].sort((a, b) => a - b))
    const sizes = await readThumbnailSizesForFileId('video1')
    expect(sizes).toEqual([...ThumbSizes].sort((a, b) => a - b))
  })

  it('limits production per tick (10)', async () => {
    const now = Date.now()
    for (let i = 0; i < 15; i++) {
      await createFileRecord({
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
    let counter = 0
    calculateContentHashMock.mockImplementation(
      async () => `sha256:thumb-hash-${++counter}`,
    )
    const result = await runThumbnailScanner()
    expect(result.produced).toHaveLength(10)
  })

  it('falls back when image size retrieval fails', async () => {
    const now = Date.now()
    await createFileRecord({
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
    imageGetSizeMock.mockImplementation((_, _ok, err) => {
      err?.(new Error('Failed to get size'))
      return Promise.resolve()
    })
    const ctx = {
      resize: jest.fn().mockReturnThis(),
      renderAsync: jest.fn().mockResolvedValue({
        saveAsync: jest.fn().mockResolvedValue({
          uri: 'file://temp/thumb.webp',
          width: 64,
          height: undefined,
        }),
      }),
    }
    imageManipulatorMock.mockReturnValue(
      ctx as unknown as ImageManipulatorContext,
    )
    calculateContentHashMock.mockResolvedValue('sha256:thumb-hash')
    await runThumbnailScanner()
    expect(ctx.resize).toHaveBeenCalledWith({ width: 64, height: undefined })
  })

  it('stops immediately when signal is already aborted', async () => {
    const now = Date.now()
    await createFileRecord({
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
    expect(imageManipulatorMock).not.toHaveBeenCalled()
  })

  it('stops mid-scan when signal is aborted', async () => {
    const now = Date.now()
    for (let i = 0; i < 5; i++) {
      await createFileRecord({
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
    let counter = 0
    calculateContentHashMock.mockImplementation(
      async () => `sha256:thumb-hash-${++counter}`,
    )

    const ac = new AbortController()
    let manipCalls = 0
    imageManipulatorMock.mockImplementation(() => {
      manipCalls++
      if (manipCalls >= 2) ac.abort()
      const renderAsync = jest.fn().mockResolvedValue({
        saveAsync: jest.fn().mockResolvedValue({
          uri: 'file://temp/thumb.webp',
          width: 64,
          height: 36,
        }),
      })
      return {
        resize: jest.fn().mockReturnThis(),
        renderAsync,
      } as unknown as ImageManipulatorContext
    })

    const result = await runThumbnailScanner(ac.signal)
    expect(result.produced.length).toBeGreaterThan(0)
    expect(result.produced.length).toBeLessThan(ThumbSizes.length * 5)
  })

  it('logs and continues when manipulation throws', async () => {
    const now = Date.now()
    await createFileRecord({
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
    imageGetSizeMock.mockImplementation((_, ok) => {
      ok?.(1920, 1080)
      return Promise.resolve()
    })
    imageManipulatorMock.mockImplementation(() => {
      throw new Error('Manipulation failed')
    })
    const result = await runThumbnailScanner()
    expect(result.errors).toHaveLength(ThumbSizes.length)
    expect(result.errors[0]).toMatchObject({
      originalId: 'file1',
      originalHash: 'hash1',
      size: 64,
    })
    const sizes = await readThumbnailSizesForFileId('file1')
    expect(sizes).not.toContain(64)
  })
})

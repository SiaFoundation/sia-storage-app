// Mock config MUST be at the very top before any imports
// Constants must be inlined in jest.mock due to hoisting
const MOCK_SLAB_SIZE = 4 * 1024 * 1024 * 10 // 40 MiB (SECTOR_SIZE * DATA_SHARDS)

jest.mock('@siastorage/core/config', () => ({
  __esModule: true,
  UPLOAD_MAX_INFLIGHT: 15,
  UPLOAD_DATA_SHARDS: 10,
  UPLOAD_PARITY_SHARDS: 0,
  SECTOR_SIZE: 4 * 1024 * 1024,
  SLAB_SIZE: 4 * 1024 * 1024 * 10, // 40 MiB (SECTOR_SIZE * DATA_SHARDS)
  PACKER_IDLE_TIMEOUT: 5000,
  PACKER_MAX_BATCH_DURATION: 60000, // 60 seconds
  PACKER_MAX_SLABS: 10,
  SLAB_FILL_THRESHOLD: 0.9,
  PACKER_POLL_INTERVAL: 5000,
  SAVE_BATCH_CONCURRENCY: 50,
  SAVE_REMOVAL_DELAY_MS: 0,
}))

import { PACKER_IDLE_TIMEOUT, SLAB_SIZE } from '@siastorage/core/config'
import {
  type UploaderAdapters,
  UploadManager,
} from '@siastorage/core/services/uploader'
import type {
  PackedUploadInterface,
  PinnedObjectInterface,
  SdkInterface,
} from 'react-native-sia'
import { initializeDB, resetDb } from '../db'
import { app, internal } from '../stores/appService'
import type { FileEntry, FlushRecord } from './uploader'

jest.mock('react-native-sia', () => ({}))

jest.mock('@siastorage/core/encoding/fileMetadata', () => ({
  encodeFileMetadata: jest.fn(() => new Uint8Array()),
}))

const MB = 1024 * 1024
const KB = 1024
const TEST_INDEXER_URL = 'https://test.indexer'

function createFileEntry(id: string, size = 1000): FileEntry {
  return {
    fileId: id,
    fileUri: `file://${id}`,
    file: {
      id,
      name: `${id}.txt`,
      size,
      type: 'text/plain',
      kind: 'file',
      hash: 'hash',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      localId: null,
      addedAt: Date.now(),
      trashedAt: null,
      deletedAt: null,
    },
    size,
  }
}

function createMockPinnedObject(): jest.Mocked<PinnedObjectInterface> {
  return {
    updateMetadata: jest.fn(),
    key: jest.fn().mockReturnValue('mock-key'),
    size: jest.fn().mockReturnValue(BigInt(1000)),
    slabs: jest.fn().mockReturnValue([]),
  } as unknown as jest.Mocked<PinnedObjectInterface>
}

function createMockPacker(
  pinnedObject: jest.Mocked<PinnedObjectInterface>,
): jest.Mocked<PackedUploadInterface> {
  return {
    add: jest.fn().mockResolvedValue(BigInt(1000)),
    finalize: jest.fn().mockResolvedValue([pinnedObject]),
  } as unknown as jest.Mocked<PackedUploadInterface>
}

const mockAppKey = { export_: () => new Uint8Array(32) }

function createMockSdk(
  packer: jest.Mocked<PackedUploadInterface>,
): jest.Mocked<SdkInterface> {
  return {
    uploadPacked: jest.fn().mockResolvedValue(packer),
    pinObject: jest.fn().mockResolvedValue(undefined),
    appKey: jest.fn().mockReturnValue(mockAppKey),
  } as unknown as jest.Mocked<SdkInterface>
}

function defaultAdapters(): UploaderAdapters {
  return {
    createFileReader: jest.fn(() => ({
      read: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
    })),
  }
}

function createDBFiles(
  count: number,
  opts: { prefix?: string; size?: number } = {},
) {
  const { prefix = 'eff-db', size = 400 } = opts
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    name: `${prefix}-${i}.bin`,
    size,
    type: 'application/octet-stream',
    hash: `hash-${prefix}-${i}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    localId: null,
    addedAt: Date.now(),
    objects: {},
  })) as any
}

/**
 * Creates a realistic set of DB files in createdAt order:
 * photos first, then their thumbnails (2 per photo at 4KB each).
 */
function createDBPhotosWithThumbs(
  photoCount: number,
  opts: { prefix?: string; photoSize?: number } = {},
) {
  const { prefix = 'eff-db', photoSize = 3 * MB } = opts
  const files = []
  for (let i = 0; i < photoCount; i++) {
    files.push({
      id: `${prefix}-photo-${i}`,
      name: `${prefix}-photo-${i}.jpg`,
      size: photoSize,
      type: 'image/jpeg',
      hash: `hash-${prefix}-photo-${i}`,
      createdAt: Date.now() + i,
      updatedAt: Date.now() + i,
      localId: null,
      addedAt: Date.now() + i,
      objects: {},
    })
  }
  for (let i = 0; i < photoCount; i++) {
    for (let t = 0; t < 2; t++) {
      files.push({
        id: `${prefix}-thumb-${i}-${t}`,
        name: `${prefix}-thumb-${i}-${t}.jpg`,
        size: 4 * KB,
        type: 'image/jpeg',
        hash: `hash-${prefix}-thumb-${i}-${t}`,
        createdAt: Date.now() + photoCount + i * 2 + t,
        updatedAt: Date.now() + photoCount + i * 2 + t,
        localId: null,
        addedAt: Date.now() + photoCount + i * 2 + t,
        objects: {},
      })
    }
  }
  return files as any
}

/*
 * Packing efficiency tests
 *
 * Why efficiency matters: on the Sia network, each partial slab is paid for
 * in full. Wasted space in slabs is wasted money. The packer's job is to
 * fill slabs as completely as possible before flushing.
 *
 * Why smaller batches matter: data is uploaded during add() calls as slabs
 * fill, but not pinned until after finalize. Smaller batches reduce the
 * window where data is uploaded but unpinned.
 *
 * createdAt ASC ordering: DB polling returns files in the order they were
 * added. Photos arrive before their thumbnails (generated asynchronously),
 * naturally mixing large and small files for efficient packing.
 *
 * Threshold flush: when the current slab is >=90% full and the next file would
 * cross a slab boundary, flush now rather than accumulating a huge batch.
 *
 * Key metric: flushHistory[i].fillPercent -- measures how well we utilized
 * the slab capacity in each batch.
 *
 * fillPercent formula: Math.round((totalSize / ((slabsFilled + 1) * SLAB_SIZE)) * 100)
 */
describe('UploadManager packing efficiency', () => {
  let mockPinnedObject: jest.Mocked<PinnedObjectInterface>
  let mockPacker: jest.Mocked<PackedUploadInterface>
  let mockSdk: jest.Mocked<SdkInterface>
  let manager: UploadManager
  let queryFilesSpy: jest.SpyInstance

  const realConfig = jest.requireActual('@siastorage/core/config') as Record<
    string,
    any
  >
  const savedConfig: Record<string, any> = {}
  const configPatches: Record<string, any> = {
    UPLOAD_MAX_INFLIGHT: 15,
    UPLOAD_DATA_SHARDS: 10,
    UPLOAD_PARITY_SHARDS: 0,
    SECTOR_SIZE: 4 * 1024 * 1024,
    SLAB_SIZE: 4 * 1024 * 1024 * 10,
    PACKER_IDLE_TIMEOUT: 5000,
    PACKER_MAX_BATCH_DURATION: 60000,
    PACKER_MAX_SLABS: 10,
    SLAB_FILL_THRESHOLD: 0.9,
    PACKER_POLL_INTERVAL: 5000,
    SAVE_BATCH_CONCURRENCY: 50,
    SAVE_REMOVAL_DELAY_MS: 0,
  }

  function enablePolling() {
    app().connection.setState({ isConnected: true })
    void app().settings.setAutoScanUploads(true)
  }

  beforeEach(async () => {
    for (const [key, val] of Object.entries(configPatches)) {
      savedConfig[key] = realConfig[key]
      realConfig[key] = val
    }
    await initializeDB()
    jest.clearAllMocks()
    jest.useFakeTimers()

    jest
      .spyOn(app().fs, 'getFileUri')
      .mockImplementation(async (file: any) => `file://${file.id}`)

    app().connection.setState({ isConnected: true })
    await app().settings.setIndexerURL(TEST_INDEXER_URL)

    manager = new UploadManager()

    mockPinnedObject = createMockPinnedObject()
    mockPacker = createMockPacker(mockPinnedObject)
    mockSdk = createMockSdk(mockPacker)

    internal().setSdk(mockSdk as any)

    queryFilesSpy = jest
      .spyOn(app().files, 'query')
      .mockResolvedValue([] as any)
  })

  afterEach(async () => {
    await manager.shutdown()
    for (const [key, val] of Object.entries(savedConfig)) {
      realConfig[key] = val
    }
    jest.useRealTimers()
    queryFilesSpy.mockRestore()
    app().connection.setState({ isConnected: false })
    void app().settings.setAutoScanUploads(false)
    app().uploads.clear()
    await resetDb()
  })

  function history(): FlushRecord[] {
    return manager.flushHistory
  }

  describe('small files', () => {
    it('100 small files (50KB each) pack into one batch', async () => {
      // 100 x 50KB = 5,120,000 bytes -- fits well under one slab (40MiB)
      // fillPercent is low because files are tiny relative to slab capacity
      manager.initialize(app(), internal(), defaultAdapters())

      const files = Array.from({ length: 100 }, (_, i) =>
        createFileEntry(`small-${i}`, 50 * KB),
      )
      await manager.__testProcessFiles(files)
      await manager.flush()

      expect(history()).toHaveLength(1)
      expect(history()[0]).toMatchObject({
        reason: 'manual',
        fileCount: 100,
        slabsFilled: 0,
        fillPercent: 12,
      })
    })

    it('small files that nearly fill a slab', async () => {
      // 200 x 200KB = 40,960,000 bytes ~ 97.7% of one slab
      manager.initialize(app(), internal(), defaultAdapters())

      const files = Array.from({ length: 200 }, (_, i) =>
        createFileEntry(`small-exact-${i}`, 200 * KB),
      )
      await manager.__testProcessFiles(files)
      await manager.flush()

      expect(history()).toHaveLength(1)
      expect(history()[0]).toMatchObject({
        reason: 'manual',
        fileCount: 200,
        slabsFilled: 0,
        fillPercent: 98,
      })
    })
  })

  describe('medium files', () => {
    it('medium files fill a slab efficiently', async () => {
      // 19 x 2MiB = 38MiB = exactly 95% of one slab
      manager.initialize(app(), internal(), defaultAdapters())

      const files = Array.from({ length: 19 }, (_, i) =>
        createFileEntry(`med-${i}`, 2 * MB),
      )
      await manager.__testProcessFiles(files)
      await manager.flush()

      expect(history()).toHaveLength(1)
      expect(history()[0]).toMatchObject({
        reason: 'manual',
        fileCount: 19,
        slabsFilled: 0,
        fillPercent: 95,
      })
    })

    it('medium files crossing slab boundaries accumulate without premature flush', async () => {
      // 15 x 15MiB = 225MiB -> slabsFilled=5, capacity=240MiB
      // Fill at each boundary stays at 0.375/0.75/0.125/0.5/0.875 -- never >=0.9
      manager.initialize(app(), internal(), defaultAdapters())

      const files = Array.from({ length: 15 }, (_, i) =>
        createFileEntry(`med-cross-${i}`, 15 * MB),
      )
      await manager.__testProcessFiles(files)

      expect(mockPacker.finalize).not.toHaveBeenCalled()

      await manager.flush()
      expect(history()).toHaveLength(1)
      expect(history()[0]).toMatchObject({
        reason: 'manual',
        fileCount: 15,
        slabsFilled: 5,
        fillPercent: 94,
      })
    })
  })

  describe('large / oversized files', () => {
    it('single file larger than one slab', async () => {
      // 1 x 50MiB -> spans 1 full slab + partial, capacity = 2 slabs
      manager.initialize(app(), internal(), defaultAdapters())

      await manager.__testProcessFiles([createFileEntry('big-1', 50 * MB)])
      await manager.flush()

      expect(history()).toHaveLength(1)
      expect(history()[0]).toMatchObject({
        reason: 'manual',
        fileCount: 1,
        slabsFilled: 1,
        fillPercent: 63,
      })
    })

    it('file spanning 3+ slabs', async () => {
      // 1 x 130MiB -> spans 3 full slabs + partial, capacity = 4 slabs
      manager.initialize(app(), internal(), defaultAdapters())

      await manager.__testProcessFiles([createFileEntry('huge-1', 130 * MB)])
      await manager.flush()

      expect(history()).toHaveLength(1)
      expect(history()[0]).toMatchObject({
        reason: 'manual',
        fileCount: 1,
        slabsFilled: 3,
        fillPercent: 81,
      })
    })

    it('single file larger than max slabs (500MiB)', async () => {
      // 1 x 500MiB -> slabsFilled=12, exceeds PACKER_MAX_SLABS
      // Auto-flushes immediately after adding
      manager.initialize(app(), internal(), defaultAdapters())

      await manager.__testProcessFiles([createFileEntry('giant-1', 500 * MB)])

      expect(history()).toHaveLength(1)
      expect(history()[0]).toMatchObject({
        reason: 'max_slabs',
        fileCount: 1,
        slabsFilled: 12,
        fillPercent: 96,
      })
    })

    it('oversized file flushes existing batch first', async () => {
      // 5 x 2MiB = 10MiB in batch, then 500MiB triggers pre-flush
      // Flush 1: the existing 5 small files (only 25% of a slab -- wasteful
      //          but necessary to keep the oversized file in its own batch)
      // Flush 2: the 500MiB file alone
      manager.initialize(app(), internal(), defaultAdapters())

      const smallFiles = Array.from({ length: 5 }, (_, i) =>
        createFileEntry(`pre-${i}`, 2 * MB),
      )
      await manager.__testProcessFiles(smallFiles)
      expect(history()).toHaveLength(0)

      await manager.__testProcessFiles([createFileEntry('giant-2', 500 * MB)])

      expect(history()).toHaveLength(2)
      expect(history()[0]).toMatchObject({
        reason: 'max_slabs',
        fileCount: 5,
        slabsFilled: 0,
        fillPercent: 25,
      })
      expect(history()[1]).toMatchObject({
        reason: 'max_slabs',
        fileCount: 1,
        slabsFilled: 12,
        fillPercent: 96,
      })
    })
  })

  describe('gap filling -- large + small files', () => {
    it('large file + small files fill remaining slab space', async () => {
      // 1 x 30MiB + 40 x 250KB = ~39.75MiB -- nearly fills one slab
      // No boundary crossing so no threshold fires despite high fill
      manager.initialize(app(), internal(), defaultAdapters())

      const files = [
        createFileEntry('large-gap', 30 * MB),
        ...Array.from({ length: 40 }, (_, i) =>
          createFileEntry(`fill-${i}`, 250 * KB),
        ),
      ]
      await manager.__testProcessFiles(files)
      await manager.flush()

      expect(history()).toHaveLength(1)
      expect(history()[0]).toMatchObject({
        reason: 'manual',
        fileCount: 41,
        slabsFilled: 0,
        fillPercent: 99,
      })
    })

    it('oversized file + small files fill partial slab', async () => {
      // 1 x 50MiB (spans into slab 2) + 80 x 350KB fills slab 2 to 97%
      // No boundary crossing within slab 2 so no threshold fires
      manager.initialize(app(), internal(), defaultAdapters())

      const files = [
        createFileEntry('over-gap', 50 * MB),
        ...Array.from({ length: 80 }, (_, i) =>
          createFileEntry(`gap-fill-${i}`, 350 * KB),
        ),
      ]
      await manager.__testProcessFiles(files)
      await manager.flush()

      expect(history()).toHaveLength(1)
      expect(history()[0]).toMatchObject({
        reason: 'manual',
        fileCount: 81,
        slabsFilled: 1,
        fillPercent: 97,
      })
    })
  })

  describe('threshold flush', () => {
    it('fires at 90%+ fill -- both batches have correct reason', async () => {
      // Phase 1: 92% of slab -> no flush yet
      // Phase 2: 15% of slab -> would cross boundary -> threshold flush
      // Flush 1: the 92% file (efficient threshold flush)
      // Flush 2: the 15% file (wasteful but unavoidable remainder)
      manager.initialize(app(), internal(), defaultAdapters())

      const file1Size = Math.floor(SLAB_SIZE * 0.92)
      await manager.__testProcessFiles([createFileEntry('thresh-1', file1Size)])
      expect(history()).toHaveLength(0)

      const file2Size = Math.floor(SLAB_SIZE * 0.15)
      await manager.__testProcessFiles([createFileEntry('thresh-2', file2Size)])

      expect(history()).toHaveLength(1)
      expect(history()[0]).toMatchObject({
        reason: 'slab_threshold',
        fileCount: 1,
        slabsFilled: 0,
        fillPercent: 92,
      })

      await manager.flush()
      expect(history()).toHaveLength(2)
      expect(history()[1]).toMatchObject({
        reason: 'manual',
        fileCount: 1,
        slabsFilled: 0,
        fillPercent: 15,
      })
    })

    it('then oversized file in new batch', async () => {
      // Threshold flush at 92%, then overflow + 130MiB + small files
      // Flush 1: threshold flush of the 92% file
      // Flush 2: overflow (15%) + 130MiB + 10 x 200KB = ~138MiB across 4 slabs
      manager.initialize(app(), internal(), defaultAdapters())

      await manager.__testProcessFiles([
        createFileEntry('pre-thresh', Math.floor(SLAB_SIZE * 0.92)),
      ])
      await manager.__testProcessFiles([
        createFileEntry('overflow', Math.floor(SLAB_SIZE * 0.15)),
      ])
      expect(history()).toHaveLength(1)
      expect(history()[0]).toMatchObject({
        reason: 'slab_threshold',
        fileCount: 1,
        fillPercent: 92,
      })

      const files = [
        createFileEntry('big-after-thresh', 130 * MB),
        ...Array.from({ length: 10 }, (_, i) =>
          createFileEntry(`small-after-${i}`, 200 * KB),
        ),
      ]
      await manager.__testProcessFiles(files)
      await manager.flush()

      expect(history()).toHaveLength(2)
      expect(history()[1]).toMatchObject({
        reason: 'manual',
        fileCount: 12,
        slabsFilled: 3,
        fillPercent: 86,
      })
    })
  })

  describe('multi-slab batches', () => {
    it('multi-slab batch stays efficient', async () => {
      // 4 x 35MiB = 140MiB -> slabsFilled=3, capacity=160MiB
      // Fill at each boundary: 0.875/0.75/0.625/0.5 -- never >=0.9
      manager.initialize(app(), internal(), defaultAdapters())

      const files = Array.from({ length: 4 }, (_, i) =>
        createFileEntry(`multi-slab-${i}`, 35 * MB),
      )
      await manager.__testProcessFiles(files)

      expect(mockPacker.finalize).not.toHaveBeenCalled()

      await manager.flush()
      expect(history()).toHaveLength(1)
      expect(history()[0]).toMatchObject({
        reason: 'manual',
        fileCount: 4,
        slabsFilled: 3,
        fillPercent: 88,
      })
    })
  })

  describe('max slabs limits', () => {
    it('max slabs triggers flush at 400MiB -- full slabs', async () => {
      // 10 x 40MiB = 400MiB -> slabsFilled=10 -> max_slabs flush
      // Each file exactly fills one slab so fill=0% at each boundary (no threshold)
      // Then 5 x 40MiB = 200MiB remainder
      manager.initialize(app(), internal(), defaultAdapters())

      for (let i = 0; i < 10; i++) {
        await manager.__testProcessFiles([
          createFileEntry(`max-slab-${i}`, MOCK_SLAB_SIZE),
        ])
      }

      expect(history()).toHaveLength(1)
      expect(history()[0]).toMatchObject({
        reason: 'max_slabs',
        fileCount: 10,
        slabsFilled: 10,
        fillPercent: 91,
      })

      for (let i = 0; i < 5; i++) {
        await manager.__testProcessFiles([
          createFileEntry(`max-slab-extra-${i}`, MOCK_SLAB_SIZE),
        ])
      }
      await manager.flush()

      expect(history()).toHaveLength(2)
      expect(history()[1]).toMatchObject({
        reason: 'manual',
        fileCount: 5,
        slabsFilled: 5,
        fillPercent: 83,
      })
    })

    it('max slabs with partial fill', async () => {
      // 20 x 20MiB = 400MiB -> slabsFilled=10 on the 20th file
      // Fill oscillates 0%/50% at boundaries -- never hits 90% threshold
      manager.initialize(app(), internal(), defaultAdapters())

      for (let i = 0; i < 19; i++) {
        await manager.__testProcessFiles([
          createFileEntry(`partial-max-${i}`, 20 * MB),
        ])
      }
      expect(mockPacker.finalize).not.toHaveBeenCalled()

      await manager.__testProcessFiles([
        createFileEntry('partial-max-final', 20 * MB),
      ])

      expect(history()).toHaveLength(1)
      expect(history()[0]).toMatchObject({
        reason: 'max_slabs',
        fileCount: 20,
        slabsFilled: 10,
        fillPercent: 91,
      })
    })
  })

  describe('realistic mixed workloads', () => {
    it('photos then thumbnails (createdAt order)', async () => {
      // Realistic createdAt order: photos are added first, then the
      // thumbnailer generates 2 thumbnails per photo asynchronously.
      // 20 photos (1.5MiB) + 2 videos (15MiB) + 50 thumbs (4KB)
      // = 30MiB + 30MiB + 0.2MiB = ~60.2MiB -> slabsFilled=1
      manager.initialize(app(), internal(), defaultAdapters())

      const photos = Array.from({ length: 20 }, (_, i) =>
        createFileEntry(`photo-${i}`, Math.floor(1.5 * MB)),
      )
      const videos = Array.from({ length: 2 }, (_, i) =>
        createFileEntry(`video-${i}`, 15 * MB),
      )
      const thumbnails = Array.from({ length: 50 }, (_, i) =>
        createFileEntry(`thumb-${i}`, 4 * KB),
      )
      await manager.__testProcessFiles([...photos, ...videos, ...thumbnails])
      await manager.flush()

      expect(history()).toHaveLength(1)
      expect(history()[0]).toMatchObject({
        reason: 'manual',
        fileCount: 72,
        slabsFilled: 1,
        fillPercent: 75,
      })
    })

    it('camera roll sync: batch of photos then thumbnails fill slabs', async () => {
      // Simulates camera roll sync: 50 photos added, then thumbnailer
      // creates 100 thumbnails (2 per photo). With createdAt ordering,
      // photos pack first filling slabs, then thumbnails fill gaps.
      // 50 x 3MiB = 150MiB: threshold fires every 13 photos (39MiB = 97.5%)
      // 3 threshold flushes of 13 photos, then 11 photos + 100 thumbs remain
      manager.initialize(app(), internal(), defaultAdapters())

      const photos = Array.from({ length: 50 }, (_, i) =>
        createFileEntry(`sync-photo-${i}`, 3 * MB),
      )
      const thumbnails = Array.from({ length: 100 }, (_, i) =>
        createFileEntry(`sync-thumb-${i}`, 4 * KB),
      )
      await manager.__testProcessFiles([...photos, ...thumbnails])
      await manager.flush()

      expect(history()).toHaveLength(4)
      for (let i = 0; i < 3; i++) {
        expect(history()[i]).toMatchObject({
          reason: 'slab_threshold',
          fileCount: 13,
          fillPercent: 98,
        })
      }
      // Last batch: 11 photos (33MiB) + 100 thumbs (0.4MiB) = 83% fill
      expect(history()[3]).toMatchObject({
        reason: 'manual',
        fileCount: 111,
        fillPercent: 83,
      })

      const totalFiles = history().reduce((sum, h) => sum + h.fileCount, 0)
      expect(totalFiles).toBe(150)
    })
  })

  describe('loop + DB polling efficiency', () => {
    it('drains all files into one efficient batch', async () => {
      // 50 x 800KB = 40,960,000 bytes ~ 98% of one slab
      // All files fit within one slab so no threshold fires
      enablePolling()
      queryFilesSpy
        .mockResolvedValueOnce(createDBFiles(50, { size: 800 * KB }))
        .mockResolvedValue([] as any)

      manager.initialize(app(), internal(), defaultAdapters())
      await jest.advanceTimersByTimeAsync(0)
      await jest.advanceTimersByTimeAsync(PACKER_IDLE_TIMEOUT)

      expect(history()).toHaveLength(1)
      expect(history()[0]).toMatchObject({
        reason: 'idle_timeout',
        fileCount: 50,
        slabsFilled: 0,
        fillPercent: 98,
      })
    })

    it('re-poll catches late files -- single efficient flush', async () => {
      // Wave 1: 25 files polled, wave 2: 25 more found on next poll
      // excludeIds filters wave1 at SQL level so second poll returns only wave2
      // All 50 x 800KB packed into one batch before idle timeout
      enablePolling()
      const wave1 = createDBFiles(25, { prefix: 'eff-w1', size: 800 * KB })
      const wave2 = createDBFiles(25, { prefix: 'eff-w2', size: 800 * KB })
      queryFilesSpy
        .mockResolvedValueOnce(wave1)
        .mockResolvedValueOnce(wave2)
        .mockResolvedValue([] as any)

      manager.initialize(app(), internal(), defaultAdapters())
      await jest.advanceTimersByTimeAsync(0)
      await jest.advanceTimersByTimeAsync(PACKER_IDLE_TIMEOUT)

      expect(history()).toHaveLength(1)
      expect(history()[0]).toMatchObject({
        reason: 'idle_timeout',
        fileCount: 50,
        slabsFilled: 0,
        fillPercent: 98,
      })
    })

    it('files exceeding max slabs produce multiple efficient batches', async () => {
      // 500 x 1MiB = 500MiB -- exceeds max batch (10 slabs = 400MiB)
      // 1MiB files trigger threshold at 39 files (39MiB = 97.5% of slab)
      // Pattern: 12 threshold flushes of 39 files + 1 idle timeout of 32 files
      enablePolling()
      queryFilesSpy
        .mockResolvedValueOnce(createDBFiles(500, { size: MB }))
        .mockResolvedValue([] as any)

      manager.initialize(app(), internal(), defaultAdapters())
      await jest.advanceTimersByTimeAsync(0)
      await jest.advanceTimersByTimeAsync(PACKER_IDLE_TIMEOUT)

      expect(history()).toHaveLength(13)

      // Flushes 0-11: threshold flushes, each 39 files at 98% fill
      for (let i = 0; i < 12; i++) {
        expect(history()[i]).toMatchObject({
          reason: 'slab_threshold',
          fileCount: 39,
          slabsFilled: 0,
          fillPercent: 98,
        })
      }

      // Flush 12: idle timeout drains the remaining 32 files at 80% fill
      expect(history()[12]).toMatchObject({
        reason: 'idle_timeout',
        fileCount: 32,
        slabsFilled: 0,
        fillPercent: 80,
      })

      const totalFiles = history().reduce((sum, h) => sum + h.fileCount, 0)
      expect(totalFiles).toBe(500)
    })

    it('photos + thumbnails in createdAt order pack efficiently', async () => {
      // 13 photos (3MiB) + 26 thumbnails (4KB) in createdAt order
      // = 39MiB + 0.1MiB = ~39.1MiB -> fits in one slab at 98%
      // Photos pack first filling the slab, thumbnails fill remaining gaps
      enablePolling()
      queryFilesSpy
        .mockResolvedValueOnce(
          createDBPhotosWithThumbs(13, { photoSize: 3 * MB }),
        )
        .mockResolvedValue([] as any)

      manager.initialize(app(), internal(), defaultAdapters())
      await jest.advanceTimersByTimeAsync(0)
      await jest.advanceTimersByTimeAsync(PACKER_IDLE_TIMEOUT)

      expect(history()).toHaveLength(1)
      expect(history()[0]).toMatchObject({
        reason: 'idle_timeout',
        fileCount: 39,
        slabsFilled: 0,
        fillPercent: 98,
      })
    })

    it('large photo batch with thumbnails triggers threshold flushes', async () => {
      // 50 photos (3MiB) + 100 thumbnails (4KB) in createdAt order
      // Photos trigger threshold at 13 files (39MiB = 97.5% of slab)
      // 3 threshold flushes of 13 photos, then 11 photos + 100 thumbs idle
      enablePolling()
      queryFilesSpy
        .mockResolvedValueOnce(
          createDBPhotosWithThumbs(50, { photoSize: 3 * MB }),
        )
        .mockResolvedValue([] as any)

      manager.initialize(app(), internal(), defaultAdapters())
      await jest.advanceTimersByTimeAsync(0)
      await jest.advanceTimersByTimeAsync(PACKER_IDLE_TIMEOUT)

      expect(history()).toHaveLength(4)
      for (let i = 0; i < 3; i++) {
        expect(history()[i]).toMatchObject({
          reason: 'slab_threshold',
          fileCount: 13,
          fillPercent: 98,
        })
      }
      expect(history()[3]).toMatchObject({
        reason: 'idle_timeout',
        fileCount: 111,
        fillPercent: 83,
      })

      const totalFiles = history().reduce((sum, h) => sum + h.fileCount, 0)
      expect(totalFiles).toBe(150)
    })
  })

  describe('sporadic enqueue via loop', () => {
    it('idle resets keep batch open', async () => {
      // 5 x 7MiB = 35MiB enqueued 2s apart (under 5s idle timeout)
      // All pack into one batch, idle timeout fires after last enqueue
      manager.initialize(app(), internal(), defaultAdapters())
      await jest.advanceTimersByTimeAsync(0)

      for (let i = 0; i < 5; i++) {
        manager.enqueue([createFileEntry(`sporadic-${i}`, 7 * MB)])
        await jest.advanceTimersByTimeAsync(2000)
      }

      await jest.advanceTimersByTimeAsync(PACKER_IDLE_TIMEOUT)

      expect(history()).toHaveLength(1)
      expect(history()[0]).toMatchObject({
        reason: 'idle_timeout',
        fileCount: 5,
        slabsFilled: 0,
        fillPercent: 88,
      })
    })

    it('gap exceeding idle timeout -- two separate efficient batches', async () => {
      // Batch 1: 3 x 12MiB = 36MiB -> idle timeout -> 90% fill
      // Batch 2: 2 x 18MiB = 36MiB -> idle timeout -> 90% fill
      manager.initialize(app(), internal(), defaultAdapters())
      await jest.advanceTimersByTimeAsync(0)

      for (let i = 0; i < 3; i++) {
        manager.enqueue([createFileEntry(`gap-a-${i}`, 12 * MB)])
        await jest.advanceTimersByTimeAsync(0)
      }
      await jest.advanceTimersByTimeAsync(PACKER_IDLE_TIMEOUT)

      expect(history()).toHaveLength(1)
      expect(history()[0]).toMatchObject({
        reason: 'idle_timeout',
        fileCount: 3,
        slabsFilled: 0,
        fillPercent: 90,
      })

      for (let i = 0; i < 2; i++) {
        manager.enqueue([createFileEntry(`gap-b-${i}`, 18 * MB)])
        await jest.advanceTimersByTimeAsync(0)
      }
      await jest.advanceTimersByTimeAsync(PACKER_IDLE_TIMEOUT)

      expect(history()).toHaveLength(2)
      expect(history()[1]).toMatchObject({
        reason: 'idle_timeout',
        fileCount: 2,
        slabsFilled: 0,
        fillPercent: 90,
      })
    })
  })

  describe('complex multi-phase scenario', () => {
    it('mixed file sizes across threshold flushes, max slabs, and idle timeouts', async () => {
      // Phase 1: 92% of slab -> threshold flush on overflow
      // Phase 2: overflow (15%) + 160 x 2MiB -> repeated threshold flushes
      // Phase 3: 1 x 100MiB added to remaining batch
      // Phase 4: 20 x 500KB fills gaps -> manual flush
      //
      // 2MiB files trigger threshold every 19 files (19x2MiB = 38MiB = 95%)
      // The first 2MiB batch includes the overflow file so it's 17 files
      manager.initialize(app(), internal(), defaultAdapters())

      await manager.__testProcessFiles([
        createFileEntry('p1-big', Math.floor(SLAB_SIZE * 0.92)),
      ])
      expect(history()).toHaveLength(0)

      await manager.__testProcessFiles([
        createFileEntry('p1-overflow', Math.floor(SLAB_SIZE * 0.15)),
      ])

      // Flush 0: threshold flush of the 92% file
      expect(history()).toHaveLength(1)
      expect(history()[0]).toMatchObject({
        reason: 'slab_threshold',
        fileCount: 1,
        slabsFilled: 0,
        fillPercent: 92,
      })

      const smallFiles = Array.from({ length: 160 }, (_, i) =>
        createFileEntry(`p2-small-${i}`, 2 * MB),
      )
      await manager.__testProcessFiles(smallFiles)

      // Flush 1: overflow + first 16 of 160 2MiB files = 17 files at 95%
      // Flushes 2-8: 7 x 19 2MiB files at 95% each
      // (16 + 7x19 = 149 of 160 processed, 11 remain in batch)
      expect(history()).toHaveLength(9)
      expect(history()[1]).toMatchObject({
        reason: 'slab_threshold',
        fileCount: 17,
        slabsFilled: 0,
        fillPercent: 95,
      })
      for (let i = 2; i < 9; i++) {
        expect(history()[i]).toMatchObject({
          reason: 'slab_threshold',
          fileCount: 19,
          slabsFilled: 0,
          fillPercent: 95,
        })
      }

      await manager.__testProcessFiles([createFileEntry('p3-large', 100 * MB)])

      const fillers = Array.from({ length: 20 }, (_, i) =>
        createFileEntry(`p4-filler-${i}`, 500 * KB),
      )
      await manager.__testProcessFiles(fillers)

      await manager.flush()

      // Flush 9: 11 remaining 2MiB + 100MiB + 20 x 500KB = 32 files
      expect(history()).toHaveLength(10)
      expect(history()[9]).toMatchObject({
        reason: 'manual',
        fileCount: 32,
        slabsFilled: 3,
        fillPercent: 82,
      })

      const totalFiles = history().reduce((sum, h) => sum + h.fileCount, 0)
      expect(totalFiles).toBe(1 + 1 + 160 + 1 + 20)
    })

    it('alternating large and small file bursts across many slabs', async () => {
      // Round 1: 20 x 1MiB (20MiB, half slab)
      // Round 2: 1 x 25MiB (total 45MiB, crosses into slab 2)
      // Round 3: 50 x 500KB (25MiB more, total ~70MiB)
      // Round 4: 3 x 40MiB (120MiB more, total ~190MiB)
      // Round 5: 100 x 2MiB (200MiB more) -- threshold flush at slab boundary
      // Round 6: 1 x 40MiB triggers threshold on existing batch
      // Round 7: 30 x 300KB fills gaps
      //
      // Threshold fires when batch hits ~99.7% of 5 slabs (after R1-R4 + 5 R5)
      // Then 2MiB files trigger threshold every 19 files
      manager.initialize(app(), internal(), defaultAdapters())

      await manager.__testProcessFiles(
        Array.from({ length: 20 }, (_, i) =>
          createFileEntry(`r1-small-${i}`, MB),
        ),
      )

      await manager.__testProcessFiles([createFileEntry('r2-big', 25 * MB)])

      await manager.__testProcessFiles(
        Array.from({ length: 50 }, (_, i) =>
          createFileEntry(`r3-small-${i}`, 500 * KB),
        ),
      )

      for (let i = 0; i < 3; i++) {
        await manager.__testProcessFiles([
          createFileEntry(`r4-big-${i}`, MOCK_SLAB_SIZE),
        ])
      }

      await manager.__testProcessFiles(
        Array.from({ length: 100 }, (_, i) =>
          createFileEntry(`r5-med-${i}`, 2 * MB),
        ),
      )

      await manager.__testProcessFiles([
        createFileEntry('r6-trigger', MOCK_SLAB_SIZE),
      ])

      await manager.__testProcessFiles(
        Array.from({ length: 30 }, (_, i) =>
          createFileEntry(`r7-small-${i}`, 300 * KB),
        ),
      )

      await manager.flush()

      expect(history()).toHaveLength(7)

      // Flush 0: R1+R2+R3+R4 + first 5 of R5 = 79 files, fills 5 slabs to 100%
      expect(history()[0]).toMatchObject({
        reason: 'slab_threshold',
        fileCount: 79,
        slabsFilled: 4,
        fillPercent: 100,
      })

      // Flushes 1-4: 4 x 19 2MiB files at 95% each
      for (let i = 1; i <= 4; i++) {
        expect(history()[i]).toMatchObject({
          reason: 'slab_threshold',
          fileCount: 19,
          slabsFilled: 0,
          fillPercent: 95,
        })
      }

      // Flush 5: last 19 R5 files flushed by R6's slab_threshold
      expect(history()[5]).toMatchObject({
        reason: 'slab_threshold',
        fileCount: 19,
        slabsFilled: 0,
        fillPercent: 95,
      })

      // Flush 6: R6 (40MiB) + 30 R7 (300KB each) = 31 files, only 61% fill
      expect(history()[6]).toMatchObject({
        reason: 'manual',
        fileCount: 31,
        slabsFilled: 1,
        fillPercent: 61,
      })

      const totalFiles = history().reduce((sum, h) => sum + h.fileCount, 0)
      expect(totalFiles).toBe(20 + 1 + 50 + 3 + 100 + 1 + 30)
    })
  })

  describe('known inefficiencies -- optimization targets', () => {
    // These tests document realistic scenarios where the packer currently
    // wastes the most slab space. Each test pins down the exact fill% so
    // that future optimizations produce a clear diff in these values.
    //
    // Sorted from worst to best fill%.

    it('single photo (5 MiB) -- 13% fill', async () => {
      // The most common real-world case: user shares one photo.
      // 5 MiB barely dents the 40 MiB slab.
      manager.initialize(app(), internal(), defaultAdapters())

      await manager.__testProcessFiles([createFileEntry('photo-1', 5 * MB)])
      await manager.flush()

      expect(history()).toHaveLength(1)
      expect(history()[0]).toMatchObject({
        reason: 'manual',
        fileCount: 1,
        slabsFilled: 0,
        fillPercent: 13,
      })
    })

    it('share sheet: 3 photos (3 x 5 MiB) -- 38% fill', async () => {
      // Common multi-select from share sheet. 15 MiB is well under one slab.
      manager.initialize(app(), internal(), defaultAdapters())

      const files = Array.from({ length: 3 }, (_, i) =>
        createFileEntry(`photo-${i}`, 5 * MB),
      )
      await manager.__testProcessFiles(files)
      await manager.flush()

      expect(history()).toHaveLength(1)
      expect(history()[0]).toMatchObject({
        reason: 'manual',
        fileCount: 3,
        slabsFilled: 0,
        fillPercent: 38,
      })
    })

    it('file barely crossing slab boundary (41 MiB) -- 51% fill', async () => {
      // 1 MiB into the second slab means paying for 80 MiB capacity but
      // only using 41 MiB. Not inherently wasteful -- more files arriving
      // before the idle timeout would fill the gap. Only a problem when
      // this is the last file in the batch.
      manager.initialize(app(), internal(), defaultAdapters())

      await manager.__testProcessFiles([
        createFileEntry('border-file', 41 * MB),
      ])
      await manager.flush()

      expect(history()).toHaveLength(1)
      expect(history()[0]).toMatchObject({
        reason: 'manual',
        fileCount: 1,
        slabsFilled: 1,
        fillPercent: 51,
      })
    })

    it('single video crossing slab boundary (50 MiB) -- 63% fill', async () => {
      // Videos commonly exceed one slab but don't fill the second.
      // Like the boundary case above, only wasteful when no more files
      // arrive to fill the remaining ~30 MiB before the batch flushes.
      manager.initialize(app(), internal(), defaultAdapters())

      await manager.__testProcessFiles([createFileEntry('video-1', 50 * MB)])
      await manager.flush()

      expect(history()).toHaveLength(1)
      expect(history()[0]).toMatchObject({
        reason: 'manual',
        fileCount: 1,
        slabsFilled: 1,
        fillPercent: 63,
      })
    })

    it('threshold flush orphans a small remainder -- 95% then 5%', async () => {
      // 19 x 2 MiB fills one slab to 95%. The 20th file would cross the
      // slab boundary, triggering threshold flush. The orphaned file sits
      // alone at 5% fill -- the threshold logic sacrifices tail efficiency
      // for smaller batch sizes.
      manager.initialize(app(), internal(), defaultAdapters())

      const files = Array.from({ length: 20 }, (_, i) =>
        createFileEntry(`eff-${i}`, 2 * MB),
      )
      await manager.__testProcessFiles(files)
      await manager.flush()

      expect(history()).toHaveLength(2)
      expect(history()[0]).toMatchObject({
        reason: 'slab_threshold',
        fileCount: 19,
        slabsFilled: 0,
        fillPercent: 95,
      })
      expect(history()[1]).toMatchObject({
        reason: 'manual',
        fileCount: 1,
        slabsFilled: 0,
        fillPercent: 5,
      })
    })

    it('trickle upload: idle timeout drains single-photo batches -- 13% each', async () => {
      // Files arrive one at a time with gaps exceeding idle timeout.
      // Each photo gets its own batch instead of accumulating.
      manager.initialize(app(), internal(), defaultAdapters())
      await jest.advanceTimersByTimeAsync(0)

      for (let i = 0; i < 3; i++) {
        manager.enqueue([createFileEntry(`trickle-${i}`, 5 * MB)])
        await jest.advanceTimersByTimeAsync(PACKER_IDLE_TIMEOUT + 1000)
      }

      expect(history()).toHaveLength(3)
      for (let i = 0; i < 3; i++) {
        expect(history()[i]).toMatchObject({
          reason: 'idle_timeout',
          fileCount: 1,
          slabsFilled: 0,
          fillPercent: 13,
        })
      }
    })
  })
})

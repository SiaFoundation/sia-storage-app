// Mock config MUST be at the very top before any imports
// Constants must be inlined in jest.mock due to hoisting
const MOCK_SLAB_SIZE = 4 * 1024 * 1024 * 10 // 40 MiB (SECTOR_SIZE * DATA_SHARDS)

jest.mock('../config', () => ({
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
}))

import type {
  PackedUploadInterface,
  PinnedObjectInterface,
  SdkInterface,
} from 'react-native-sia'
import {
  PACKER_IDLE_TIMEOUT,
  SLAB_FILL_THRESHOLD,
  SLAB_SIZE,
  UPLOAD_DATA_SHARDS,
  UPLOAD_MAX_INFLIGHT,
  UPLOAD_PARITY_SHARDS,
} from '../config'
import { initializeDB, resetDb } from '../db'
import type { LocalObject } from '../encoding/localObject'
import { createFileRecord, readFileRecord } from '../stores/files'
import { readLocalObjectsForFile } from '../stores/localObjects'
import {
  flushPendingUploadProgress,
  getActiveUploads,
  getUploadState,
  useUploadsStore,
} from '../stores/uploads'
import { type FileEntry, getUploadManager } from './uploader'

jest.mock('react-native-sia', () => ({}))

jest.mock('../stores/sdk', () => ({
  useSdk: jest.fn(),
  getSdk: jest.fn(),
}))

jest.mock('../stores/settings', () => ({
  useIndexerURL: jest.fn(() => ({ data: 'https://test.indexer' })),
  getIndexerURL: jest.fn(() => 'https://test.indexer'),
}))

jest.mock('../lib/fileReader', () => ({
  createFileReader: jest.fn(() => ({
    read: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
  })),
}))
jest.mock('../lib/localObjects', () => ({
  pinnedObjectToLocalObject: jest.fn(
    (fileId: string, indexerURL: string): LocalObject => ({
      id: `object-${fileId}`,
      fileId,
      indexerURL,
      slabs: [],
      encryptedDataKey: new ArrayBuffer(32),
      encryptedMetadataKey: new ArrayBuffer(32),
      encryptedMetadata: new ArrayBuffer(64),
      dataSignature: new ArrayBuffer(64),
      metadataSignature: new ArrayBuffer(64),
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  ),
}))

jest.mock('../encoding/fileMetadata', () => ({
  encodeFileMetadata: jest.fn(() => new Uint8Array()),
}))

jest.mock('../stores/library', () => ({
  librarySwr: {
    triggerChange: jest.fn(),
    addChangeCallback: jest.fn(),
    getKey: jest.fn((key: string) => key),
  },
}))

const TEST_INDEXER_URL = 'https://test.indexer'

async function createTestFile(id: string, size = 1000): Promise<FileEntry> {
  const now = Date.now()
  await createFileRecord({
    id,
    name: `${id}.txt`,
    type: 'text/plain',
    size,
    hash: `hash-${id}`,
    createdAt: now,
    updatedAt: now,
    localId: null,
    addedAt: now,
  })

  const file = await readFileRecord(id)
  if (!file) throw new Error(`Failed to create test file: ${id}`)

  return {
    fileId: id,
    fileUri: `file://${id}`,
    file,
    size,
  }
}

function createFileEntry(id: string, size = 1000): FileEntry {
  return {
    fileId: id,
    fileUri: `file://${id}`,
    file: {
      id,
      name: `${id}.txt`,
      size,
      type: 'text/plain',
      hash: 'hash',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      localId: null,
      addedAt: Date.now(),
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
    remaining: jest.fn().mockResolvedValue(BigInt(MOCK_SLAB_SIZE - 1000)),
    finalize: jest.fn().mockResolvedValue([pinnedObject]),
  } as unknown as jest.Mocked<PackedUploadInterface>
}

function createMockSdk(
  packer: jest.Mocked<PackedUploadInterface>,
): jest.Mocked<SdkInterface> {
  return {
    uploadPacked: jest.fn().mockResolvedValue(packer),
    pinObject: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<SdkInterface>
}

describe('UploadManager', () => {
  let mockPinnedObject: jest.Mocked<PinnedObjectInterface>
  let mockPacker: jest.Mocked<PackedUploadInterface>
  let mockSdk: jest.Mocked<SdkInterface>
  let manager: ReturnType<typeof getUploadManager>

  function resetManager() {
    manager = getUploadManager()
    manager.reset()
  }

  function resetUploadsStore() {
    useUploadsStore.setState({ uploads: {} })
  }

  beforeEach(async () => {
    await initializeDB()
    jest.clearAllMocks()
    jest.useFakeTimers()

    resetManager()
    resetUploadsStore()

    mockPinnedObject = createMockPinnedObject()
    mockPacker = createMockPacker(mockPinnedObject)
    mockSdk = createMockSdk(mockPacker)
  })

  afterEach(async () => {
    jest.useRealTimers()
    await resetDb()
    resetUploadsStore()
  })

  describe('queueFiles', () => {
    it('adds files to packer and sets status to packed', async () => {
      manager.initialize(mockSdk, TEST_INDEXER_URL)

      await manager.queueFiles([
        createFileEntry('file1'),
        createFileEntry('file2'),
      ])

      const upload1 = getUploadState('file1')
      const upload2 = getUploadState('file2')
      expect(upload1?.status).toBe('packed')
      expect(upload2?.status).toBe('packed')
      expect(getActiveUploads()).toHaveLength(2)
    })
  })

  describe('processFile', () => {
    it('creates packer on first file', async () => {
      manager.initialize(mockSdk, TEST_INDEXER_URL)

      await manager.queueFiles([createFileEntry('file1')])

      expect(mockSdk.uploadPacked).toHaveBeenCalledWith(
        {
          maxInflight: UPLOAD_MAX_INFLIGHT,
          dataShards: UPLOAD_DATA_SHARDS,
          parityShards: UPLOAD_PARITY_SHARDS,
          progressCallback: expect.any(Object),
        },
        { signal: expect.any(AbortSignal) },
      )
    })

    it('reuses packer for subsequent files in same batch', async () => {
      manager.initialize(mockSdk, TEST_INDEXER_URL)

      await manager.queueFiles([createFileEntry('file1')])
      await manager.queueFiles([createFileEntry('file2')])

      expect(mockSdk.uploadPacked).toHaveBeenCalledTimes(1)
      expect(mockPacker.add).toHaveBeenCalledTimes(2)
    })

    it('sets error status on add failure', async () => {
      manager.initialize(mockSdk, TEST_INDEXER_URL)
      mockPacker.add.mockRejectedValueOnce(new Error('Add failed'))

      await manager.queueFiles([createFileEntry('file1')])

      // Verify error state in upload store
      const upload = getUploadState('file1')
      expect(upload?.status).toBe('error')
      expect(upload?.error).toBe('Add failed')
    })
  })

  describe('flush', () => {
    it('calls finalize on packer', async () => {
      manager.initialize(mockSdk, TEST_INDEXER_URL)

      await manager.queueFiles([createFileEntry('file1')])
      await manager.flush()

      expect(mockPacker.finalize).toHaveBeenCalled()
    })

    it('removes completed uploads from store after success', async () => {
      // Use createTestFile to create actual DB records, required for upsertLocalObject to succeed
      const entry1 = await createTestFile('file1')
      const entry2 = await createTestFile('file2')

      manager.initialize(mockSdk, TEST_INDEXER_URL)
      mockPacker.finalize.mockResolvedValueOnce([
        mockPinnedObject,
        mockPinnedObject,
      ])

      await manager.queueFiles([entry1, entry2])

      // Before flush, uploads should be in store
      expect(getActiveUploads()).toHaveLength(2)

      await manager.flush()

      // After flush, uploads should be removed
      expect(getActiveUploads()).toHaveLength(0)
      expect(getUploadState('file1')).toBeUndefined()
      expect(getUploadState('file2')).toBeUndefined()
    })

    it('creates local object in DB after successful upload', async () => {
      const entry = await createTestFile('file1')
      manager.initialize(mockSdk, TEST_INDEXER_URL)
      mockPacker.finalize.mockResolvedValueOnce([mockPinnedObject])

      await manager.queueFiles([entry])
      await manager.flush()

      // Verify local object was created in DB
      const localObjects = await readLocalObjectsForFile('file1')
      expect(localObjects).toHaveLength(1)
      expect(localObjects[0].fileId).toBe('file1')
      expect(localObjects[0].indexerURL).toBe(TEST_INDEXER_URL)
    })

    it('file record remains in DB after upload completes', async () => {
      const entry = await createTestFile('file1')
      manager.initialize(mockSdk, TEST_INDEXER_URL)
      mockPacker.finalize.mockResolvedValueOnce([mockPinnedObject])

      await manager.queueFiles([entry])
      await manager.flush()

      // Verify file record still exists
      const file = await readFileRecord('file1')
      expect(file).not.toBeNull()
      expect(file?.id).toBe('file1')
    })

    it('sets error on all files when finalize fails', async () => {
      manager.initialize(mockSdk, TEST_INDEXER_URL)
      mockPacker.finalize.mockRejectedValueOnce(new Error('Network error'))

      await manager.queueFiles([createFileEntry('file1')])
      await manager.flush()

      // Verify error state
      const upload = getUploadState('file1')
      expect(upload?.status).toBe('error')
      expect(upload?.error).toBe('Network error')
    })

    it('keeps errored files in store when some files fail during save', async () => {
      const entry1 = await createTestFile('file1')
      const entry2 = await createTestFile('file2')

      manager.initialize(mockSdk, TEST_INDEXER_URL)
      mockPacker.finalize.mockResolvedValueOnce([
        mockPinnedObject,
        mockPinnedObject,
      ])
      // pinObject succeeds for file1, fails for file2
      mockSdk.pinObject
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Pin failed'))

      await manager.queueFiles([entry1, entry2])
      await manager.flush()

      // file1 should be removed (success)
      expect(getUploadState('file1')).toBeUndefined()

      // file2 should remain with error status (failed to save)
      const upload2 = getUploadState('file2')
      expect(upload2).toBeDefined()
      expect(upload2?.status).toBe('error')
    })

    it('skips pinning for files deleted during upload', async () => {
      // file1 has a DB record (will succeed), file2 does not (deleted during upload)
      const entry1 = await createTestFile('file1')
      const entry2 = createFileEntry('file2-no-db-record')

      manager.initialize(mockSdk, TEST_INDEXER_URL)
      mockPacker.finalize.mockResolvedValueOnce([
        mockPinnedObject,
        mockPinnedObject,
      ])

      await manager.queueFiles([entry1, entry2])
      await manager.flush()

      // file1 should be removed (success)
      expect(getUploadState('file1')).toBeUndefined()

      // file2 should be removed (skipped because file was deleted)
      expect(getUploadState('file2-no-db-record')).toBeUndefined()

      // pinObject should only be called once (for file1, not file2)
      expect(mockSdk.pinObject).toHaveBeenCalledTimes(1)
    })

    it('sets error when pinObject fails and does not save to local DB', async () => {
      const entry = await createTestFile('pin-fail-file')
      manager.initialize(mockSdk, TEST_INDEXER_URL)
      mockPacker.finalize.mockResolvedValueOnce([mockPinnedObject])
      mockSdk.pinObject.mockRejectedValueOnce(new Error('Indexer unavailable'))

      await manager.queueFiles([entry])
      await manager.flush()

      // File should have error status
      const upload = getUploadState('pin-fail-file')
      expect(upload).toBeDefined()
      expect(upload?.status).toBe('error')
      expect(upload?.error).toBe('Indexer unavailable')

      // No local object should be created
      const localObjects = await readLocalObjectsForFile('pin-fail-file')
      expect(localObjects).toHaveLength(0)
    })

    it('only saves successfully pinned files when some pinObject calls fail', async () => {
      const entry1 = await createTestFile('pin-success')
      const entry2 = await createTestFile('pin-fail')

      manager.initialize(mockSdk, TEST_INDEXER_URL)
      mockPacker.finalize.mockResolvedValueOnce([
        mockPinnedObject,
        mockPinnedObject,
      ])
      // First call succeeds, second fails
      mockSdk.pinObject
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Pin failed'))

      await manager.queueFiles([entry1, entry2])
      await manager.flush()

      // pin-success should be removed from uploads (completed successfully)
      expect(getUploadState('pin-success')).toBeUndefined()

      // pin-fail should have error status
      const upload2 = getUploadState('pin-fail')
      expect(upload2).toBeDefined()
      expect(upload2?.status).toBe('error')
      expect(upload2?.error).toBe('Pin failed')

      // Only pin-success should have local object
      const objects1 = await readLocalObjectsForFile('pin-success')
      const objects2 = await readLocalObjectsForFile('pin-fail')
      expect(objects1).toHaveLength(1)
      expect(objects2).toHaveLength(0)
    })

    it('creates new packer for files added after flush', async () => {
      manager.initialize(mockSdk, TEST_INDEXER_URL)

      await manager.queueFiles([createFileEntry('file1')])
      await manager.flush()
      await manager.queueFiles([createFileEntry('file2')])

      expect(mockSdk.uploadPacked).toHaveBeenCalledTimes(2)
    })
  })

  describe('idle timeout', () => {
    it('flushes batch after idle timeout', async () => {
      manager.initialize(mockSdk, TEST_INDEXER_URL)

      await manager.queueFiles([createFileEntry('file1')])
      expect(mockPacker.finalize).not.toHaveBeenCalled()

      jest.advanceTimersByTime(PACKER_IDLE_TIMEOUT + 100)

      expect(mockPacker.finalize).toHaveBeenCalled()
    })

    it('resets timer when new file is added', async () => {
      manager.initialize(mockSdk, TEST_INDEXER_URL)

      await manager.queueFiles([createFileEntry('file1')])
      jest.advanceTimersByTime(PACKER_IDLE_TIMEOUT - 1000)
      expect(mockPacker.finalize).not.toHaveBeenCalled()

      await manager.queueFiles([createFileEntry('file2')])
      jest.advanceTimersByTime(1000) // Original timeout would fire here
      expect(mockPacker.finalize).not.toHaveBeenCalled()

      jest.advanceTimersByTime(PACKER_IDLE_TIMEOUT) // New timeout fires
      expect(mockPacker.finalize).toHaveBeenCalled()
    })
  })

  describe('threshold-based flush', () => {
    // At 90% threshold with 40 MiB slab, threshold is 36 MiB

    it('does NOT flush when below threshold', async () => {
      manager.initialize(mockSdk, TEST_INDEXER_URL)

      // 80% of slab = 96 MiB, below 90% threshold
      const file = createFileEntry('file1', Math.floor(SLAB_SIZE * 0.8))
      await manager.queueFiles([file])

      expect(mockPacker.finalize).not.toHaveBeenCalled()
    })

    it('does NOT flush when at threshold but next file would not overflow', async () => {
      manager.initialize(mockSdk, TEST_INDEXER_URL)

      // 91% of slab, above threshold
      const file1 = createFileEntry('file1', Math.floor(SLAB_SIZE * 0.91))
      await manager.queueFiles([file1])
      expect(mockPacker.finalize).not.toHaveBeenCalled()

      // Adding 5% more won't overflow (total 96%)
      const file2 = createFileEntry('file2', Math.floor(SLAB_SIZE * 0.05))
      await manager.queueFiles([file2])
      expect(mockPacker.finalize).not.toHaveBeenCalled()
    })

    it('flushes when at threshold AND next file would overflow', async () => {
      manager.initialize(mockSdk, TEST_INDEXER_URL)

      // 91% of slab, above threshold
      const file1 = createFileEntry('file1', Math.floor(SLAB_SIZE * 0.91))
      await manager.queueFiles([file1])
      expect(mockPacker.finalize).not.toHaveBeenCalled()

      // Adding 15% would overflow (91 + 15 = 106% > 100%)
      const file2 = createFileEntry('file2', Math.floor(SLAB_SIZE * 0.15))
      await manager.queueFiles([file2])

      // Should have flushed BEFORE adding file2
      expect(mockPacker.finalize).toHaveBeenCalled()
    })

    it('does NOT flush before overflow if below threshold', async () => {
      manager.initialize(mockSdk, TEST_INDEXER_URL)

      // 50% of slab, below threshold
      const file1 = createFileEntry('file1', Math.floor(SLAB_SIZE * 0.5))
      await manager.queueFiles([file1])

      // Adding 60% would overflow, but we're below threshold
      const file2 = createFileEntry('file2', Math.floor(SLAB_SIZE * 0.6))
      await manager.queueFiles([file2])

      // Should NOT flush - below threshold, let packer handle slab boundary
      expect(mockPacker.finalize).not.toHaveBeenCalled()
    })

    it('correctly calculates fill percent for partial slabs', async () => {
      manager.initialize(mockSdk, TEST_INDEXER_URL)

      // Fill exactly to threshold (90%)
      const file1 = createFileEntry(
        'file1',
        Math.floor(SLAB_SIZE * SLAB_FILL_THRESHOLD),
      )
      await manager.queueFiles([file1])
      expect(mockPacker.finalize).not.toHaveBeenCalled()

      // Add file that pushes past slab boundary
      const file2 = createFileEntry('file2', Math.floor(SLAB_SIZE * 0.15))
      await manager.queueFiles([file2])

      // Should flush because fill >= threshold AND would overflow
      expect(mockPacker.finalize).toHaveBeenCalled()
    })
  })

  describe('shutdown', () => {
    it('removes all files from upload store', async () => {
      manager.initialize(mockSdk, TEST_INDEXER_URL)

      await manager.queueFiles([
        createFileEntry('file1'),
        createFileEntry('file2'),
      ])

      // Before cancel, files should be in store
      expect(getActiveUploads()).toHaveLength(2)

      manager.shutdown()

      // After cancel, all uploads should be removed
      expect(getActiveUploads()).toHaveLength(0)
      expect(getUploadState('file1')).toBeUndefined()
      expect(getUploadState('file2')).toBeUndefined()
    })

    it('clears idle timer', async () => {
      manager.initialize(mockSdk, TEST_INDEXER_URL)

      await manager.queueFiles([createFileEntry('file1')])
      manager.shutdown()

      jest.advanceTimersByTime(PACKER_IDLE_TIMEOUT + 1000)
      expect(mockPacker.finalize).not.toHaveBeenCalled()
    })

    it('aborts batch operations via AbortSignal', async () => {
      let capturedSignal: AbortSignal | undefined

      // Capture the abort signal passed to uploadPacked
      mockSdk.uploadPacked.mockImplementation(
        async (_opts: any, asyncOpts: any) => {
          capturedSignal = asyncOpts?.signal
          return mockPacker
        },
      )

      manager.initialize(mockSdk, TEST_INDEXER_URL)
      await manager.queueFiles([createFileEntry('file1')])

      // Signal should not be aborted yet
      expect(capturedSignal).toBeDefined()
      expect(capturedSignal?.aborted).toBe(false)

      // Cancel the batch
      manager.shutdown()

      // Signal should now be aborted
      expect(capturedSignal?.aborted).toBe(true)
    })
  })

  describe('getSlabRemaining', () => {
    it('returns full slab size when no packer exists', async () => {
      manager.initialize(mockSdk, TEST_INDEXER_URL)

      const remaining = await manager.getSlabRemaining()

      expect(remaining).toBe(BigInt(SLAB_SIZE))
    })

    it('returns packer remaining when packer exists', async () => {
      manager.initialize(mockSdk, TEST_INDEXER_URL)
      mockPacker.remaining.mockResolvedValue(BigInt(5000))

      await manager.queueFiles([createFileEntry('file1')])
      const remaining = await manager.getSlabRemaining()

      expect(remaining).toBe(BigInt(5000))
    })
  })

  describe('progress callback', () => {
    it('updates progress in upload store when reported', async () => {
      manager.initialize(mockSdk, TEST_INDEXER_URL)

      let progressCallback: ((uploaded: bigint, total: bigint) => void) | null =
        null
      mockSdk.uploadPacked.mockImplementation(async (opts: any) => {
        progressCallback = opts.progressCallback.progress
        return mockPacker
      })

      await manager.queueFiles([createFileEntry('file1', 100)])

      expect(progressCallback).not.toBeNull()

      // Initial progress should be 0
      const uploadBefore = getUploadState('file1')
      expect(uploadBefore?.progress).toBe(0)

      // Simulate progress update (50%)
      progressCallback!(BigInt(50), BigInt(100))

      // Flush the RAF-batched progress update
      flushPendingUploadProgress()

      // Progress should be updated in store
      const uploadAfter = getUploadState('file1')
      expect(uploadAfter?.progress).toBeGreaterThan(0)
    })
  })

  describe('batch uploads', () => {
    it('creates separate local objects for each file', async () => {
      const entry1 = await createTestFile('batch-file-1')
      const entry2 = await createTestFile('batch-file-2')
      manager.initialize(mockSdk, TEST_INDEXER_URL)
      mockPacker.finalize.mockResolvedValueOnce([
        mockPinnedObject,
        mockPinnedObject,
      ])

      await manager.queueFiles([entry1, entry2])
      await manager.flush()

      // Each file should have its own local object
      const objects1 = await readLocalObjectsForFile('batch-file-1')
      const objects2 = await readLocalObjectsForFile('batch-file-2')

      expect(objects1).toHaveLength(1)
      expect(objects2).toHaveLength(1)
      expect(objects1[0].fileId).toBe('batch-file-1')
      expect(objects2[0].fileId).toBe('batch-file-2')
    })
  })

  describe('upload serialization', () => {
    it('queues files added during finalize and processes them after', async () => {
      manager.initialize(mockSdk, TEST_INDEXER_URL)

      // Make finalize take some time
      let resolveFinalize: () => void
      mockPacker.finalize.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveFinalize = () => resolve([mockPinnedObject])
          }),
      )

      await manager.queueFiles([createFileEntry('file1')])

      // Start flush (will block on finalize)
      const flushPromise = manager.flush()

      // Queue more files while finalize is in progress
      await manager.queueFiles([createFileEntry('file2')])

      // Should not have created a second packer yet
      expect(mockSdk.uploadPacked).toHaveBeenCalledTimes(1)

      // Complete the finalize
      resolveFinalize!()
      await flushPromise

      // Now the pending file should be processed with a new packer
      expect(mockSdk.uploadPacked).toHaveBeenCalledTimes(2)
      expect(mockPacker.add).toHaveBeenCalledTimes(2)
    })

    it('does not create concurrent packers', async () => {
      manager.initialize(mockSdk, TEST_INDEXER_URL)

      let resolveFinalize: () => void
      mockPacker.finalize.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveFinalize = () => resolve([mockPinnedObject])
          }),
      )

      await manager.queueFiles([createFileEntry('file1')])
      const flushPromise = manager.flush()

      // Queue multiple files during finalize
      await manager.queueFiles([createFileEntry('file2')])
      await manager.queueFiles([createFileEntry('file3')])

      // Still only one packer
      expect(mockSdk.uploadPacked).toHaveBeenCalledTimes(1)

      resolveFinalize!()
      await flushPromise

      // After finalize, pending files processed with new packer
      expect(mockSdk.uploadPacked).toHaveBeenCalledTimes(2)
      // file1 on first packer, file2 and file3 on second packer
      expect(mockPacker.add).toHaveBeenCalledTimes(3)
    })

    it('cancels pending files when shutdown is called', async () => {
      manager.initialize(mockSdk, TEST_INDEXER_URL)

      // Make finalize hang so we can test cancellation mid-flight
      mockPacker.finalize.mockImplementation(() => new Promise(() => {}))

      await manager.queueFiles([createFileEntry('file1')])
      manager.flush() // Don't await

      // Queue file during finalize
      await manager.queueFiles([createFileEntry('pending-file')])

      // Cancel everything
      manager.shutdown()

      // Pending file should be removed from uploads
      expect(getUploadState('pending-file')).toBeUndefined()
    })
  })

  describe('batch limits', () => {
    const MB = 1024 * 1024
    // 40 MiB slab, 10 slabs max = 400 MiB absolute limit

    it('max slabs limit triggers flush at 400MB', async () => {
      manager.initialize(mockSdk, TEST_INDEXER_URL)

      // Add files to fill exactly 10 slabs (400 MiB)
      // Using 40 MiB files = exactly 1 slab each
      for (let i = 0; i < 10; i++) {
        const file = createFileEntry(`slab-file-${i}`, MOCK_SLAB_SIZE)
        await manager.queueFiles([file])
      }

      // After 10 slabs (400 MiB), max slabs limit should trigger flush
      expect(mockPacker.finalize).toHaveBeenCalled()
    })

    it('duration timer triggers flush after 60 seconds', async () => {
      manager.initialize(mockSdk, TEST_INDEXER_URL)

      // Add data under max slabs limit
      for (let i = 0; i < 5; i++) {
        const file = createFileEntry(`duration-file-${i}`, MOCK_SLAB_SIZE)
        await manager.queueFiles([file])
      }

      expect(mockPacker.finalize).not.toHaveBeenCalled()

      // Duration timer (60 seconds) fires - forces flush
      jest.advanceTimersByTime(60000 + 100)
      expect(mockPacker.finalize).toHaveBeenCalled()
    })

    it('many small photos hit max slabs limit before 400MB', async () => {
      manager.initialize(mockSdk, TEST_INDEXER_URL)

      // 2MB photos: 20 per slab, 200 photos = 10 slabs = 400 MiB
      for (let i = 0; i < 200; i++) {
        const file = createFileEntry(`photo-${i}`, 2 * MB)
        await manager.queueFiles([file])
      }

      expect(mockPacker.finalize).toHaveBeenCalled()
    })
  })
})

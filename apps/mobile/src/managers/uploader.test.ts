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

import {
  PACKER_IDLE_TIMEOUT,
  SECTOR_SIZE,
  SLAB_FILL_THRESHOLD,
  SLAB_SIZE,
  UPLOAD_DATA_SHARDS,
  UPLOAD_MAX_INFLIGHT,
  UPLOAD_PARITY_SHARDS,
} from '@siastorage/core/config'
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
import { getActiveUploads } from '../stores/uploads'
import type { FileEntry } from './uploader'

jest.mock('react-native-sia', () => ({}))

jest.mock('@siastorage/core/encoding/fileMetadata', () => ({
  encodeFileMetadata: jest.fn(() => new Uint8Array()),
}))

const TEST_INDEXER_URL = 'https://test.indexer'

async function createTestFile(id: string, size = 1000): Promise<FileEntry> {
  const now = Date.now()
  await app().files.create({
    id,
    name: `${id}.txt`,
    type: 'text/plain',
    kind: 'file',
    size,
    hash: `hash-${id}`,
    createdAt: now,
    updatedAt: now,
    localId: null,
    addedAt: now,
    trashedAt: null,
    deletedAt: null,
  })

  const file = await app().files.getById(id)
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

let mockObjectCounter = 0
function createMockPinnedObject(): jest.Mocked<PinnedObjectInterface> {
  const objectId = `mock-object-${++mockObjectCounter}`
  return {
    id: jest.fn().mockReturnValue(objectId),
    metadata: jest.fn().mockReturnValue(new ArrayBuffer(0)),
    updateMetadata: jest.fn(),
    key: jest.fn().mockReturnValue('mock-key'),
    size: jest.fn().mockReturnValue(BigInt(1000)),
    slabs: jest.fn().mockReturnValue([]),
    createdAt: jest.fn().mockReturnValue(new Date()),
    updatedAt: jest.fn().mockReturnValue(new Date()),
    seal: jest.fn().mockReturnValue({
      id: objectId,
      slabs: [],
      encryptedDataKey: new ArrayBuffer(32),
      encryptedMetadataKey: new ArrayBuffer(32),
      encryptedMetadata: new ArrayBuffer(0),
      dataSignature: new ArrayBuffer(64),
      metadataSignature: new ArrayBuffer(64),
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  } as unknown as jest.Mocked<PinnedObjectInterface>
}

function createMockPacker(
  pinnedObject: jest.Mocked<PinnedObjectInterface>,
): jest.Mocked<PackedUploadInterface> {
  return {
    add: jest.fn().mockResolvedValue(BigInt(1000)),
    cancel: jest.fn().mockResolvedValue(undefined),
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

describe('UploadManager', () => {
  let mockPinnedObject: jest.Mocked<PinnedObjectInterface>
  let mockPacker: jest.Mocked<PackedUploadInterface>
  let mockSdk: jest.Mocked<SdkInterface>
  let manager: UploadManager

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

  function resetManager() {
    manager = new UploadManager()
  }

  function resetUploadsStore() {
    app().uploads.clear()
  }

  beforeEach(async () => {
    for (const [key, val] of Object.entries(configPatches)) {
      savedConfig[key] = realConfig[key]
      realConfig[key] = val
    }
    await initializeDB()
    jest.clearAllMocks()
    jest.useFakeTimers()
    mockObjectCounter = 0

    jest
      .spyOn(app().fs, 'getFileUri')
      .mockImplementation(async (file: any) => `file://${file.id}`)

    resetManager()
    resetUploadsStore()

    mockPinnedObject = createMockPinnedObject()
    mockPacker = createMockPacker(mockPinnedObject)
    mockSdk = createMockSdk(mockPacker)

    internal().setSdk(mockSdk as any)
    await app().settings.setIndexerURL(TEST_INDEXER_URL)
    app().connection.setState({ isConnected: true })
  })

  afterEach(async () => {
    await manager.shutdown()
    for (const [key, val] of Object.entries(savedConfig)) {
      realConfig[key] = val
    }
    jest.useRealTimers()
    await resetDb()
    resetUploadsStore()
  })

  describe('__testProcessFiles (test helper)', () => {
    it('adds files to packer and sets status to packed', async () => {
      manager.initialize(app(), internal(), defaultAdapters())

      await manager.__testProcessFiles([
        createFileEntry('file1'),
        createFileEntry('file2'),
      ])

      const upload1 = app().uploads.getEntry('file1')
      const upload2 = app().uploads.getEntry('file2')
      expect(upload1?.status).toBe('packed')
      expect(upload2?.status).toBe('packed')
      expect(getActiveUploads()).toHaveLength(2)
    })
  })

  describe('processEntry', () => {
    it('creates packer on first file', async () => {
      manager.initialize(app(), internal(), defaultAdapters())

      await manager.__testProcessFiles([createFileEntry('file1')])

      expect(mockSdk.uploadPacked).toHaveBeenCalledWith({
        maxInflight: UPLOAD_MAX_INFLIGHT,
        dataShards: UPLOAD_DATA_SHARDS,
        parityShards: UPLOAD_PARITY_SHARDS,
        progressCallback: expect.any(Object),
      })
    })

    it('reuses packer for subsequent files in same batch', async () => {
      manager.initialize(app(), internal(), defaultAdapters())

      await manager.__testProcessFiles([createFileEntry('file1')])
      await manager.__testProcessFiles([createFileEntry('file2')])

      expect(mockSdk.uploadPacked).toHaveBeenCalledTimes(1)
      expect(mockPacker.add).toHaveBeenCalledTimes(2)
    })

    it('sets error status on add failure', async () => {
      manager.initialize(app(), internal(), defaultAdapters())
      mockPacker.add.mockRejectedValueOnce(new Error('Add failed'))

      await manager.__testProcessFiles([createFileEntry('file1')])

      // Verify error state in upload store
      const upload = app().uploads.getEntry('file1')
      expect(upload?.status).toBe('error')
      expect(upload?.error).toBe('Add failed')
    })

    it('rolls back batch state when add fails, subsequent files flush correctly', async () => {
      const entry1 = await createTestFile('file1')
      const entry2 = await createTestFile('file2')
      manager.initialize(app(), internal(), defaultAdapters())

      // First add fails
      mockPacker.add.mockRejectedValueOnce(new Error('Add failed'))
      // Second add succeeds (default mock)

      await manager.__testProcessFiles([entry1, entry2])

      // Flush should finalize with only file2
      const obj2 = createMockPinnedObject()
      mockPacker.finalize.mockResolvedValueOnce([obj2])
      await manager.flush()

      // file1 errored, file2 completed
      const u1 = app().uploads.getEntry('file1')
      expect(u1?.status).toBe('error')
      const u2 = app().uploads.getEntry('file2')
      expect(u2).toBeUndefined()

      // Finalize was called with batch containing only file2
      expect(mockPacker.finalize).toHaveBeenCalled()
    })
  })

  describe('flush', () => {
    it('calls finalize on packer', async () => {
      manager.initialize(app(), internal(), defaultAdapters())

      await manager.__testProcessFiles([createFileEntry('file1')])
      await manager.flush()

      expect(mockPacker.finalize).toHaveBeenCalled()
    })

    it('removes completed uploads from store after success', async () => {
      // Use createTestFile to create actual DB records, required for upsertLocalObject to succeed
      const entry1 = await createTestFile('file1')
      const entry2 = await createTestFile('file2')

      manager.initialize(app(), internal(), defaultAdapters())
      mockPacker.finalize.mockResolvedValueOnce([
        mockPinnedObject,
        mockPinnedObject,
      ])

      await manager.__testProcessFiles([entry1, entry2])

      // Before flush, uploads should be in store
      expect(getActiveUploads()).toHaveLength(2)

      await manager.flush()

      // After flush, uploads should be removed
      expect(getActiveUploads()).toHaveLength(0)
      expect(app().uploads.getEntry('file1')).toBeUndefined()
      expect(app().uploads.getEntry('file2')).toBeUndefined()
    })

    it('creates local object in DB after successful upload', async () => {
      const entry = await createTestFile('file1')
      manager.initialize(app(), internal(), defaultAdapters())
      mockPacker.finalize.mockResolvedValueOnce([mockPinnedObject])

      await manager.__testProcessFiles([entry])
      await manager.flush()

      // Verify local object was created in DB
      const localObjects = await app().localObjects.getForFile('file1')
      expect(localObjects).toHaveLength(1)
      expect(localObjects[0].fileId).toBe('file1')
      expect(localObjects[0].indexerURL).toBe(TEST_INDEXER_URL)
    })

    it('file record remains in DB after upload completes', async () => {
      const entry = await createTestFile('file1')
      manager.initialize(app(), internal(), defaultAdapters())
      mockPacker.finalize.mockResolvedValueOnce([mockPinnedObject])

      await manager.__testProcessFiles([entry])
      await manager.flush()

      // Verify file record still exists
      const file = await app().files.getById('file1')
      expect(file).not.toBeNull()
      expect(file?.id).toBe('file1')
    })

    it('sets error on all files when finalize fails', async () => {
      manager.initialize(app(), internal(), defaultAdapters())
      mockPacker.finalize.mockRejectedValueOnce(new Error('Network error'))

      await manager.__testProcessFiles([createFileEntry('file1')])
      await manager.flush()

      // Verify error state
      const upload = app().uploads.getEntry('file1')
      expect(upload?.status).toBe('error')
      expect(upload?.error).toBe('Network error')
    })

    it('keeps errored files in store when some files fail during save', async () => {
      const entry1 = await createTestFile('file1')
      const entry2 = await createTestFile('file2')

      manager.initialize(app(), internal(), defaultAdapters())
      mockPacker.finalize.mockResolvedValueOnce([
        mockPinnedObject,
        mockPinnedObject,
      ])
      // pinObject succeeds for file1, fails for file2 (all 3 retry attempts)
      mockSdk.pinObject
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Pin failed'))
        .mockRejectedValueOnce(new Error('Pin failed'))
        .mockRejectedValueOnce(new Error('Pin failed'))

      await manager.__testProcessFiles([entry1, entry2])
      const flushPromise = manager.flush()
      await jest.advanceTimersByTimeAsync(10000)
      await flushPromise

      // file1 should be removed (success)
      expect(app().uploads.getEntry('file1')).toBeUndefined()

      // file2 should remain with error status (failed to save)
      const upload2 = app().uploads.getEntry('file2')
      expect(upload2).toBeDefined()
      expect(upload2?.status).toBe('error')
    })

    it('skips pinning for files deleted during upload', async () => {
      // file1 has a DB record (will succeed), file2 does not (deleted during upload)
      const entry1 = await createTestFile('file1')
      const entry2 = createFileEntry('file2-no-db-record')

      manager.initialize(app(), internal(), defaultAdapters())
      mockPacker.finalize.mockResolvedValueOnce([
        mockPinnedObject,
        mockPinnedObject,
      ])

      await manager.__testProcessFiles([entry1, entry2])
      await manager.flush()

      // file1 should be removed (success)
      expect(app().uploads.getEntry('file1')).toBeUndefined()

      // file2 should be removed (skipped because file was deleted)
      expect(app().uploads.getEntry('file2-no-db-record')).toBeUndefined()

      // pinObject should only be called once (for file1, not file2)
      expect(mockSdk.pinObject).toHaveBeenCalledTimes(1)
    })

    it('sets error when pinObject fails and does not save to local DB', async () => {
      const entry = await createTestFile('pin-fail-file')
      manager.initialize(app(), internal(), defaultAdapters())
      mockPacker.finalize.mockResolvedValueOnce([mockPinnedObject])
      mockSdk.pinObject
        .mockRejectedValueOnce(new Error('Indexer unavailable'))
        .mockRejectedValueOnce(new Error('Indexer unavailable'))
        .mockRejectedValueOnce(new Error('Indexer unavailable'))

      await manager.__testProcessFiles([entry])
      const flushPromise = manager.flush()
      await jest.advanceTimersByTimeAsync(10000)
      await flushPromise

      // File should have error status
      const upload = app().uploads.getEntry('pin-fail-file')
      expect(upload).toBeDefined()
      expect(upload?.status).toBe('error')
      expect(upload?.error).toBe('Failed after 3 attempts: Indexer unavailable')

      // No local object should be created
      const localObjects = await app().localObjects.getForFile('pin-fail-file')
      expect(localObjects).toHaveLength(0)
    })

    it('only saves successfully pinned files when some pinObject calls fail', async () => {
      const entry1 = await createTestFile('pin-success')
      const entry2 = await createTestFile('pin-fail')

      manager.initialize(app(), internal(), defaultAdapters())
      mockPacker.finalize.mockResolvedValueOnce([
        mockPinnedObject,
        mockPinnedObject,
      ])
      // First call succeeds, second fails (all 3 retry attempts)
      mockSdk.pinObject
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Pin failed'))
        .mockRejectedValueOnce(new Error('Pin failed'))
        .mockRejectedValueOnce(new Error('Pin failed'))

      await manager.__testProcessFiles([entry1, entry2])
      const flushPromise = manager.flush()
      await jest.advanceTimersByTimeAsync(10000)
      await flushPromise

      // pin-success should be removed from uploads (completed successfully)
      expect(app().uploads.getEntry('pin-success')).toBeUndefined()

      // pin-fail should have error status
      const upload2 = app().uploads.getEntry('pin-fail')
      expect(upload2).toBeDefined()
      expect(upload2?.status).toBe('error')
      expect(upload2?.error).toBe('Failed after 3 attempts: Pin failed')

      // Only pin-success should have local object
      const objects1 = await app().localObjects.getForFile('pin-success')
      const objects2 = await app().localObjects.getForFile('pin-fail')
      expect(objects1).toHaveLength(1)
      expect(objects2).toHaveLength(0)
    })

    it('retries pinObject on transient failure and succeeds', async () => {
      const entry = await createTestFile('retry-file')
      manager.initialize(app(), internal(), defaultAdapters())
      mockPacker.finalize.mockResolvedValueOnce([mockPinnedObject])
      // Fails once, succeeds on retry
      mockSdk.pinObject
        .mockRejectedValueOnce(new Error('Transient error'))
        .mockResolvedValueOnce(undefined)

      await manager.__testProcessFiles([entry])
      const flushPromise = manager.flush()
      await jest.advanceTimersByTimeAsync(10000)
      await flushPromise

      // Should succeed after retry — upload removed, local object created
      expect(app().uploads.getEntry('retry-file')).toBeUndefined()
      const localObjects = await app().localObjects.getForFile('retry-file')
      expect(localObjects).toHaveLength(1)
    })

    it('creates new packer for files added after flush', async () => {
      manager.initialize(app(), internal(), defaultAdapters())

      await manager.__testProcessFiles([createFileEntry('file1')])
      await manager.flush()
      await manager.__testProcessFiles([createFileEntry('file2')])

      expect(mockSdk.uploadPacked).toHaveBeenCalledTimes(2)
    })
  })

  describe('idle timeout via loop', () => {
    it('flushes batch after idle timeout', async () => {
      manager.initialize(app(), internal(), defaultAdapters())

      // Let the loop start and enter its initial poll wait
      await jest.advanceTimersByTimeAsync(0)

      manager.enqueue([createFileEntry('file1')])

      // Let the loop wake, process the entry, poll DB, and enter idle wait
      await jest.advanceTimersByTimeAsync(0)
      expect(mockPacker.finalize).not.toHaveBeenCalled()

      // Advance past idle timeout
      await jest.advanceTimersByTimeAsync(PACKER_IDLE_TIMEOUT)

      expect(mockPacker.finalize).toHaveBeenCalled()
    })

    it('resets idle timer when new file is enqueued', async () => {
      manager.initialize(app(), internal(), defaultAdapters())
      // Flush microtasks so the loop starts, polls DB (empty), and enters wait
      await jest.advanceTimersByTimeAsync(0)

      manager.enqueue([createFileEntry('file1')])
      // Flush microtasks so the loop wakes, processes file1, and enters idle wait
      await jest.advanceTimersByTimeAsync(0)
      expect(mockPacker.finalize).not.toHaveBeenCalled()

      // Advance partway through idle timeout
      await jest.advanceTimersByTimeAsync(PACKER_IDLE_TIMEOUT - 1000)
      expect(mockPacker.finalize).not.toHaveBeenCalled()

      // Enqueue another file — this wakes the loop, resetting the idle cycle
      manager.enqueue([createFileEntry('file2')])
      // Flush microtasks so the loop wakes, processes file2, and re-enters idle wait
      await jest.advanceTimersByTimeAsync(0)

      // Original timeout would have fired by now but shouldn't
      await jest.advanceTimersByTimeAsync(1000)
      expect(mockPacker.finalize).not.toHaveBeenCalled()

      // New full idle timeout fires
      await jest.advanceTimersByTimeAsync(PACKER_IDLE_TIMEOUT)
      expect(mockPacker.finalize).toHaveBeenCalled()
    })
  })

  describe('threshold-based flush', () => {
    // At 90% threshold with 40 MiB slab, threshold is 36 MiB

    it('does NOT flush when below threshold', async () => {
      manager.initialize(app(), internal(), defaultAdapters())

      // 80% of slab = 96 MiB, below 90% threshold
      const file = createFileEntry('file1', Math.floor(SLAB_SIZE * 0.8))
      await manager.__testProcessFiles([file])

      expect(mockPacker.finalize).not.toHaveBeenCalled()
    })

    it('does NOT flush when at threshold but next file would not overflow', async () => {
      manager.initialize(app(), internal(), defaultAdapters())

      // 91% of slab, above threshold
      const file1 = createFileEntry('file1', Math.floor(SLAB_SIZE * 0.91))
      await manager.__testProcessFiles([file1])
      expect(mockPacker.finalize).not.toHaveBeenCalled()

      // Adding 5% more won't overflow (total 96%)
      const file2 = createFileEntry('file2', Math.floor(SLAB_SIZE * 0.05))
      await manager.__testProcessFiles([file2])
      expect(mockPacker.finalize).not.toHaveBeenCalled()
    })

    it('flushes when at threshold AND next file would overflow', async () => {
      manager.initialize(app(), internal(), defaultAdapters())

      // 91% of slab, above threshold
      const file1 = createFileEntry('file1', Math.floor(SLAB_SIZE * 0.91))
      await manager.__testProcessFiles([file1])
      expect(mockPacker.finalize).not.toHaveBeenCalled()

      // Adding 15% would overflow (91 + 15 = 106% > 100%)
      const file2 = createFileEntry('file2', Math.floor(SLAB_SIZE * 0.15))
      await manager.__testProcessFiles([file2])

      // Should have flushed BEFORE adding file2
      expect(mockPacker.finalize).toHaveBeenCalled()
    })

    it('does NOT flush before overflow if below threshold', async () => {
      manager.initialize(app(), internal(), defaultAdapters())

      // 50% of slab, below threshold
      const file1 = createFileEntry('file1', Math.floor(SLAB_SIZE * 0.5))
      await manager.__testProcessFiles([file1])

      // Adding 60% would overflow, but we're below threshold
      const file2 = createFileEntry('file2', Math.floor(SLAB_SIZE * 0.6))
      await manager.__testProcessFiles([file2])

      // Should NOT flush - below threshold, let packer handle slab boundary
      expect(mockPacker.finalize).not.toHaveBeenCalled()
    })

    it('correctly calculates fill percent for partial slabs', async () => {
      manager.initialize(app(), internal(), defaultAdapters())

      // Fill exactly to threshold (90%)
      const file1 = createFileEntry(
        'file1',
        Math.floor(SLAB_SIZE * SLAB_FILL_THRESHOLD),
      )
      await manager.__testProcessFiles([file1])
      expect(mockPacker.finalize).not.toHaveBeenCalled()

      // Add file that pushes past slab boundary
      const file2 = createFileEntry('file2', Math.floor(SLAB_SIZE * 0.15))
      await manager.__testProcessFiles([file2])

      // Should flush because fill >= threshold AND would overflow
      expect(mockPacker.finalize).toHaveBeenCalled()
    })
  })

  describe('shutdown', () => {
    it('removes all files from upload store', async () => {
      manager.initialize(app(), internal(), defaultAdapters())

      await manager.__testProcessFiles([
        createFileEntry('file1'),
        createFileEntry('file2'),
      ])

      // Before cancel, files should be in store
      expect(getActiveUploads()).toHaveLength(2)

      await manager.shutdown()

      // After cancel, all uploads should be removed
      expect(getActiveUploads()).toHaveLength(0)
      expect(app().uploads.getEntry('file1')).toBeUndefined()
      expect(app().uploads.getEntry('file2')).toBeUndefined()
    })

    it('stops the loop', async () => {
      manager.initialize(app(), internal(), defaultAdapters())

      await manager.__testProcessFiles([createFileEntry('file1')])
      await manager.shutdown()

      // Advancing timers should not trigger finalize since loop is stopped
      await jest.advanceTimersByTimeAsync(PACKER_IDLE_TIMEOUT + 1000)
      expect(mockPacker.finalize).not.toHaveBeenCalled()
    })

    it('cancels inflight uploads via packer.cancel()', async () => {
      manager.initialize(app(), internal(), defaultAdapters())
      await manager.__testProcessFiles([createFileEntry('file1')])

      expect(mockPacker.cancel).not.toHaveBeenCalled()

      await manager.shutdown()

      expect(mockPacker.cancel).toHaveBeenCalledTimes(1)
    })

    it('removes enqueued files from upload store', async () => {
      manager.initialize(app(), internal(), defaultAdapters())

      // Enqueue files (they get registered in store)
      manager.enqueue([createFileEntry('queued-file')])

      // Before shutdown, file should be in store
      expect(app().uploads.getEntry('queued-file')).toBeDefined()

      await manager.shutdown()

      // After shutdown, queued file should be removed
      expect(app().uploads.getEntry('queued-file')).toBeUndefined()
    })

    it('stops processing remaining files in the current batch', async () => {
      let addCallCount = 0
      mockPacker.add.mockImplementation(async () => {
        addCallCount++
        if (addCallCount === 2) {
          manager.shutdown()
        }
        return BigInt(1000)
      })

      manager.initialize(app(), internal(), defaultAdapters())
      const files = Array.from({ length: 15 }, (_, i) =>
        createFileEntry(`s-file${i}`),
      )
      manager.enqueue(files)

      // Flush #1: loop starts, pollDB returns 0, enters PACKER_POLL_INTERVAL wait.
      await jest.advanceTimersByTimeAsync(0)
      // Advance past poll interval so the loop wakes and re-polls (finds queued files).
      await jest.advanceTimersByTimeAsync(5000)
      // Flush microtasks so processEntries runs — add #2 triggers shutdown.
      await jest.advanceTimersByTimeAsync(0)

      // processEntry handles file 0 (creates packer, add #1).
      // processWindow starts firing adds for files 1-10. Add #2 triggers
      // shutdown which sets active=false. The fire loop checks active and
      // stops — files 2-14 are never added to the packer.
      expect(addCallCount).toBe(2)
    })
  })

  describe('progress callback', () => {
    it('updates progress in upload store when reported', async () => {
      manager.initialize(app(), internal(), {
        createFileReader: jest.fn(() => ({
          read: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
        })),
        progressScheduler: (cb) => cb(),
      })

      let progressCallback: ((uploaded: bigint, total: bigint) => void) | null =
        null
      mockSdk.uploadPacked.mockImplementation(async (opts: any) => {
        progressCallback = opts.progressCallback.progress
        return mockPacker
      })

      await manager.__testProcessFiles([createFileEntry('file1', 100)])

      expect(progressCallback).not.toBeNull()

      // Initial progress should be 0
      const uploadBefore = app().uploads.getEntry('file1')
      expect(uploadBefore?.progress).toBe(0)

      // Simulate progress update (50%)
      progressCallback!(BigInt(50), BigInt(100))

      // Progress should be updated in store (progressScheduler applies synchronously)
      const uploadAfter = app().uploads.getEntry('file1')
      expect(uploadAfter?.progress).toBeGreaterThan(0)
    })

    it('progress never decreases when SDK encoded total grows at slab boundaries', async () => {
      const fileSize = Math.floor(SLAB_SIZE * 1.5)
      manager.initialize(app(), internal(), {
        createFileReader: jest.fn(() => ({
          read: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
        })),
        progressScheduler: (cb) => cb(),
      })

      let progressCallback: ((uploaded: bigint, total: bigint) => void) | null =
        null
      mockSdk.uploadPacked.mockImplementation(async (opts: any) => {
        progressCallback = opts.progressCallback.progress
        return mockPacker
      })

      await manager.__testProcessFiles([
        createFileEntry('multi-slab', fileSize),
      ])
      expect(progressCallback).not.toBeNull()

      // Our stable denominator: ceil(1.5 slabs) = 2 slabs worth of encoded sectors
      const expectedEncoded =
        2 * (UPLOAD_DATA_SHARDS + UPLOAD_PARITY_SHARDS) * SECTOR_SIZE

      // Simulate SDK sawtooth: first slab uploads with total = 1 slab of sectors,
      // then second slab starts and total jumps to 2 slabs of sectors.
      const oneSlab = (UPLOAD_DATA_SHARDS + UPLOAD_PARITY_SHARDS) * SECTOR_SIZE

      const calls: [bigint, bigint][] = [
        [BigInt(oneSlab / 2), BigInt(oneSlab)], // 50% of first slab
        [BigInt(oneSlab), BigInt(oneSlab)], // first slab done (SDK: 100%)
        [BigInt(oneSlab), BigInt(expectedEncoded)], // SDK total jumps (SDK: 50% — sawtooth!)
        [BigInt(oneSlab * 1.5), BigInt(expectedEncoded)], // more progress
      ]

      let prevProgress = 0
      for (const [uploaded, total] of calls) {
        progressCallback!(uploaded, total)
        const entry = app().uploads.getEntry('multi-slab')
        expect(entry?.progress).toBeGreaterThanOrEqual(prevProgress)
        prevProgress = entry?.progress ?? 0
      }
      expect(prevProgress).toBeGreaterThan(0)
    })
  })

  describe('batch uploads', () => {
    it('creates separate local objects for each file', async () => {
      const entry1 = await createTestFile('batch-file-1')
      const entry2 = await createTestFile('batch-file-2')
      manager.initialize(app(), internal(), defaultAdapters())
      const po2 = createMockPinnedObject()
      mockPacker.finalize.mockResolvedValueOnce([mockPinnedObject, po2])

      await manager.__testProcessFiles([entry1, entry2])
      await manager.flush()

      // Each file should have its own local object
      const objects1 = await app().localObjects.getForFile('batch-file-1')
      const objects2 = await app().localObjects.getForFile('batch-file-2')

      expect(objects1).toHaveLength(1)
      expect(objects2).toHaveLength(1)
      expect(objects1[0].fileId).toBe('batch-file-1')
      expect(objects2[0].fileId).toBe('batch-file-2')
    })
  })

  describe('upload serialization', () => {
    it('files enqueued during flush end up in a new batch', async () => {
      manager.initialize(app(), internal(), defaultAdapters())

      await manager.__testProcessFiles([createFileEntry('file1')])

      // Make finalize take some time
      let resolveFinalize: () => void
      mockPacker.finalize.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveFinalize = () => resolve([mockPinnedObject])
          }),
      )

      // Start flush (will block on finalize)
      const flushPromise = manager.flush()

      // Add more files directly while flush is in progress
      await manager.__testProcessFiles([createFileEntry('file2')])

      // Should have created a second packer since flush cleared the first
      expect(mockSdk.uploadPacked).toHaveBeenCalledTimes(2)

      // Complete the finalize
      resolveFinalize!()
      await flushPromise

      // Both files processed
      expect(mockPacker.add).toHaveBeenCalledTimes(2)
    })
  })

  describe('batch limits', () => {
    const MB = 1024 * 1024
    // 40 MiB slab, 10 slabs max = 400 MiB absolute limit

    it('max slabs limit triggers flush at 400MB', async () => {
      manager.initialize(app(), internal(), defaultAdapters())

      // Add files to fill exactly 10 slabs (400 MiB)
      // Using 40 MiB files = exactly 1 slab each
      for (let i = 0; i < 10; i++) {
        const file = createFileEntry(`slab-file-${i}`, MOCK_SLAB_SIZE)
        await manager.__testProcessFiles([file])
      }

      // After 10 slabs (400 MiB), max slabs limit should trigger flush
      expect(mockPacker.finalize).toHaveBeenCalled()
    })

    it('duration exceeded triggers flush on next loop iteration', async () => {
      manager.initialize(app(), internal(), defaultAdapters())

      // Enqueue files through the loop with gaps just under
      // PACKER_IDLE_TIMEOUT so they count as active time.
      // 16 files × 4s = 64s > 60s PACKER_MAX_BATCH_DURATION
      const gap = PACKER_IDLE_TIMEOUT - 1000
      for (let i = 0; i < 16; i++) {
        manager.enqueue([createFileEntry(`duration-file-${i}`, 1000)])
        // Flush microtasks so the loop wakes, processes the file, and enters idle wait
        await jest.advanceTimersByTimeAsync(0)
        // Advance clock synchronously — stays under idle timeout so no flush,
        // but accumulates toward max batch duration
        jest.advanceTimersByTime(gap)
      }

      // One more file triggers the duration check in processEntries
      manager.enqueue([createFileEntry('duration-trigger', 1000)])
      // Flush microtasks so processEntries runs and checks batchExceedsDuration()
      await jest.advanceTimersByTimeAsync(0)

      expect(mockPacker.finalize).toHaveBeenCalled()
      expect(manager.flushHistory[0].reason).toBe('max_duration')
    })

    it('duration exceeded mid-window triggers flush after window completes', async () => {
      manager.initialize(app(), internal(), defaultAdapters())

      // Flush microtasks so the loop starts, polls DB (empty), and enters poll wait
      await jest.advanceTimersByTimeAsync(0)

      // Enqueue one file to create the packer and batch
      manager.enqueue([createFileEntry('setup', 1000)])
      // Multiple flushes needed: the loop wakes, processes the file (creating
      // packer+batch), polls DB again, and enters idle wait. Each async step
      // (pollDB, processEntry, waitForWorkOrTimeout) requires a separate flush.
      for (let i = 0; i < 10; i++) {
        await jest.advanceTimersByTimeAsync(0)
      }
      expect(manager.packedCount).toBe(1)
      expect(manager.flushHistory).toHaveLength(0)
      expect((manager as any).batch).not.toBeNull()

      // Backdate batch startedAt so the next window exceeds 60s.
      // Set lastProcessedAt close to now so recordAdd won't treat
      // subsequent adds as suspension gaps.
      const mgr = manager as any
      mgr.batch.startedAt = Date.now() - 61_000
      mgr.batch.lastProcessedAt = Date.now()

      // Enqueue 10 more files at once. The loop drains them all into
      // processEntries -> processWindow (pipelined path). Duration is checked
      // after the window completes, so all 10 files are packed before flush.
      const files = Array.from({ length: 10 }, (_, i) =>
        createFileEntry(`window-dur-${i}`, 1000),
      )
      manager.enqueue(files)
      // Multiple flushes needed: the loop wakes, drains queue into
      // processEntries, which pipelines adds. Each awaited add and the
      // post-window flush check require separate microtask flushes.
      for (let i = 0; i < 15; i++) {
        await jest.advanceTimersByTimeAsync(0)
      }

      expect(manager.flushHistory.length).toBeGreaterThanOrEqual(1)
      expect(manager.flushHistory[0].reason).toBe('max_duration')
      // All 11 files (setup + 10) are in the batch since duration is
      // checked after the window, not mid-window.
      expect(manager.flushHistory[0].fileCount).toBe(11)
    })

    it('app suspension does not count toward max batch duration', async () => {
      manager.initialize(app(), internal(), defaultAdapters())

      // Process first file to start a batch
      manager.enqueue([createFileEntry('pre-suspend', 1000)])
      await jest.advanceTimersByTimeAsync(0)
      expect(manager.flushHistory).toHaveLength(0)

      // Simulate iOS suspension: advance clock 5 minutes, then resume
      jest.advanceTimersByTime(5 * 60 * 1000)
      manager.adjustBatchForSuspension()

      // Process another file — suspension time is excluded
      manager.enqueue([createFileEntry('post-suspend', 1000)])
      await jest.advanceTimersByTimeAsync(0)
      expect(manager.flushHistory).toHaveLength(0)

      // The batch is still open — flush via idle timeout
      await jest.advanceTimersByTimeAsync(PACKER_IDLE_TIMEOUT)
      expect(manager.flushHistory).toHaveLength(1)
      expect(manager.flushHistory[0].reason).toBe('idle_timeout')
      expect(manager.flushHistory[0].fileCount).toBe(2)
    })

    it('app suspension before first file does not trigger max_duration', async () => {
      manager.initialize(app(), internal(), defaultAdapters())

      // Simulate suspension before any files are processed
      jest.advanceTimersByTime(5 * 60 * 1000)
      manager.adjustBatchForSuspension()

      manager.enqueue([createFileEntry('first-file', 1000)])
      await jest.advanceTimersByTimeAsync(0)
      expect(manager.flushHistory).toHaveLength(0)

      manager.enqueue([createFileEntry('second-file', 1000)])
      await jest.advanceTimersByTimeAsync(0)
      expect(manager.flushHistory).toHaveLength(0)

      // Flush via idle timeout
      await jest.advanceTimersByTimeAsync(PACKER_IDLE_TIMEOUT)
      expect(manager.flushHistory).toHaveLength(1)
      expect(manager.flushHistory[0].reason).toBe('idle_timeout')
      expect(manager.flushHistory[0].fileCount).toBe(2)
    })

    it('many small photos hit max slabs limit before 400MB', async () => {
      manager.initialize(app(), internal(), defaultAdapters())

      // 2MB photos: 20 per slab, 200 photos = 10 slabs = 400 MiB
      for (let i = 0; i < 200; i++) {
        const file = createFileEntry(`photo-${i}`, 2 * MB)
        await manager.__testProcessFiles([file])
      }

      expect(mockPacker.finalize).toHaveBeenCalled()
    })
  })

  describe('loop with DB polling', () => {
    let queryFilesSpy: jest.SpyInstance

    function enablePolling() {
      app().connection.setState({ isConnected: true })
      void app().settings.setAutoScanUploads(true)
    }

    beforeEach(() => {
      queryFilesSpy = jest
        .spyOn(app().files, 'query')
        .mockResolvedValue([] as any)
    })

    afterEach(() => {
      queryFilesSpy.mockRestore()
      app().connection.setState({ isConnected: false })
      void app().settings.setAutoScanUploads(false)
    })

    function createDBFiles(
      count: number,
      opts: { prefix?: string; size?: number } = {},
    ) {
      const { prefix = 'db', size = 400 } = opts
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

    it('drains all polled files into one batch before idle flush', async () => {
      enablePolling()
      queryFilesSpy
        .mockResolvedValueOnce(createDBFiles(20))
        .mockResolvedValue([] as any)

      manager.initialize(app(), internal(), defaultAdapters())
      // Flush microtasks: loop starts -> pollDB finds 20 files ->
      // drainQueues -> processEntries adds all 20
      await jest.advanceTimersByTimeAsync(0)

      expect(mockPacker.add).toHaveBeenCalledTimes(20)
      expect(mockPacker.finalize).not.toHaveBeenCalled()

      // Idle timeout triggers: loop re-polls (empty) -> flushes
      await jest.advanceTimersByTimeAsync(PACKER_IDLE_TIMEOUT)
      expect(mockPacker.finalize).toHaveBeenCalledTimes(1)
      expect(manager.flushHistory).toHaveLength(1)
      expect(manager.flushHistory[0].fileCount).toBe(20)
      expect(manager.flushHistory[0].reason).toBe('idle_timeout')
    })

    it('re-polls DB and processes additional files found', async () => {
      enablePolling()
      const wave1 = createDBFiles(5, { prefix: 'w1' })
      const wave2 = createDBFiles(5, { prefix: 'w2' })
      queryFilesSpy
        .mockResolvedValueOnce(wave1)
        .mockResolvedValueOnce(wave2)
        .mockResolvedValue([] as any)

      manager.initialize(app(), internal(), defaultAdapters())
      // Flush microtasks: loop polls twice (wave1 -> wave2) and processes all 10
      await jest.advanceTimersByTimeAsync(0)

      expect(mockPacker.add).toHaveBeenCalledTimes(10)

      // Idle timeout -> re-poll (empty) -> flush
      await jest.advanceTimersByTimeAsync(PACKER_IDLE_TIMEOUT)
      expect(mockPacker.finalize).toHaveBeenCalledTimes(1)
      expect(manager.flushHistory[0].fileCount).toBe(10)
    })

    it('re-polls before idle flush catches late-arriving files', async () => {
      enablePolling()
      const wave1 = createDBFiles(3, { prefix: 'w1' })
      const wave2 = createDBFiles(3, { prefix: 'w2' })
      queryFilesSpy
        .mockResolvedValueOnce(wave1)
        .mockResolvedValueOnce([] as any)

      manager.initialize(app(), internal(), defaultAdapters())
      await jest.advanceTimersByTimeAsync(0)
      expect(mockPacker.add).toHaveBeenCalledTimes(3)

      // Wave2 appears in DB during idle wait
      queryFilesSpy.mockResolvedValueOnce(wave2).mockResolvedValue([] as any)

      // Idle timeout -> re-poll -> finds wave2 -> processes them
      await jest.advanceTimersByTimeAsync(PACKER_IDLE_TIMEOUT)
      expect(mockPacker.add).toHaveBeenCalledTimes(6)
      expect(mockPacker.finalize).not.toHaveBeenCalled()

      // Second idle timeout -> re-poll (all excluded) -> flush
      await jest.advanceTimersByTimeAsync(PACKER_IDLE_TIMEOUT)
      expect(mockPacker.finalize).toHaveBeenCalledTimes(1)
      expect(manager.flushHistory[0].fileCount).toBe(6)
    })

    it('processes explicit and polled files together', async () => {
      enablePolling()
      queryFilesSpy
        .mockResolvedValueOnce(createDBFiles(3))
        .mockResolvedValue([] as any)

      manager.initialize(app(), internal(), defaultAdapters())
      manager.enqueue([createFileEntry('explicit-1')])
      await jest.advanceTimersByTimeAsync(0)

      expect(mockPacker.add).toHaveBeenCalledTimes(4)
    })

    it('does not poll when disconnected', async () => {
      app().connection.setState({ isConnected: false })
      void app().settings.setAutoScanUploads(true)
      queryFilesSpy.mockResolvedValue(createDBFiles(5))

      manager.initialize(app(), internal(), defaultAdapters())
      await jest.advanceTimersByTimeAsync(0)

      expect(mockPacker.add).not.toHaveBeenCalled()
      expect(queryFilesSpy).not.toHaveBeenCalled()
    })

    it('does not poll when auto-scan is disabled', async () => {
      app().connection.setState({ isConnected: true })
      void app().settings.setAutoScanUploads(false)
      queryFilesSpy.mockResolvedValue(createDBFiles(5))

      manager.initialize(app(), internal(), defaultAdapters())
      await jest.advanceTimersByTimeAsync(0)

      expect(mockPacker.add).not.toHaveBeenCalled()
    })

    it('skips files with empty hash (placeholder files still processing)', async () => {
      enablePolling()
      const filesWithEmptyHash = [
        {
          id: 'empty-hash-1',
          name: 'empty-hash-1.bin',
          size: 400,
          type: 'application/octet-stream',
          hash: '',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          localId: null,
          addedAt: Date.now(),
          objects: {},
        },
        {
          id: 'has-hash-1',
          name: 'has-hash-1.bin',
          size: 400,
          type: 'application/octet-stream',
          hash: 'sha256:abc123',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          localId: null,
          addedAt: Date.now(),
          objects: {},
        },
        {
          id: 'empty-hash-2',
          name: 'empty-hash-2.bin',
          size: 400,
          type: 'application/octet-stream',
          hash: '',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          localId: null,
          addedAt: Date.now(),
          objects: {},
        },
      ]
      queryFilesSpy
        .mockResolvedValueOnce(filesWithEmptyHash)
        .mockResolvedValue([] as any)

      manager.initialize(app(), internal(), defaultAdapters())
      await jest.advanceTimersByTimeAsync(0)

      // Only the file with a hash should be added to the packer
      expect(mockPacker.add).toHaveBeenCalledTimes(1)

      // Only has-hash-1 should be registered in the upload store
      expect(app().uploads.getEntry('has-hash-1')).toBeDefined()
      expect(app().uploads.getEntry('empty-hash-1')).toBeUndefined()
      expect(app().uploads.getEntry('empty-hash-2')).toBeUndefined()
    })

    it('excludeIds allows polling past the 200-file query limit', async () => {
      // Without excludeIds, a second poll would return the same 200 files
      // (still local-only until pin), JS filter removes them all, and idle
      // timeout flushes a small batch. With excludeIds, the second poll
      // skips already-active files and returns the next batch.
      enablePolling()
      const batch1 = createDBFiles(200, { prefix: 'a', size: 100 })
      const batch2 = createDBFiles(100, { prefix: 'b', size: 100 })
      queryFilesSpy
        .mockResolvedValueOnce(batch1)
        .mockResolvedValueOnce(batch2)
        .mockResolvedValue([] as any)

      manager.initialize(app(), internal(), defaultAdapters())
      await jest.advanceTimersByTimeAsync(0)

      expect(mockPacker.add).toHaveBeenCalledTimes(300)

      await jest.advanceTimersByTimeAsync(PACKER_IDLE_TIMEOUT)
      const totalFiles = manager.flushHistory.reduce(
        (sum, h) => sum + h.fileCount,
        0,
      )
      expect(totalFiles).toBe(300)
    })
  })

  describe('abandoned promise handling', () => {
    it('no uncaught rejections when packer.add() promises reject after shutdown', async () => {
      type Deferred = {
        resolve: (v: bigint) => void
        reject: (e: Error) => void
      }
      const deferreds: Deferred[] = []
      let addCount = 0

      mockPacker.add.mockImplementation(() => {
        addCount++
        if (addCount === 1) return Promise.resolve(BigInt(1000))
        return new Promise<bigint>((resolve, reject) => {
          deferreds.push({ resolve, reject })
        })
      })

      manager.initialize(app(), internal(), defaultAdapters())
      await jest.advanceTimersByTimeAsync(0)

      manager.enqueue(
        Array.from({ length: 5 }, (_, i) => createFileEntry(`ab-${i}`)),
      )
      await jest.advanceTimersByTimeAsync(5000)
      await jest.advanceTimersByTimeAsync(0)
      expect(deferreds).toHaveLength(4)

      // Resolve first two, shutdown mid-processing, then reject the rest.
      // Without the catch handler these would be uncaught rejections.
      deferreds[0].resolve(BigInt(1000))
      await jest.advanceTimersByTimeAsync(0)
      manager.shutdown()
      deferreds[1].resolve(BigInt(1000))
      await jest.advanceTimersByTimeAsync(0)
      deferreds[2].reject(new Error('buffer closed'))
      deferreds[3].reject(new Error('buffer closed'))
      await jest.advanceTimersByTimeAsync(0)
    })
  })

  describe('error recovery', () => {
    it('loop continues processing after finalize error', async () => {
      mockPacker.finalize
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue([mockPinnedObject] as any)

      manager.initialize(app(), internal(), defaultAdapters())

      // Batch 1 — finalize will fail
      manager.enqueue([createFileEntry('fail-1', 100)])
      await jest.advanceTimersByTimeAsync(PACKER_IDLE_TIMEOUT)
      await jest.advanceTimersByTimeAsync(PACKER_IDLE_TIMEOUT)

      expect(manager.flushHistory).toHaveLength(1)
      expect(app().uploads.getEntry('fail-1')?.status).toBe('error')

      // Batch 2 — loop should still be alive and process new files
      manager.enqueue([createFileEntry('ok-1', 100)])
      await jest.advanceTimersByTimeAsync(PACKER_IDLE_TIMEOUT)
      await jest.advanceTimersByTimeAsync(PACKER_IDLE_TIMEOUT)

      expect(manager.flushHistory).toHaveLength(2)
      expect(manager.flushHistory[1].fileCount).toBe(1)
      expect(app().uploads.getEntry('ok-1')).toBeUndefined()
    })
  })

  describe('initializeUploader', () => {
    it('shuts down existing manager before re-initializing', async () => {
      const { initializeUploader } = require('./uploader')
      const shutdownSpy = jest.spyOn(manager, 'shutdown')
      const getManagerSpy = jest
        .spyOn(require('../stores/appService'), 'getUploadManager')
        .mockReturnValue(manager)

      // First initialization — shuts down the existing manager
      await initializeUploader()
      expect(shutdownSpy).toHaveBeenCalledTimes(1)

      shutdownSpy.mockClear()

      // Second initialization — should shut down the existing manager first
      await initializeUploader()
      expect(shutdownSpy).toHaveBeenCalledTimes(1)

      shutdownSpy.mockRestore()
      getManagerSpy.mockRestore()
    })
  })
})

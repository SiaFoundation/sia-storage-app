/**
 * Tests that two devices converge to identical state through syncDown/syncUp.
 *
 * Architecture constraint: global singletons prevent running two harnesses
 * simultaneously. Tests simulate multi-device by running Device A → shutdown →
 * Device B sequentially, sharing a single MockSdkStorage so both see the same
 * indexer objects and events.
 */

import './utils/setup'

import { decodeFileMetadata } from '@siastorage/core/encoding/fileMetadata'
import { permanentlyDeleteFiles, trashFiles } from '../src/lib/deleteFile'
import { readAllFileRecords, readFileRecord } from '../src/stores/files'
import { readLocalObjectsForFile } from '../src/stores/localObjects'
import { readThumbnailsByFileId } from '../src/stores/thumbnails'
import {
  addTestFilesToHarness,
  createHarness,
  generateTestFiles,
} from './utils/harness'
import {
  createEmptyStorage,
  MockSdk,
  type MockSdkStorage,
} from './utils/mockSdk'
import { waitForCondition } from './utils/waitFor'

/**
 * Wait for syncUp to push v1 metadata for all objects in shared storage.
 * Polls the stored objects until every one has version:1 in its decoded metadata.
 */
async function waitForAllObjectsV1(
  storage: MockSdkStorage,
  expectedCount: number,
  timeout = 15_000,
): Promise<void> {
  await waitForCondition(
    () => {
      const objects = Array.from(storage.objects.values())
      if (objects.length < expectedCount) return false
      return objects.every((obj) => {
        try {
          const raw = JSON.parse(new TextDecoder().decode(obj.metadata))
          return raw.version === 1
        } catch {
          return false
        }
      })
    },
    { timeout, message: `All ${expectedCount} objects to have v1 metadata` },
  )
}

describe('Multi-Device Convergence', () => {
  it('v1 ↔ v1: files uploaded by Device A appear on Device B', async () => {
    const sharedStorage = createEmptyStorage()

    // Device A: upload 3 data files, wait for syncUp to push v1 metadata
    const sdkA = new MockSdk(sharedStorage)
    const harnessA = createHarness({ sdk: sdkA })
    await harnessA.start()

    const fileFactories = generateTestFiles(3, { type: 'data' })
    await addTestFilesToHarness(harnessA, fileFactories)
    await harnessA.waitForNoActiveUploads()

    // Wait for syncUp to push v1 metadata for all 3 objects
    await waitForAllObjectsV1(sharedStorage, 3)

    const deviceAFiles = await readAllFileRecords({ order: 'ASC' })
    expect(deviceAFiles).toHaveLength(3)

    await harnessA.shutdown()

    // Device B: sync down the v1 metadata from shared storage
    const sdkB = new MockSdk(sharedStorage)
    const harnessB = createHarness({ sdk: sdkB })
    await harnessB.start()

    await harnessB.waitForFileCount(3)

    const deviceBFiles = await readAllFileRecords({ order: 'ASC' })
    expect(deviceBFiles).toHaveLength(3)

    // Every file from Device A should have a matching file on Device B
    for (const fileA of deviceAFiles) {
      const fileB = deviceBFiles.find((f) => f.id === fileA.id)
      expect(fileB).toBeDefined()
      expect(fileB!.name).toBe(fileA.name)
      expect(fileB!.hash).toBe(fileA.hash)
      expect(fileB!.size).toBe(fileA.size)
      expect(fileB!.kind).toBe(fileA.kind)
    }

    await harnessB.shutdown()
  }, 60_000)

  it('v1 thumbnail with thumbForId syncs correctly to Device B', async () => {
    const sharedStorage = createEmptyStorage()

    // Device A: upload 1 data file, wait for v1 metadata
    const sdkA = new MockSdk(sharedStorage)
    const harnessA = createHarness({ sdk: sdkA })
    await harnessA.start()

    const fileFactories = generateTestFiles(1, { type: 'data' })
    await addTestFilesToHarness(harnessA, fileFactories)
    await harnessA.waitForNoActiveUploads()
    await waitForAllObjectsV1(sharedStorage, 1)

    const deviceAFiles = await readAllFileRecords({ order: 'ASC' })
    const parentFileId = deviceAFiles[0].id

    // Inject a v1 thumbnail for the parent file directly
    sdkA.injectObject({
      metadata: {
        id: `thumb-for-${parentFileId}`,
        name: 'thumb.webp',
        type: 'image/webp',
        kind: 'thumb',
        size: 256,
        hash: 'thumb-hash-123',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        thumbForId: parentFileId,
        thumbSize: 64,
        trashedAt: null,
      },
    })

    // Wait for Device A to sync the thumbnail
    await harnessA.waitForFileCount(2)

    const deviceAAllFiles = await readAllFileRecords({ order: 'ASC' })
    const deviceAThumb = deviceAAllFiles.find((f) => f.kind === 'thumb')!
    expect(deviceAThumb.thumbForId).toBe(parentFileId)

    await harnessA.shutdown()

    // Device B: sync both file and thumbnail
    const sdkB = new MockSdk(sharedStorage)
    const harnessB = createHarness({ sdk: sdkB })
    await harnessB.start()

    await harnessB.waitForFileCount(2)

    const deviceBFiles = await readAllFileRecords({ order: 'ASC' })
    const deviceBFile = deviceBFiles.find((f) => f.kind === 'file')!
    const deviceBThumb = deviceBFiles.find((f) => f.kind === 'thumb')!

    expect(deviceBFile.id).toBe(parentFileId)
    expect(deviceBThumb.thumbForId).toBe(parentFileId)

    // Thumbnail discoverable via parent file ID
    const thumbs = await readThumbnailsByFileId(parentFileId)
    expect(thumbs).toHaveLength(1)
    expect(thumbs[0].id).toBe(deviceAThumb.id)

    await harnessB.shutdown()
  }, 60_000)

  it('delete propagation: file deleted on Device A is removed on Device B', async () => {
    const sharedStorage = createEmptyStorage()

    // Device A: upload 3 data files
    const sdkA = new MockSdk(sharedStorage)
    const harnessA = createHarness({ sdk: sdkA })
    await harnessA.start()

    const fileFactories = generateTestFiles(3, { type: 'data' })
    await addTestFilesToHarness(harnessA, fileFactories)
    await harnessA.waitForNoActiveUploads()
    await waitForAllObjectsV1(sharedStorage, 3)

    const deviceAFiles = await readAllFileRecords({ order: 'ASC' })
    expect(deviceAFiles).toHaveLength(3)

    await harnessA.shutdown()

    // Device B: sync all 3 files, then pause to inject delete
    const sdkB = new MockSdk(sharedStorage)
    const harnessB = createHarness({ sdk: sdkB })
    await harnessB.start()

    await harnessB.waitForFileCount(3)

    // Pause, simulate Device A deleting the first file's object
    harnessB.pause()

    const objectToDelete = Array.from(sharedStorage.objects.entries()).find(
      ([_, obj]) => {
        try {
          const meta = decodeFileMetadata(obj.metadata)
          return meta.id === deviceAFiles[0].id
        } catch {
          return false
        }
      },
    )
    expect(objectToDelete).toBeDefined()
    const deleteSdk = new MockSdk(sharedStorage)
    await deleteSdk.deleteObject(objectToDelete![0])

    // Resume — syncDown processes the delete event
    harnessB.resume()

    await waitForCondition(
      async () => {
        const file = await readFileRecord(deviceAFiles[0].id)
        return file?.deletedAt != null
      },
      { timeout: 15_000, message: 'Device B to tombstone deleted file' },
    )

    // The deleted file should be tombstoned, not removed
    const deletedFile = await readFileRecord(deviceAFiles[0].id)
    expect(deletedFile).not.toBeNull()
    expect(deletedFile!.deletedAt).not.toBeNull()

    // The other two files should still be active
    for (const file of deviceAFiles.slice(1)) {
      const remaining = await readFileRecord(file.id)
      expect(remaining).not.toBeNull()
      expect(remaining!.deletedAt).toBeNull()
    }

    await harnessB.shutdown()
  }, 60_000)

  it('rename propagation: file renamed on Device A is updated on Device B', async () => {
    const sharedStorage = createEmptyStorage()

    // Device A: upload 1 data file
    const sdkA = new MockSdk(sharedStorage)
    const harnessA = createHarness({ sdk: sdkA })
    await harnessA.start()

    const fileFactories = generateTestFiles(1, { type: 'data' })
    await addTestFilesToHarness(harnessA, fileFactories)
    await harnessA.waitForNoActiveUploads()
    await waitForAllObjectsV1(sharedStorage, 1)

    const deviceAFiles = await readAllFileRecords({ order: 'ASC' })
    expect(deviceAFiles).toHaveLength(1)
    const originalName = deviceAFiles[0].name

    await harnessA.shutdown()

    // Device B: sync the file, then pause to inject rename
    const sdkB = new MockSdk(sharedStorage)
    const harnessB = createHarness({ sdk: sdkB })
    await harnessB.start()

    await harnessB.waitForFileCount(1)
    const deviceBFile = (await readAllFileRecords({ order: 'ASC' }))[0]
    expect(deviceBFile.name).toBe(originalName)

    // Pause, simulate Device A renaming the file
    harnessB.pause()
    const objectId = Array.from(sharedStorage.objects.keys())[0]
    sdkB.injectMetadataChange(objectId, {
      name: 'renamed-file.bin',
      updatedAt: Date.now() + 5000,
    })

    // Resume — syncDown processes the rename event
    harnessB.resume()

    await waitForCondition(
      async () => {
        const files = await readAllFileRecords({ order: 'ASC' })
        return files.length === 1 && files[0].name === 'renamed-file.bin'
      },
      { timeout: 15_000, message: 'Device B to sync rename' },
    )

    const renamedFile = (await readAllFileRecords({ order: 'ASC' }))[0]
    expect(renamedFile.name).toBe('renamed-file.bin')
    expect(renamedFile.id).toBe(deviceAFiles[0].id)

    await harnessB.shutdown()
  }, 60_000)

  it('trash and tombstone converge across two devices', async () => {
    const sharedStorage = createEmptyStorage()

    // Device A: upload 2 data files
    const sdkA = new MockSdk(sharedStorage)
    const harnessA = createHarness({ sdk: sdkA })
    await harnessA.start()

    const fileFactories = generateTestFiles(2, { type: 'data' })
    const testFiles = await addTestFilesToHarness(harnessA, fileFactories)
    await harnessA.waitForNoActiveUploads()
    await waitForAllObjectsV1(sharedStorage, 2)

    const fileIdA = testFiles[0].id
    const fileIdB = testFiles[1].id

    await harnessA.shutdown()

    // Device B: sync both files
    const sdkB = new MockSdk(sharedStorage)
    const harnessB = createHarness({ sdk: sdkB })
    await harnessB.start()

    await harnessB.waitForFileCount(2)

    // Both files are active
    let file1 = await readFileRecord(fileIdA)
    let file2 = await readFileRecord(fileIdB)
    expect(file1!.trashedAt).toBeNull()
    expect(file1!.deletedAt).toBeNull()
    expect(file2!.trashedAt).toBeNull()
    expect(file2!.deletedAt).toBeNull()

    // Simulate Device A trashing file 1 (metadata update with trashedAt)
    harnessB.pause()
    const objectEntries = Array.from(sharedStorage.objects.entries())
    const obj1Entry = objectEntries.find(([_, obj]) => {
      try {
        const meta = decodeFileMetadata(obj.metadata)
        return meta.id === fileIdA
      } catch {
        return false
      }
    })!
    const obj2Entry = objectEntries.find(([_, obj]) => {
      try {
        const meta = decodeFileMetadata(obj.metadata)
        return meta.id === fileIdB
      } catch {
        return false
      }
    })!

    const trashTime = Date.now() + 5000
    sdkB.injectMetadataChange(obj1Entry[0], {
      trashedAt: trashTime,
      updatedAt: trashTime,
    })
    harnessB.resume()

    // Device B sees the trash via syncDown
    await waitForCondition(
      async () => {
        const file = await readFileRecord(fileIdA)
        return file?.trashedAt != null
      },
      { timeout: 15_000, message: 'Device B to see trashedAt on file 1' },
    )

    file1 = await readFileRecord(fileIdA)
    expect(file1!.trashedAt).not.toBeNull()
    expect(file1!.deletedAt).toBeNull()

    // Device B trashes file 2 locally
    await trashFiles([fileIdB])
    file2 = await readFileRecord(fileIdB)
    expect(file2!.trashedAt).not.toBeNull()
    expect(file2!.deletedAt).toBeNull()

    // Wait for Device B's syncUp to push trashedAt for file 2
    await waitForCondition(
      () => {
        try {
          const meta = decodeFileMetadata(
            sharedStorage.objects.get(obj2Entry[0])!.metadata,
          )
          return meta.trashedAt != null
        } catch {
          return false
        }
      },
      {
        timeout: 15_000,
        message: 'Device B syncUp to push trashedAt for file 2',
      },
    )

    // Simulate Device A permanently deleting file 1 (object deleted from indexer)
    harnessB.pause()
    const deleteSdk = new MockSdk(sharedStorage)
    await deleteSdk.deleteObject(obj1Entry[0])
    harnessB.resume()

    // Device B processes the delete event → tombstone
    await waitForCondition(
      async () => {
        const file = await readFileRecord(fileIdA)
        return file?.deletedAt != null
      },
      { timeout: 15_000, message: 'Device B to tombstone file 1' },
    )

    file1 = await readFileRecord(fileIdA)
    expect(file1!.deletedAt).not.toBeNull()

    // Local object row cleaned up
    const objects1 = await readLocalObjectsForFile(fileIdA)
    expect(objects1).toHaveLength(0)

    // File row persists as tombstone
    expect(await readFileRecord(fileIdA)).not.toBeNull()

    // Device B permanently deletes file 2
    file2 = (await readFileRecord(fileIdB))!
    await permanentlyDeleteFiles([file2])

    file2 = (await readFileRecord(fileIdB))!
    expect(file2.deletedAt).not.toBeNull()

    // Wait for Device B's syncUp to call deleteObject for file 2
    await waitForCondition(() => !sharedStorage.objects.has(obj2Entry[0]), {
      timeout: 15_000,
      message: 'Device B syncUp to delete file 2 object',
    })

    // Delete event was pushed to shared storage
    const deleteEvents = sharedStorage.events.filter(
      (e) => e.id === obj2Entry[0] && e.deleted,
    )
    expect(deleteEvents.length).toBeGreaterThan(0)

    // Local object row cleaned up for file 2
    const objects2 = await readLocalObjectsForFile(fileIdB)
    expect(objects2).toHaveLength(0)

    // Both files are tombstoned
    expect((await readFileRecord(fileIdA))!.deletedAt).not.toBeNull()
    expect((await readFileRecord(fileIdB))!.deletedAt).not.toBeNull()

    await harnessB.shutdown()
  }, 60_000)
})

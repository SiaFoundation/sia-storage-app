/**
 * Tests that two devices converge to identical state through syncDown/syncUp,
 * both when both run v1, and when the indexer starts with v0 metadata.
 * Also tests that a v0 node continuing to write v0 metadata doesn't corrupt
 * v1 state, and that syncUp repairs the remote metadata.
 *
 * Architecture constraint: global singletons prevent running two harnesses
 * simultaneously. Tests simulate multi-device by running Device A → shutdown →
 * Device B sequentially, sharing a single MockSdkStorage so both see the same
 * indexer objects and events. For adopt tests, pause/resume on a single harness
 * avoids the fresh-DB problem.
 */

import './utils/setup'

import { decodeFileMetadata } from '../src/encoding/fileMetadata'
import {
  createDirectory,
  moveFileToDirectory,
  readDirectoryNameForFile,
} from '../src/stores/directories'
import { readAllFileRecords, readFileRecord } from '../src/stores/files'
import { addTagToFile, readTagsForFile } from '../src/stores/tags'
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

/**
 * Deduplicate the event stream, keeping only the latest event per objectId.
 * This simulates a device that only sees the final state of each object,
 * avoiding duplicate file records from processing both v0 and v1 events.
 */
function deduplicateEvents(storage: MockSdkStorage): void {
  const latestByObjectId = new Map<string, (typeof storage.events)[number]>()
  for (const event of storage.events) {
    latestByObjectId.set(event.id, event)
  }
  storage.events = Array.from(latestByObjectId.values())
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

  it('v0 → v1 upgrade: Device A upgrades v0 objects, Device B syncs v1', async () => {
    const sharedStorage = createEmptyStorage()
    const sdk = new MockSdk(sharedStorage)
    const now = Date.now()

    // Inject 2 v0 file objects into shared storage
    sdk.injectV0Object({
      name: 'photo-1.jpg',
      type: 'image/jpeg',
      size: 2048,
      hash: 'hash-v0-1',
      createdAt: now - 2000,
      updatedAt: now - 2000,
    })
    sdk.injectV0Object({
      name: 'photo-2.jpg',
      type: 'image/jpeg',
      size: 4096,
      hash: 'hash-v0-2',
      createdAt: now - 1000,
      updatedAt: now - 1000,
    })

    // Device A: sync down v0 objects, syncUp pushes v1 metadata
    const sdkA = new MockSdk(sharedStorage)
    const harnessA = createHarness({ sdk: sdkA })
    await harnessA.start()

    await harnessA.waitForFileCount(2)

    // Wait for syncUp to push v1 metadata for both objects
    await waitForAllObjectsV1(sharedStorage, 2)

    const deviceAFiles = await readAllFileRecords({ order: 'ASC' })
    const deviceAFilesSorted = [...deviceAFiles].sort((a, b) =>
      a.hash.localeCompare(b.hash),
    )
    expect(deviceAFilesSorted).toHaveLength(2)

    await harnessA.shutdown()

    // Deduplicate events so Device B only sees v1 metadata
    deduplicateEvents(sharedStorage)

    // Device B: sync down v1 metadata from shared storage
    const sdkB = new MockSdk(sharedStorage)
    const harnessB = createHarness({ sdk: sdkB })
    await harnessB.start()

    await harnessB.waitForFileCount(2)

    const deviceBFiles = await readAllFileRecords({ order: 'ASC' })
    const deviceBFilesSorted = [...deviceBFiles].sort((a, b) =>
      a.hash.localeCompare(b.hash),
    )
    expect(deviceBFilesSorted).toHaveLength(2)

    // Both devices should have the same IDs, names, and hashes
    for (let i = 0; i < deviceAFilesSorted.length; i++) {
      expect(deviceBFilesSorted[i].id).toBe(deviceAFilesSorted[i].id)
      expect(deviceBFilesSorted[i].name).toBe(deviceAFilesSorted[i].name)
      expect(deviceBFilesSorted[i].hash).toBe(deviceAFilesSorted[i].hash)
      expect(deviceBFilesSorted[i].size).toBe(deviceAFilesSorted[i].size)
      expect(deviceBFilesSorted[i].kind).toBe(deviceAFilesSorted[i].kind)
    }

    await harnessB.shutdown()
  }, 60_000)

  it('v0 file objects are upgraded to v1 in shared storage', async () => {
    const sharedStorage = createEmptyStorage()
    const sdk = new MockSdk(sharedStorage)
    const now = Date.now()

    const fileHash = 'hash-parent-file'

    // Inject 1 v0 file + 1 v0 thumbnail into shared storage
    const fileObj = sdk.injectV0Object({
      name: 'photo.jpg',
      type: 'image/jpeg',
      size: 8192,
      hash: fileHash,
      createdAt: now,
      updatedAt: now,
    })
    sdk.injectV0Object({
      name: 'photo_thumb.webp',
      type: 'image/webp',
      size: 512,
      hash: 'hash-thumb',
      createdAt: now,
      updatedAt: now,
      thumbForHash: fileHash,
      thumbSize: 512,
    })

    // Device A: sync down v0 objects, let syncUp run
    const sdkA = new MockSdk(sharedStorage)
    const harnessA = createHarness({ sdk: sdkA })
    await harnessA.start()

    await harnessA.waitForFileCount(2)

    // Wait for syncUp to push v1 metadata for the file object
    await waitForCondition(
      () => {
        try {
          const raw = JSON.parse(new TextDecoder().decode(fileObj.metadata))
          return raw.version === 1
        } catch {
          return false
        }
      },
      { timeout: 15_000, message: 'File object to have v1 metadata' },
    )

    await harnessA.shutdown()

    // Assert the file object has v1 metadata with a proper ID
    const fileMeta = decodeFileMetadata(fileObj.metadata)
    expect(fileMeta.id).toBeTruthy()
    expect(fileMeta.name).toBe('photo.jpg')
    expect(fileMeta.hash).toBe(fileHash)
    expect(fileMeta.kind).toBe('file')
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

  it('v0 → v1 adopt: adopts canonical IDs from another device', async () => {
    const sharedStorage = createEmptyStorage()
    const sdk = new MockSdk(sharedStorage)
    const now = Date.now()

    // Inject 2 v0 file objects
    const obj1 = sdk.injectV0Object({
      name: 'photo-1.jpg',
      type: 'image/jpeg',
      size: 2048,
      hash: 'hash-adopt-1',
      createdAt: now - 2000,
      updatedAt: now - 2000,
    })
    const obj2 = sdk.injectV0Object({
      name: 'photo-2.jpg',
      type: 'image/jpeg',
      size: 4096,
      hash: 'hash-adopt-2',
      createdAt: now - 1000,
      updatedAt: now - 1000,
    })

    // Device syncs v0, gets local IDs (different from canonical)
    const sdkB = new MockSdk(sharedStorage)
    const harnessB = createHarness({ sdk: sdkB })
    await harnessB.start()

    await harnessB.waitForFileCount(2)
    const localFiles = await readAllFileRecords({ order: 'ASC' })
    expect(localFiles).toHaveLength(2)
    const localIds = localFiles.map((f) => f.id)

    // Pause to inject events without interference
    harnessB.pause()

    // Simulate Device A pushing v1 metadata with canonical IDs
    const canonicalId1 = 'canonical-adopt-1'
    const canonicalId2 = 'canonical-adopt-2'
    sdkB.injectMetadataChange(obj1.id, {
      id: canonicalId1,
      kind: 'file',
      updatedAt: now + 5000,
    })
    sdkB.injectMetadataChange(obj2.id, {
      id: canonicalId2,
      kind: 'file',
      updatedAt: now + 5000,
    })

    // Resume — syncDown processes v1 events, triggers adopt
    harnessB.resume()

    await waitForCondition(
      async () => {
        const files = await readAllFileRecords({ order: 'ASC' })
        if (files.length !== 2) return false
        return files.every(
          (f) => f.id === canonicalId1 || f.id === canonicalId2,
        )
      },
      { timeout: 15_000, message: 'Device to adopt canonical IDs' },
    )

    const adoptedFiles = await readAllFileRecords({ order: 'ASC' })
    const adoptedById = new Map(adoptedFiles.map((f) => [f.id, f]))

    expect(adoptedById.get(canonicalId1)!.hash).toBe('hash-adopt-1')
    expect(adoptedById.get(canonicalId2)!.hash).toBe('hash-adopt-2')

    // Original local IDs should no longer exist
    for (const localId of localIds) {
      expect(await readFileRecord(localId)).toBeNull()
    }

    await harnessB.shutdown()
  }, 60_000)

  it('adopt: multiple objects per file with two rounds of ID migration', async () => {
    const sharedStorage = createEmptyStorage()
    const sdk = new MockSdk(sharedStorage)
    const now = Date.now()

    // Inject 2 v0 objects for a single file (same content hash, two indexer
    // copies — both resolve to the same file via hash). Also inject 1 separate
    // v0 file object.
    const objA1 = sdk.injectV0Object({
      name: 'shared-file.jpg',
      type: 'image/jpeg',
      size: 2048,
      hash: 'hash-shared',
      createdAt: now - 3000,
      updatedAt: now - 3000,
    })
    const objA2 = sdk.injectV0Object({
      name: 'shared-file.jpg',
      type: 'image/jpeg',
      size: 2048,
      hash: 'hash-shared',
      createdAt: now - 2000,
      updatedAt: now - 2000,
    })
    const objB = sdk.injectV0Object({
      name: 'other-file.jpg',
      type: 'image/jpeg',
      size: 4096,
      hash: 'hash-other',
      createdAt: now - 1000,
      updatedAt: now - 1000,
    })

    // Device syncs v0. Multiple objects for the same file may create separate
    // file records (since v0 has no id to deduplicate on). We expect 2-3 files.
    const sdkD = new MockSdk(sharedStorage)
    const harnessD = createHarness({ sdk: sdkD })
    await harnessD.start()

    await waitForCondition(
      async () => {
        const files = await readAllFileRecords({ order: 'ASC' })
        return files.length >= 2
      },
      { timeout: 10_000, message: 'Initial v0 sync' },
    )
    const initialFiles = await readAllFileRecords({ order: 'ASC' })
    const initialIds = initialFiles.map((f) => f.id)

    // Round 1: Device A pushes canonical IDs — both shared-file objects get
    // the same canonical file ID.
    harnessD.pause()

    const canonicalSharedId = 'canonical-shared'
    const canonicalOtherId = 'canonical-other'
    sdkD.injectMetadataChange(objA1.id, {
      id: canonicalSharedId,
      kind: 'file',
      updatedAt: now + 5000,
    })
    sdkD.injectMetadataChange(objA2.id, {
      id: canonicalSharedId,
      kind: 'file',
      updatedAt: now + 5000,
    })
    sdkD.injectMetadataChange(objB.id, {
      id: canonicalOtherId,
      kind: 'file',
      updatedAt: now + 5000,
    })

    harnessD.resume()

    await waitForCondition(
      async () => {
        const files = await readAllFileRecords({ order: 'ASC' })
        if (files.length !== 2) return false
        return (
          files.some((f) => f.id === canonicalSharedId) &&
          files.some((f) => f.id === canonicalOtherId)
        )
      },
      { timeout: 15_000, message: 'Round 1 adopt' },
    )

    let files = await readAllFileRecords({ order: 'ASC' })
    expect(files).toHaveLength(2)
    expect(files.find((f) => f.id === canonicalSharedId)!.hash).toBe(
      'hash-shared',
    )

    // Original local IDs should be gone
    for (const id of initialIds) {
      if (id !== canonicalSharedId && id !== canonicalOtherId) {
        expect(await readFileRecord(id)).toBeNull()
      }
    }

    // Round 2: Another device re-assigns IDs again (e.g. a third device
    // that didn't see round 1). Both shared-file objects adopt a new ID.
    harnessD.pause()

    const canonicalSharedId2 = 'canonical-shared-v2'
    const canonicalOtherId2 = 'canonical-other-v2'
    sdkD.injectMetadataChange(objA1.id, {
      id: canonicalSharedId2,
      kind: 'file',
      updatedAt: now + 10000,
    })
    sdkD.injectMetadataChange(objA2.id, {
      id: canonicalSharedId2,
      kind: 'file',
      updatedAt: now + 10000,
    })
    sdkD.injectMetadataChange(objB.id, {
      id: canonicalOtherId2,
      kind: 'file',
      updatedAt: now + 10000,
    })

    harnessD.resume()

    await waitForCondition(
      async () => {
        const f = await readAllFileRecords({ order: 'ASC' })
        if (f.length !== 2) return false
        return (
          f.some((x) => x.id === canonicalSharedId2) &&
          f.some((x) => x.id === canonicalOtherId2)
        )
      },
      { timeout: 15_000, message: 'Round 2 adopt' },
    )

    files = await readAllFileRecords({ order: 'ASC' })
    expect(files).toHaveLength(2)
    expect(files.find((f) => f.id === canonicalSharedId2)!.hash).toBe(
      'hash-shared',
    )
    expect(files.find((f) => f.id === canonicalOtherId2)!.hash).toBe(
      'hash-other',
    )

    // Round 1 IDs should be gone
    expect(await readFileRecord(canonicalSharedId)).toBeNull()
    expect(await readFileRecord(canonicalOtherId)).toBeNull()

    await harnessD.shutdown()
  }, 60_000)

  it('v0 node overwrites v1 file metadata: local state preserved, syncUp repairs', async () => {
    const sharedStorage = createEmptyStorage()

    // Device A: upload 2 data files, push v1 metadata
    const sdkA = new MockSdk(sharedStorage)
    const harnessA = createHarness({ sdk: sdkA })
    await harnessA.start()

    const fileFactories = generateTestFiles(2, { type: 'data' })
    await addTestFilesToHarness(harnessA, fileFactories)
    await harnessA.waitForNoActiveUploads()
    await waitForAllObjectsV1(sharedStorage, 2)

    const deviceAFiles = await readAllFileRecords({ order: 'ASC' })
    expect(deviceAFiles).toHaveLength(2)

    // Capture v1 state for comparison
    const v1FileIds = deviceAFiles.map((f) => f.id)
    const v1Kinds = deviceAFiles.map((f) => f.kind)

    // Pause to simulate v0 node overwriting
    harnessA.pause()

    // Simulate a v0 node overwriting both objects back to v0
    for (const objectId of sharedStorage.objects.keys()) {
      sdkA.simulateV0Overwrite(objectId)
    }

    // Verify shared storage now has v0 metadata
    for (const obj of sharedStorage.objects.values()) {
      const raw = JSON.parse(new TextDecoder().decode(obj.metadata))
      expect(raw.version).toBeUndefined()
      expect(raw.id).toBeUndefined()
      expect(raw.kind).toBeUndefined()
    }

    // Resume — syncDown processes the v0 overwrite events
    harnessA.resume()

    // Wait for syncDown to process and syncUp to push v1 again
    await waitForAllObjectsV1(sharedStorage, 2)

    // Verify local file records still have v1 IDs and kinds
    const localFiles = await readAllFileRecords({ order: 'ASC' })
    expect(localFiles).toHaveLength(2)
    for (let i = 0; i < localFiles.length; i++) {
      expect(localFiles[i].id).toBe(v1FileIds[i])
      expect(localFiles[i].kind).toBe(v1Kinds[i])
    }

    // Verify shared storage is v1 again (syncUp repaired it)
    for (const obj of sharedStorage.objects.values()) {
      const raw = JSON.parse(new TextDecoder().decode(obj.metadata))
      expect(raw.version).toBe(1)
      expect(raw.id).toBeTruthy()
      expect(raw.kind).toBe('file')
    }

    await harnessA.shutdown()
  }, 60_000)

  it('v0 node overwrites v1 thumbnail metadata: thumbForId preserved', async () => {
    const sharedStorage = createEmptyStorage()

    // Device A: upload 1 file, inject a v1 thumbnail for it
    const sdkA = new MockSdk(sharedStorage)
    const harnessA = createHarness({ sdk: sdkA })
    await harnessA.start()

    const fileFactories = generateTestFiles(1, { type: 'data' })
    await addTestFilesToHarness(harnessA, fileFactories)
    await harnessA.waitForNoActiveUploads()
    await waitForAllObjectsV1(sharedStorage, 1)

    const deviceAFiles = await readAllFileRecords({ order: 'ASC' })
    const parentFileId = deviceAFiles[0].id

    sdkA.injectObject({
      metadata: {
        id: `thumb-v0-test-${parentFileId}`,
        name: 'thumb.webp',
        type: 'image/webp',
        kind: 'thumb',
        size: 256,
        hash: 'thumb-hash-v0test',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        thumbForId: parentFileId,
        thumbSize: 64,
      },
    })

    await harnessA.waitForFileCount(2)

    const allFiles = await readAllFileRecords({ order: 'ASC' })
    const thumb = allFiles.find((f) => f.kind === 'thumb')!
    expect(thumb.thumbForId).toBe(parentFileId)

    // Pause and simulate v0 node overwriting the thumbnail to v0
    harnessA.pause()

    // Find the thumbnail object ID in shared storage
    let thumbObjectId: string | undefined
    for (const [id, obj] of sharedStorage.objects.entries()) {
      try {
        const raw = JSON.parse(new TextDecoder().decode(obj.metadata))
        if (raw.thumbForId || raw.thumbForHash) {
          thumbObjectId = id
          break
        }
      } catch {
        // skip
      }
    }
    expect(thumbObjectId).toBeDefined()

    sdkA.simulateV0Overwrite(thumbObjectId!)

    // Verify shared storage thumbnail is now v0 (thumbForId stripped)
    const thumbObj = sharedStorage.objects.get(thumbObjectId!)!
    const v0Raw = JSON.parse(new TextDecoder().decode(thumbObj.metadata))
    expect(v0Raw.thumbForId).toBeUndefined()
    expect(v0Raw.version).toBeUndefined()

    harnessA.resume()

    // Wait a bit for syncDown to process the v0 overwrite
    await new Promise((resolve) => setTimeout(resolve, 3000))

    // thumbForId should still be set locally (v0 downgrade blocked)
    const localThumb = (await readAllFileRecords({ order: 'ASC' })).find(
      (f) => f.kind === 'thumb',
    )!
    expect(localThumb.thumbForId).toBe(parentFileId)

    await harnessA.shutdown()
  }, 60_000)

  it('v0 node renames a file: name accepted, v1 fields preserved, syncUp repairs remote', async () => {
    const sharedStorage = createEmptyStorage()

    // Device A (v1): upload 1 file, push v1 metadata
    const sdkA = new MockSdk(sharedStorage)
    const harnessA = createHarness({ sdk: sdkA })
    await harnessA.start()

    const fileFactories = generateTestFiles(1, { type: 'data' })
    await addTestFilesToHarness(harnessA, fileFactories)
    await harnessA.waitForNoActiveUploads()
    await waitForAllObjectsV1(sharedStorage, 1)

    const deviceAFiles = await readAllFileRecords({ order: 'ASC' })
    const fileId = deviceAFiles[0].id
    const objectId = Array.from(sharedStorage.objects.keys())[0]

    // Simulate v0 node renaming the file (writes back v0 metadata, stripping
    // v1 fields like version/id/kind but including the name change).
    harnessA.pause()
    sdkA.simulateV0Change(objectId, {
      name: 'v0-renamed.bin',
      updatedAt: Date.now() + 5000,
    })
    harnessA.resume()

    // The v0 rename is accepted: name changes propagate, but v1-only fields
    // (kind, thumbForId) are preserved from the existing record.
    await waitForCondition(
      async () => {
        const files = await readAllFileRecords({ order: 'ASC' })
        return files.length === 1 && files[0].name === 'v0-renamed.bin'
      },
      { timeout: 15_000, message: 'v0 rename to be accepted' },
    )

    const localFile = (await readAllFileRecords({ order: 'ASC' }))[0]
    expect(localFile.name).toBe('v0-renamed.bin')
    expect(localFile.id).toBe(fileId)
    expect(localFile.kind).toBe('file')

    // syncUp repairs the remote metadata back to v1 (with the v0 name change)
    await waitForCondition(
      () => {
        const raw = JSON.parse(
          new TextDecoder().decode(
            sharedStorage.objects.get(objectId)!.metadata,
          ),
        )
        return raw.version === 1 && raw.name === 'v0-renamed.bin'
      },
      { timeout: 15_000, message: 'syncUp to repair remote with v0 rename' },
    )

    // Verify remote has both the v0 rename AND v1 fields restored
    const repairedMeta = JSON.parse(
      new TextDecoder().decode(sharedStorage.objects.get(objectId)!.metadata),
    )
    expect(repairedMeta.version).toBe(1)
    expect(repairedMeta.name).toBe('v0-renamed.bin')
    expect(repairedMeta.id).toBe(fileId)
    expect(repairedMeta.kind).toBe('file')

    await harnessA.shutdown()
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
        const files = await readAllFileRecords({ order: 'ASC' })
        return files.length === 2
      },
      { timeout: 15_000, message: 'Device B to sync delete' },
    )

    const remainingFiles = await readAllFileRecords({ order: 'ASC' })
    expect(remainingFiles).toHaveLength(2)

    // The deleted file should be gone
    const deletedFile = await readFileRecord(deviceAFiles[0].id)
    expect(deletedFile).toBeNull()

    // The other two files should still exist
    for (const file of deviceAFiles.slice(1)) {
      const remaining = await readFileRecord(file.id)
      expect(remaining).not.toBeNull()
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

  it('comprehensive: v0 files, thumbnails, v0 node overwrite, multi-device convergence', async () => {
    const sharedStorage = createEmptyStorage()
    const sdk = new MockSdk(sharedStorage)
    const now = Date.now()

    // Inject 3 v0 files + 1 v0 thumbnail
    const fileObj1 = sdk.injectV0Object({
      name: 'photo-a.jpg',
      type: 'image/jpeg',
      size: 1024,
      hash: 'hash-comp-a',
      createdAt: now - 4000,
      updatedAt: now - 4000,
    })
    const fileObj2 = sdk.injectV0Object({
      name: 'photo-b.jpg',
      type: 'image/jpeg',
      size: 2048,
      hash: 'hash-comp-b',
      createdAt: now - 3000,
      updatedAt: now - 3000,
    })
    sdk.injectV0Object({
      name: 'document.bin',
      type: 'application/octet-stream',
      size: 4096,
      hash: 'hash-comp-c',
      createdAt: now - 2000,
      updatedAt: now - 2000,
    })
    sdk.injectV0Object({
      name: 'photo-a-thumb.webp',
      type: 'image/webp',
      size: 256,
      hash: 'hash-comp-thumb-a',
      createdAt: now - 1000,
      updatedAt: now - 1000,
      thumbForHash: 'hash-comp-a',
      thumbSize: 64,
    })

    // Device A: sync v0, push v1 for files (thumbnails skip — no thumbForId)
    const sdkA = new MockSdk(sharedStorage)
    const harnessA = createHarness({ sdk: sdkA })
    await harnessA.start()

    await harnessA.waitForFileCount(4)

    // Wait for at least the 3 file objects to get v1 metadata
    await waitForCondition(
      () => {
        let v1Count = 0
        for (const obj of sharedStorage.objects.values()) {
          try {
            const raw = JSON.parse(new TextDecoder().decode(obj.metadata))
            if (raw.version === 1) v1Count++
          } catch {
            // skip
          }
        }
        return v1Count >= 3
      },
      { timeout: 15_000, message: 'At least 3 objects to have v1 metadata' },
    )

    const deviceAFiles = await readAllFileRecords({ order: 'ASC' })

    // Simulate v0 node overwriting the first two file objects back to v0
    harnessA.pause()
    sdkA.simulateV0Overwrite(fileObj1.id)
    sdkA.simulateV0Overwrite(fileObj2.id)
    harnessA.resume()

    // Wait for syncUp to repair them back to v1
    await waitForCondition(
      () => {
        try {
          const raw1 = JSON.parse(new TextDecoder().decode(fileObj1.metadata))
          const raw2 = JSON.parse(new TextDecoder().decode(fileObj2.metadata))
          return raw1.version === 1 && raw2.version === 1
        } catch {
          return false
        }
      },
      { timeout: 15_000, message: 'Overwritten objects repaired to v1' },
    )

    // Verify local state is intact
    const afterRepairFiles = await readAllFileRecords({ order: 'ASC' })
    expect(afterRepairFiles).toHaveLength(4)
    for (const af of deviceAFiles) {
      const found = afterRepairFiles.find((f) => f.id === af.id)
      expect(found).toBeDefined()
      expect(found!.hash).toBe(af.hash)
      expect(found!.kind).toBe(af.kind)
    }

    await harnessA.shutdown()

    // Deduplicate events so Device B only sees final state
    deduplicateEvents(sharedStorage)

    // Device B: sync from scratch, should converge with Device A
    const sdkB = new MockSdk(sharedStorage)
    const harnessB = createHarness({ sdk: sdkB })
    await harnessB.start()

    await harnessB.waitForFileCount(4)

    const deviceBFiles = await readAllFileRecords({ order: 'ASC' })
    expect(deviceBFiles).toHaveLength(4)

    // Verify convergence: same hashes and kinds across devices.
    // v0 thumbnails (no thumbForId) are skipped by syncUp, so they never
    // get canonical IDs on the remote — each device assigns its own local
    // ID. Only assert ID equality for files that were upgraded to v1.
    const aByHash = new Map(deviceAFiles.map((f) => [f.hash, f]))
    for (const bf of deviceBFiles) {
      const af = aByHash.get(bf.hash)
      expect(af).toBeDefined()
      expect(bf.kind).toBe(af!.kind)
      if (bf.kind !== 'thumb') {
        expect(bf.id).toBe(af!.id)
      }
    }

    await harnessB.shutdown()
  }, 90_000)

  it('v0 node overwrites v1: tags and directory preserved, syncUp repairs', async () => {
    const sharedStorage = createEmptyStorage()

    // Device A: upload 1 file with tags and directory
    const sdkA = new MockSdk(sharedStorage)
    const harnessA = createHarness({ sdk: sdkA })
    await harnessA.start()

    const fileFactories = generateTestFiles(1, { type: 'data' })
    const files = await addTestFilesToHarness(harnessA, fileFactories)
    await harnessA.waitForNoActiveUploads()
    await waitForAllObjectsV1(sharedStorage, 1)

    // Add tags and directory
    await addTagToFile(files[0].id, 'important')
    const dir = await createDirectory('Work')
    await moveFileToDirectory(files[0].id, dir.id)

    // Wait for syncUp to push tags + directory to remote
    const objectId = Array.from(sharedStorage.objects.keys())[0]
    await waitForCondition(
      () => {
        const meta = decodeFileMetadata(
          sharedStorage.objects.get(objectId)!.metadata,
        )
        return !!meta.tags?.includes('important') && meta.directory === 'Work'
      },
      { timeout: 15_000, message: 'Tags and directory in remote metadata' },
    )

    // Simulate v0 node overwriting (strips tags, directory, version, id, kind)
    harnessA.pause()
    sdkA.simulateV0Overwrite(objectId)

    // Verify v0 metadata has no tags or directory
    const v0Raw = JSON.parse(
      new TextDecoder().decode(sharedStorage.objects.get(objectId)!.metadata),
    )
    expect(v0Raw.tags).toBeUndefined()
    expect(v0Raw.directory).toBeUndefined()
    expect(v0Raw.version).toBeUndefined()

    harnessA.resume()

    // syncUp should repair remote metadata to v1 with tags and directory
    await waitForCondition(
      () => {
        try {
          const raw = JSON.parse(
            new TextDecoder().decode(
              sharedStorage.objects.get(objectId)!.metadata,
            ),
          )
          return (
            raw.version === 1 &&
            Array.isArray(raw.tags) &&
            raw.tags.includes('important') &&
            raw.directory === 'Work'
          )
        } catch {
          return false
        }
      },
      {
        timeout: 15_000,
        message: 'syncUp to repair remote with tags and directory',
      },
    )

    // Verify local state is intact
    const localTags = (await readTagsForFile(files[0].id)).filter(
      (t) => !t.system,
    )
    expect(localTags.map((t) => t.name)).toContain('important')

    const localDir = await readDirectoryNameForFile(files[0].id)
    expect(localDir).toBe('Work')

    await harnessA.shutdown()
  }, 60_000)
})

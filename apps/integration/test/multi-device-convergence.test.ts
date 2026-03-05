/**
 * Tests that two devices converge to identical state through syncDown/syncUp.
 * Uses sequential Device A -> Device B pattern with pause/resume on a single
 * app, sharing MockSdkStorage so both see the same indexer state.
 */

import { decodeFileMetadata } from '@siastorage/core/encoding/fileMetadata'
import {
  createEmptyStorage,
  MockSdk,
  type MockSdkStorage,
} from '@siastorage/sdk-mock'
import { createTestApp, generateTestFiles, waitForCondition } from './app'

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

function deduplicateEvents(storage: MockSdkStorage): void {
  const latestByObjectId = new Map<string, (typeof storage.events)[number]>()
  for (const event of storage.events) {
    latestByObjectId.set(event.id, event)
  }
  storage.events = Array.from(latestByObjectId.values())
}

describe('Multi-Device Convergence', () => {
  it('v1 ↔ v1: files uploaded by Device A appear on Device B simultaneously', async () => {
    const sharedStorage = createEmptyStorage()

    const appA = createTestApp(sharedStorage)
    const appB = createTestApp(sharedStorage)
    await appA.start()
    await appB.start()

    const fileFactories = generateTestFiles(3, { type: 'data' })
    await appA.addFiles(fileFactories)
    await appA.waitForNoActiveUploads()

    await waitForAllObjectsV1(sharedStorage, 3)

    const deviceAFiles = await appA.getFiles()
    expect(deviceAFiles).toHaveLength(3)

    await appB.waitForFileCount(3)

    const deviceBFiles = await appB.getFiles()
    expect(deviceBFiles).toHaveLength(3)

    for (const fileA of deviceAFiles) {
      const fileB = deviceBFiles.find((f) => f.id === fileA.id)
      expect(fileB).toBeDefined()
      expect(fileB!.name).toBe(fileA.name)
      expect(fileB!.hash).toBe(fileA.hash)
      expect(fileB!.size).toBe(fileA.size)
      expect(fileB!.kind).toBe(fileA.kind)
    }

    await appA.shutdown()
    await appB.shutdown()
  }, 60_000)

  it('v1 thumbnail with thumbForId syncs correctly to Device B', async () => {
    const sharedStorage = createEmptyStorage()

    const appA = createTestApp(sharedStorage)
    await appA.start()

    const fileFactories = generateTestFiles(1, { type: 'data' })
    await appA.addFiles(fileFactories)
    await appA.waitForNoActiveUploads()
    await waitForAllObjectsV1(sharedStorage, 1)

    const deviceAFiles = await appA.getFiles()
    const parentFileId = deviceAFiles[0].id

    appA.sdk.injectObject({
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

    await appA.waitForFileCount(2)

    const deviceAAllFiles = await appA.getFiles()
    const deviceAThumb = deviceAAllFiles.find((f) => f.kind === 'thumb')!
    expect(deviceAThumb.thumbForId).toBe(parentFileId)

    const appB = createTestApp(sharedStorage)
    await appB.start()

    await appB.waitForFileCount(2)

    const deviceBFiles = await appB.getFiles()
    const deviceBFile = deviceBFiles.find((f) => f.kind === 'file')!
    const deviceBThumb = deviceBFiles.find((f) => f.kind === 'thumb')!

    expect(deviceBFile.id).toBe(parentFileId)
    expect(deviceBThumb.thumbForId).toBe(parentFileId)

    // Thumbnail discoverable via parent file ID
    const thumbs = deviceBFiles.filter(
      (f) => f.kind === 'thumb' && f.thumbForId === parentFileId,
    )
    expect(thumbs).toHaveLength(1)
    expect(thumbs[0].id).toBe(deviceAThumb.id)

    await appA.shutdown()
    await appB.shutdown()
  }, 60_000)

  it('delete propagation: file deleted on Device A is removed on Device B', async () => {
    const sharedStorage = createEmptyStorage()

    const appA = createTestApp(sharedStorage)
    const appB = createTestApp(sharedStorage)
    await appA.start()
    await appB.start()

    const fileFactories = generateTestFiles(3, { type: 'data' })
    await appA.addFiles(fileFactories)
    await appA.waitForNoActiveUploads()
    await waitForAllObjectsV1(sharedStorage, 3)

    const deviceAFiles = await appA.getFiles()
    expect(deviceAFiles).toHaveLength(3)

    await appB.waitForFileCount(3)

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
    await appA.sdk.deleteObject(objectToDelete![0])

    await appA.waitForCondition(async () => {
      const file = await appA.getFileById(deviceAFiles[0].id)
      return file?.deletedAt != null
    })
    await appB.waitForCondition(async () => {
      const file = await appB.getFileById(deviceAFiles[0].id)
      return file?.deletedAt != null
    })

    const deletedA = await appA.getFileById(deviceAFiles[0].id)
    expect(deletedA).not.toBeNull()
    expect(deletedA!.deletedAt).not.toBeNull()

    const deletedB = await appB.getFileById(deviceAFiles[0].id)
    expect(deletedB).not.toBeNull()
    expect(deletedB!.deletedAt).not.toBeNull()

    for (const file of deviceAFiles.slice(1)) {
      const ra = await appA.getFileById(file.id)
      expect(ra).not.toBeNull()
      expect(ra!.deletedAt).toBeNull()

      const rb = await appB.getFileById(file.id)
      expect(rb).not.toBeNull()
      expect(rb!.deletedAt).toBeNull()
    }

    await appA.shutdown()
    await appB.shutdown()
  }, 60_000)

  it('rename propagation: file renamed on Device A is updated on Device B', async () => {
    const sharedStorage = createEmptyStorage()

    const appA = createTestApp(sharedStorage)
    const appB = createTestApp(sharedStorage)
    await appA.start()
    await appB.start()

    const fileFactories = generateTestFiles(1, { type: 'data' })
    await appA.addFiles(fileFactories)
    await appA.waitForNoActiveUploads()
    await waitForAllObjectsV1(sharedStorage, 1)

    const deviceAFiles = await appA.getFiles()
    expect(deviceAFiles).toHaveLength(1)
    const originalName = deviceAFiles[0].name

    await appB.waitForFileCount(1)
    const deviceBFile = (await appB.getFiles())[0]
    expect(deviceBFile.name).toBe(originalName)

    const objectId = Array.from(sharedStorage.objects.keys())[0]
    appA.sdk.injectMetadataChange(objectId, {
      name: 'renamed-file.bin',
      updatedAt: Date.now() + 5000,
    })

    await appA.waitForCondition(async () => {
      const files = await appA.getFiles()
      return files.length === 1 && files[0].name === 'renamed-file.bin'
    })

    await appB.waitForCondition(async () => {
      const files = await appB.getFiles()
      return files.length === 1 && files[0].name === 'renamed-file.bin'
    })

    const renamedA = (await appA.getFiles())[0]
    const renamedB = (await appB.getFiles())[0]
    expect(renamedA.name).toBe('renamed-file.bin')
    expect(renamedB.name).toBe('renamed-file.bin')
    expect(renamedA.id).toBe(deviceAFiles[0].id)
    expect(renamedB.id).toBe(deviceAFiles[0].id)

    await appA.shutdown()
    await appB.shutdown()
  }, 60_000)

  it('trash and tombstone converge across two devices', async () => {
    const sharedStorage = createEmptyStorage()

    const appA = createTestApp(sharedStorage)
    await appA.start()

    const fileFactories = generateTestFiles(2, { type: 'data' })
    const testFiles = await appA.addFiles(fileFactories)
    await appA.waitForNoActiveUploads()
    await waitForAllObjectsV1(sharedStorage, 2)

    const fileIdA = testFiles[0].id
    const fileIdB = testFiles[1].id

    deduplicateEvents(sharedStorage)

    const appB = createTestApp(sharedStorage)
    await appB.start()

    await appB.waitForFileCount(2)

    let file1 = await appB.getFileById(fileIdA)
    let file2 = await appB.getFileById(fileIdB)
    expect(file1!.trashedAt).toBeNull()
    expect(file1!.deletedAt).toBeNull()
    expect(file2!.trashedAt).toBeNull()
    expect(file2!.deletedAt).toBeNull()

    appB.pause()
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
    appB.sdk.injectMetadataChange(obj1Entry[0], {
      trashedAt: trashTime,
      updatedAt: trashTime,
    })
    appB.resume()

    await waitForCondition(
      async () => {
        const file = await appB.getFileById(fileIdA)
        return file?.trashedAt != null
      },
      { timeout: 15_000, message: 'Device B to see trashedAt on file 1' },
    )

    file1 = await appB.getFileById(fileIdA)
    expect(file1!.trashedAt).not.toBeNull()
    expect(file1!.deletedAt).toBeNull()

    await appB.updateFileRecord(
      { id: fileIdB, trashedAt: Date.now() },
      { includeUpdatedAt: false },
    )
    file2 = await appB.getFileById(fileIdB)
    expect(file2!.trashedAt).not.toBeNull()
    expect(file2!.deletedAt).toBeNull()

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

    appB.pause()
    const deleteSdk = new MockSdk(sharedStorage)
    await deleteSdk.deleteObject(obj1Entry[0])
    appB.resume()

    await waitForCondition(
      async () => {
        const file = await appB.getFileById(fileIdA)
        return file?.deletedAt != null
      },
      { timeout: 15_000, message: 'Device B to tombstone file 1' },
    )

    file1 = await appB.getFileById(fileIdA)
    expect(file1!.deletedAt).not.toBeNull()

    const objects1 = await appB.readLocalObjectsForFile(fileIdA)
    expect(objects1).toHaveLength(0)

    expect(await appB.getFileById(fileIdA)).not.toBeNull()

    await appB.sdk.deleteObject(obj2Entry[0])

    await waitForCondition(
      async () => {
        const file = await appB.getFileById(fileIdB)
        return file?.deletedAt != null
      },
      {
        timeout: 15_000,
        message: 'Device B to tombstone file 2',
      },
    )

    file2 = await appB.getFileById(fileIdB)
    expect(file2!.deletedAt).not.toBeNull()

    const objects2 = await appB.readLocalObjectsForFile(fileIdB)
    expect(objects2).toHaveLength(0)

    expect((await appB.getFileById(fileIdA))!.deletedAt).not.toBeNull()
    expect((await appB.getFileById(fileIdB))!.deletedAt).not.toBeNull()

    await appA.shutdown()
    await appB.shutdown()
  }, 60_000)
})

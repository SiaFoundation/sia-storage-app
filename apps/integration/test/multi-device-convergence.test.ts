/**
 * Tests that two devices converge to identical state through syncDown/syncUp.
 * Uses sequential Device A -> Device B pattern with pause/resume on a single
 * app, sharing MockIndexerStorage so both see the same indexer state.
 */

import { createEmptyIndexerStorage, type MockIndexerStorage } from '@siastorage/sdk-mock'
import { createTestApp, generateTestFiles, waitForCondition } from './app'

async function waitForAllObjectsV1(
  storage: MockIndexerStorage,
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
  it('v1 ↔ v1: files uploaded by Device A appear on Device B simultaneously', async () => {
    const indexerStorage = createEmptyIndexerStorage()

    const appA = createTestApp(indexerStorage)
    const appB = createTestApp(indexerStorage)
    await appA.start()
    await appB.start()

    const fileFactories = generateTestFiles(3, { type: 'data' })
    await appA.addFiles(fileFactories)
    await appA.waitForNoActiveUploads()

    await waitForAllObjectsV1(indexerStorage, 3)

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
    const indexerStorage = createEmptyIndexerStorage()

    const appA = createTestApp(indexerStorage)
    await appA.start()

    const fileFactories = generateTestFiles(1, { type: 'data' })
    await appA.addFiles(fileFactories)
    await appA.waitForNoActiveUploads()
    await waitForAllObjectsV1(indexerStorage, 1)

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

    const appB = createTestApp(indexerStorage)
    await appB.start()

    await appB.waitForFileCount(2)

    const deviceBFiles = await appB.getFiles()
    const deviceBFile = deviceBFiles.find((f) => f.kind === 'file')!
    const deviceBThumb = deviceBFiles.find((f) => f.kind === 'thumb')!

    expect(deviceBFile.id).toBe(parentFileId)
    expect(deviceBThumb.thumbForId).toBe(parentFileId)

    // Thumbnail discoverable via parent file ID
    const thumbs = deviceBFiles.filter((f) => f.kind === 'thumb' && f.thumbForId === parentFileId)
    expect(thumbs).toHaveLength(1)
    expect(thumbs[0].id).toBe(deviceAThumb.id)

    await appA.shutdown()
    await appB.shutdown()
  }, 60_000)

  it('delete propagation: file deleted on Device A is removed on Device B', async () => {
    const indexerStorage = createEmptyIndexerStorage()

    const appA = createTestApp(indexerStorage)
    const appB = createTestApp(indexerStorage)
    await appA.start()
    await appB.start()

    const fileFactories = generateTestFiles(3, { type: 'data' })
    await appA.addFiles(fileFactories)
    await appA.waitForNoActiveUploads()
    await waitForAllObjectsV1(indexerStorage, 3)

    const deviceAFiles = await appA.getFiles()
    expect(deviceAFiles).toHaveLength(3)

    await appB.waitForFileCount(3)

    await appA.app.files.trashFile(deviceAFiles[0].id)
    const trashedFiles = (await appA.getFiles())
      .filter((f) => f.trashedAt != null)
      .map((f) => ({ id: f.id, type: f.type, localId: f.localId }))
    await appA.app.files.tombstoneWithThumbnailsAndCleanup(trashedFiles)

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
    const indexerStorage = createEmptyIndexerStorage()

    const appA = createTestApp(indexerStorage)
    const appB = createTestApp(indexerStorage)
    await appA.start()
    await appB.start()

    const fileFactories = generateTestFiles(1, { type: 'data' })
    await appA.addFiles(fileFactories)
    await appA.waitForNoActiveUploads()
    await waitForAllObjectsV1(indexerStorage, 1)

    const deviceAFiles = await appA.getFiles()
    expect(deviceAFiles).toHaveLength(1)
    const originalName = deviceAFiles[0].name

    await appB.waitForFileCount(1)
    const deviceBFile = (await appB.getFiles())[0]
    expect(deviceBFile.name).toBe(originalName)

    await appA.app.files.renameFile(deviceAFiles[0].id, 'renamed-file.bin')

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
    const indexerStorage = createEmptyIndexerStorage()

    const appA = createTestApp(indexerStorage)
    await appA.start()

    const fileFactories = generateTestFiles(2, { type: 'data' })
    const testFiles = await appA.addFiles(fileFactories)
    await appA.waitForNoActiveUploads()
    await waitForAllObjectsV1(indexerStorage, 2)

    const fileIdA = testFiles[0].id
    const fileIdB = testFiles[1].id

    const appB = createTestApp(indexerStorage)
    await appB.start()

    await appB.waitForFileCount(2)

    let file1 = await appB.getFileById(fileIdA)
    let file2 = await appB.getFileById(fileIdB)
    expect(file1!.trashedAt).toBeNull()
    expect(file1!.deletedAt).toBeNull()
    expect(file2!.trashedAt).toBeNull()
    expect(file2!.deletedAt).toBeNull()

    // Device A trashes file 1 via app facade
    await appA.app.files.trashFile(fileIdA)

    // Device B should see the trash propagate via sync
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

    // Device B trashes file 2 via app facade
    await appB.app.files.trashFile(fileIdB)
    file2 = await appB.getFileById(fileIdB)
    expect(file2!.trashedAt).not.toBeNull()
    expect(file2!.deletedAt).toBeNull()

    // Device A permanently deletes file 1 (trash then delete)
    const trashedA = (await appA.getFiles())
      .filter((f) => f.id === fileIdA)
      .map((f) => ({ id: f.id, type: f.type, localId: f.localId }))
    await appA.app.files.tombstoneWithThumbnailsAndCleanup(trashedA)

    await waitForCondition(
      async () => {
        const file = await appB.getFileById(fileIdA)
        return file?.deletedAt != null
      },
      { timeout: 15_000, message: 'Device B to tombstone file 1' },
    )

    file1 = await appB.getFileById(fileIdA)
    expect(file1!.deletedAt).not.toBeNull()
    expect(await appB.getFileById(fileIdA)).not.toBeNull()

    // Device B permanently deletes file 2
    const trashedB = (await appB.getFiles())
      .filter((f) => f.id === fileIdB)
      .map((f) => ({ id: f.id, type: f.type, localId: f.localId }))
    await appB.app.files.tombstoneWithThumbnailsAndCleanup(trashedB)

    await waitForCondition(
      async () => {
        const file = await appB.getFileById(fileIdB)
        return file?.deletedAt != null
      },
      { timeout: 15_000, message: 'Device B to tombstone file 2' },
    )

    file2 = await appB.getFileById(fileIdB)
    expect(file2!.deletedAt).not.toBeNull()

    expect((await appB.getFileById(fileIdA))!.deletedAt).not.toBeNull()
    expect((await appB.getFileById(fileIdB))!.deletedAt).not.toBeNull()

    await appA.shutdown()
    await appB.shutdown()
  }, 60_000)
})

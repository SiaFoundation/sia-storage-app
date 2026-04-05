/**
 * Tests that file versioning works correctly across multi-device sync.
 * Devices share MockIndexerStorage so they see the same indexer state.
 */

import { extFromMime } from '@siastorage/core/lib/fileTypes'
import {
  createEmptyIndexerStorage,
  generateMockFileMetadata,
} from '@siastorage/sdk-mock'
import * as crypto from 'crypto'
import * as nodeFs from 'fs'
import * as path from 'path'
import { createTestApp, type TestApp, waitForCondition } from './app'

async function addVersionFile(
  app: TestApp,
  id: string,
  name: string,
): Promise<void> {
  const type = 'application/octet-stream'
  const ext = extFromMime(type)
  const content = crypto.randomBytes(1024)
  const hash = crypto.createHash('sha256').update(content).digest('hex')
  const filePath = path.join(app.tempDir, `${id}${ext}`)
  nodeFs.writeFileSync(filePath, content)
  const now = Date.now()
  await app.app.files.create({
    id,
    name,
    type,
    kind: 'file',
    size: content.length,
    hash,
    createdAt: now,
    updatedAt: now,
    localId: null,
    addedAt: now,
    trashedAt: null,
    deletedAt: null,
  })
  await app.app.fs.upsertMeta({
    fileId: id,
    size: content.length,
    addedAt: now,
    usedAt: now,
  })
}

describe('Version Sync', () => {
  it('Device A creates v1, Device B creates v2 same name → after sync, v2 is current on both', async () => {
    const indexerStorage = createEmptyIndexerStorage()
    const appA = createTestApp(indexerStorage)
    const appB = createTestApp(indexerStorage)
    await appA.start()
    await appB.start()

    const now = Date.now()

    // Device A creates foo.txt v1
    appA.sdk.injectObject({
      metadata: generateMockFileMetadata(1, {
        id: 'file-v1',
        name: 'foo.txt',
        type: 'text/plain',
        createdAt: now,
        updatedAt: now,
      }),
    })

    // Both devices should see v1
    await appA.waitForFileCount(1)
    await appB.waitForFileCount(1)

    // Device B creates foo.txt v2 (same name, higher updatedAt)
    appB.sdk.injectObject({
      metadata: generateMockFileMetadata(2, {
        id: 'file-v2',
        name: 'foo.txt',
        type: 'text/plain',
        createdAt: now + 1000,
        updatedAt: now + 1000,
      }),
    })

    // Both devices should now see 2 file records total
    await waitForCondition(async () => (await appA.getFiles()).length === 2, {
      timeout: 10_000,
      message: 'Device A sees 2 files',
    })
    await waitForCondition(async () => (await appB.getFiles()).length === 2, {
      timeout: 10_000,
      message: 'Device B sees 2 files',
    })

    // Version history should show both files
    // (getFiles returns ALL records without version filter)

    // Version history should show both, v2 first
    const historyA = await appA.app.files.getVersionHistory('foo.txt', null)
    expect(historyA).toHaveLength(2)
    expect(historyA[0].id).toBe('file-v2')

    const historyB = await appB.app.files.getVersionHistory('foo.txt', null)
    expect(historyB).toHaveLength(2)
    expect(historyB[0].id).toBe('file-v2')

    await appA.shutdown()
    await appB.shutdown()
  }, 30_000)

  it('Device A tags v2, Device B creates v3 → tag preserved but not shown', async () => {
    const indexerStorage = createEmptyIndexerStorage()
    const appA = createTestApp(indexerStorage)
    const appB = createTestApp(indexerStorage)
    await appA.start()
    await appB.start()

    const now = Date.now()

    // Both devices see v1 and v2
    appA.sdk.injectObject({
      metadata: generateMockFileMetadata(1, {
        id: 'tag-v1',
        name: 'doc.txt',
        type: 'text/plain',
        createdAt: now,
        updatedAt: now,
      }),
    })
    appA.sdk.injectObject({
      metadata: generateMockFileMetadata(2, {
        id: 'tag-v2',
        name: 'doc.txt',
        type: 'text/plain',
        createdAt: now + 1000,
        updatedAt: now + 1000,
      }),
    })

    await appA.waitForFileCount(2)
    await appB.waitForFileCount(2)

    // Device A tags the current version (v2)
    await appA.addTagToFile('tag-v2', 'important')
    const tagsOnV2 = await appA.readTagsForFile('tag-v2')
    expect(tagsOnV2).toHaveLength(1)

    // Device B creates v3 (no tags)
    const v3UpdatedAt = Date.now() + 5000
    appB.sdk.injectObject({
      metadata: generateMockFileMetadata(3, {
        id: 'tag-v3',
        name: 'doc.txt',
        type: 'text/plain',
        createdAt: v3UpdatedAt,
        updatedAt: v3UpdatedAt,
      }),
    })

    // Wait for v3 to sync to both
    await waitForCondition(async () => (await appA.getFiles()).length === 3, {
      timeout: 10_000,
      message: 'Device A sees 3 files',
    })

    // Tag on v2 is preserved in DB
    const tagsStillOnV2 = await appA.readTagsForFile('tag-v2')
    expect(tagsStillOnV2).toHaveLength(1)

    // v3 has no tags
    const tagsOnV3 = await appA.readTagsForFile('tag-v3')
    expect(tagsOnV3).toHaveLength(0)

    await appA.shutdown()
    await appB.shutdown()
  }, 30_000)

  it('Device A renames all versions with staggered timestamps preserving order', async () => {
    const indexerStorage = createEmptyIndexerStorage()
    const appA = createTestApp(indexerStorage)
    await appA.start()

    const now = Date.now()

    // Create v1 and v2 of 'old.txt'
    appA.sdk.injectObject({
      metadata: generateMockFileMetadata(1, {
        id: 'rename-v1',
        name: 'old.txt',
        type: 'text/plain',
        createdAt: now,
        updatedAt: now,
      }),
    })
    appA.sdk.injectObject({
      metadata: generateMockFileMetadata(2, {
        id: 'rename-v2',
        name: 'old.txt',
        type: 'text/plain',
        createdAt: now + 1000,
        updatedAt: now + 1000,
      }),
    })

    await appA.waitForFileCount(2)

    // Rename via facade (renames all versions with stagger)
    await appA.app.files.renameFile('rename-v2', 'new.txt')

    // All versions have the new name
    const history = await appA.app.files.getVersionHistory('new.txt', null)
    expect(history).toHaveLength(2)
    expect(history.every((f) => f.name === 'new.txt')).toBe(true)

    // Version ordering preserved (v2 still current)
    expect(history[0].id).toBe('rename-v2')
    expect(history[1].id).toBe('rename-v1')
    expect(history[0].updatedAt).toBeGreaterThan(history[1].updatedAt)

    // Old name has no versions
    const oldHistory = await appA.app.files.getVersionHistory('old.txt', null)
    expect(oldHistory).toHaveLength(0)

    await appA.shutdown()
  }, 30_000)

  it('file moved to folder with same-named file syncs as version, not duplicate', async () => {
    const indexerStorage = createEmptyIndexerStorage()
    const appB = createTestApp(indexerStorage)
    await appB.start()

    const now = Date.now()

    // Device B initially syncs file-in-x (in FolderX) and file-in-y (in FolderY)
    appB.sdk.injectObject({
      metadata: generateMockFileMetadata(1, {
        id: 'file-in-x',
        name: 'a.txt',
        type: 'text/plain',
        directory: 'FolderX',
        createdAt: now,
        updatedAt: now,
      }),
    })
    appB.sdk.injectObject({
      metadata: generateMockFileMetadata(2, {
        id: 'file-in-y',
        name: 'a.txt',
        type: 'text/plain',
        directory: 'FolderY',
        createdAt: now + 1000,
        updatedAt: now + 1000,
      }),
    })

    await appB.waitForFileCount(2)
    const countBefore = await appB.app.library.fileCount()
    expect(countBefore).toBe(2)

    // Device A moved file-in-x to FolderY — simulate this arriving as
    // an updated object with directory changed and updatedAt bumped
    appB.sdk.injectObject({
      metadata: generateMockFileMetadata(1, {
        id: 'file-in-x',
        name: 'a.txt',
        type: 'text/plain',
        directory: 'FolderY',
        createdAt: now,
        updatedAt: now + 2000,
      }),
    })

    // Wait for sync to process the update
    await waitForCondition(
      async () => {
        const count = await appB.app.library.fileCount()
        return count === 1
      },
      { timeout: 10_000, message: 'Device B sees 1 file after move sync' },
    )

    // Both files are now in FolderY — they're versions of each other
    const dirs = await appB.app.directories.getAll()
    const folderY = dirs.find((d) => d.path === 'FolderY')
    expect(folderY).toBeDefined()
    expect(folderY!.fileCount).toBe(1)

    await appB.shutdown()
  }, 30_000)

  it('same-name files in one batch → version current correct', async () => {
    const indexerStorage = createEmptyIndexerStorage()
    const app = createTestApp(indexerStorage)
    await app.start()

    const now = Date.now()

    // Inject two versions of the same file in quick succession (same batch)
    app.sdk.injectObject({
      metadata: generateMockFileMetadata(1, {
        id: 'batch-v1',
        name: 'same.txt',
        type: 'text/plain',
        createdAt: now,
        updatedAt: now,
      }),
    })
    app.sdk.injectObject({
      metadata: generateMockFileMetadata(2, {
        id: 'batch-v2',
        name: 'same.txt',
        type: 'text/plain',
        createdAt: now + 1000,
        updatedAt: now + 1000,
      }),
    })

    await waitForCondition(async () => (await app.getFiles()).length === 2, {
      timeout: 10_000,
      message: 'Both versions synced',
    })

    const count = await app.app.library.fileCount()
    expect(count).toBe(1)

    const history = await app.app.files.getVersionHistory('same.txt', null)
    expect(history).toHaveLength(2)
    expect(history[0].id).toBe('batch-v2')

    await app.shutdown()
  }, 30_000)

  it('three versions across sequential batches → current tracks latest', async () => {
    const indexerStorage = createEmptyIndexerStorage()
    const app = createTestApp(indexerStorage)
    await app.start()

    const now = Date.now()

    app.sdk.injectObject({
      metadata: generateMockFileMetadata(1, {
        id: 'seq-v1',
        name: 'evolving.txt',
        type: 'text/plain',
        createdAt: now,
        updatedAt: now,
      }),
    })
    await app.waitForFileCount(1)

    app.sdk.injectObject({
      metadata: generateMockFileMetadata(2, {
        id: 'seq-v2',
        name: 'evolving.txt',
        type: 'text/plain',
        createdAt: now + 1000,
        updatedAt: now + 1000,
      }),
    })
    await waitForCondition(async () => (await app.getFiles()).length === 2, {
      timeout: 10_000,
      message: 'v2 synced',
    })

    app.sdk.injectObject({
      metadata: generateMockFileMetadata(3, {
        id: 'seq-v3',
        name: 'evolving.txt',
        type: 'text/plain',
        createdAt: now + 2000,
        updatedAt: now + 2000,
      }),
    })
    await waitForCondition(async () => (await app.getFiles()).length === 3, {
      timeout: 10_000,
      message: 'v3 synced',
    })

    const count = await app.app.library.fileCount()
    expect(count).toBe(1)

    const history = await app.app.files.getVersionHistory('evolving.txt', null)
    expect(history).toHaveLength(3)
    expect(history[0].id).toBe('seq-v3')
    expect(history[1].id).toBe('seq-v2')
    expect(history[2].id).toBe('seq-v1')

    await app.shutdown()
  }, 30_000)

  it('multi-version lifecycle: create, trash, new version from other device, tombstone current promotes next', async () => {
    // Tests: version creation across devices, local trash, new version
    // arriving while trashed, tombstone of current promoting next version.
    const indexerStorage = createEmptyIndexerStorage()
    const appA = createTestApp(indexerStorage)
    const appB = createTestApp(indexerStorage)
    await appA.start()
    await appB.start()

    // Step 1: Device A creates v1, Device B creates v2 — upload + sync
    await addVersionFile(appA, 'lc-v1', 'doc.txt')
    await addVersionFile(appB, 'lc-v2', 'doc.txt')
    await appA.waitForNoActiveUploads()
    await appB.waitForNoActiveUploads()
    await waitForCondition(async () => (await appA.getFiles()).length === 2, {
      timeout: 15_000,
      message: 'A sees v1+v2',
    })
    await waitForCondition(async () => (await appB.getFiles()).length === 2, {
      timeout: 15_000,
      message: 'B sees v1+v2',
    })
    expect(await appA.app.library.fileCount()).toBe(1)
    expect(await appB.app.library.fileCount()).toBe(1)
    const hist1 = await appA.app.files.getVersionHistory('doc.txt', null)
    expect(hist1[0].id).toBe('lc-v2')

    // Step 2: Device B goes offline, trashes the file locally
    appB.pause()
    await appB.app.files.trashFile('lc-v1')
    expect(await appB.app.library.fileCount()).toBe(0)

    // Step 3: While B is offline, Device A creates v3 via app flow
    await addVersionFile(appA, 'lc-v3', 'doc.txt')
    await appA.waitForNoActiveUploads()
    await waitForCondition(async () => (await appA.getFiles()).length === 3, {
      timeout: 15_000,
      message: 'A sees v3',
    })

    // Step 4: B comes online — syncs v3, which is a new record unaffected by B's local trash
    appB.resume()
    await waitForCondition(
      async () => (await appB.getFileById('lc-v3')) != null,
      { timeout: 15_000, message: 'B sees v3' },
    )
    const v3 = await appB.getFileById('lc-v3')
    expect(v3!.trashedAt).toBeNull()
    expect(await appB.app.library.fileCount()).toBe(1)

    // Step 5: Device A trashes then permanently deletes v3
    await appA.app.files.trashFile('lc-v3')
    const trashedOnA = await appA.getFiles()
    const toDelete = trashedOnA
      .filter((f) => f.trashedAt != null)
      .map((f) => ({ id: f.id, type: f.type, localId: f.localId }))
    await appA.app.files.permanentlyDeleteWithCleanup(toDelete)

    // Wait for A's sync-up to delete the objects and B to see the tombstone
    await waitForCondition(
      async () => (await appB.getFileById('lc-v3'))?.deletedAt != null,
      { timeout: 15_000, message: 'B tombstones v3' },
    )
    expect(await appB.app.library.fileCount()).toBe(0)

    await appA.shutdown()
    await appB.shutdown()
  }, 60_000)

  it('concurrent edits while offline: B trashes, A creates versions via app service, B reconnects', async () => {
    // Tests: Device A creates new versions through the app service (realistic
    // user flow: import file → create record → upload → sync). Device B
    // trashes while offline. On reconnect, B's local trash doesn't affect
    // A's new versions.
    const indexerStorage = createEmptyIndexerStorage()
    const appA = createTestApp(indexerStorage)
    const appB = createTestApp(indexerStorage)
    await appA.start()
    await appB.start()

    // Device A creates v1 and v2 via app flow — both devices sync
    await addVersionFile(appA, 'conc-v1', 'shared.txt')
    await addVersionFile(appA, 'conc-v2', 'shared.txt')
    await appA.waitForNoActiveUploads()
    await waitForCondition(async () => (await appB.getFiles()).length === 2, {
      timeout: 15_000,
      message: 'Both see v1+v2',
    })

    // Device B goes offline and trashes locally
    appB.pause()
    await appB.app.files.trashFile('conc-v1')
    expect(await appB.app.library.fileCount()).toBe(0)

    // Device A creates v3 and v4 through the full app flow
    // (create record + write file data + fs metadata → upload manager → sync-up)
    await addVersionFile(appA, 'conc-v3', 'shared.txt')
    await addVersionFile(appA, 'conc-v4', 'shared.txt')
    await appA.waitForNoActiveUploads()
    await waitForCondition(async () => (await appA.getFiles()).length === 4, {
      timeout: 15_000,
      message: 'A has v1-v4',
    })

    // Device B comes back online — syncs v3+v4 from indexer
    appB.resume()
    await waitForCondition(
      async () => (await appB.getFileById('conc-v4')) != null,
      { timeout: 15_000, message: 'B sees v4' },
    )

    // v1+v2 trashed locally, v3+v4 arrived from A — alive
    const v1 = await appB.getFileById('conc-v1')
    const v2 = await appB.getFileById('conc-v2')
    const v3 = await appB.getFileById('conc-v3')
    const v4 = await appB.getFileById('conc-v4')
    expect(v1!.trashedAt).not.toBeNull()
    expect(v2!.trashedAt).not.toBeNull()
    expect(v3!.trashedAt).toBeNull()
    expect(v3!.deletedAt).toBeNull()
    expect(v4!.trashedAt).toBeNull()
    expect(v4!.deletedAt).toBeNull()

    // Library: v3+v4 are the active version group
    expect(await appB.app.library.fileCount()).toBe(1)
    const hist = await appB.app.files.getVersionHistory('shared.txt', null)
    expect(hist).toHaveLength(2)
    expect(hist[0].id).toBe('conc-v4')
    expect(hist[1].id).toBe('conc-v3')

    await appA.shutdown()
    await appB.shutdown()
  }, 60_000)

  it('three devices: A creates versions, B trashes, C adds new version — convergence', async () => {
    // Tests: three-device scenario with version creation, trash,
    // and new version — all converge to the same state.
    const indexerStorage = createEmptyIndexerStorage()
    const appA = createTestApp(indexerStorage)
    const appB = createTestApp(indexerStorage)
    const appC = createTestApp(indexerStorage)
    await appA.start()
    await appB.start()
    await appC.start()

    // Device A creates v1 and v2 via app flow — all three sync
    await addVersionFile(appA, 'tri-v1', 'notes.txt')
    await addVersionFile(appA, 'tri-v2', 'notes.txt')
    await appA.waitForNoActiveUploads()
    await waitForCondition(async () => (await appC.getFiles()).length === 2, {
      timeout: 15_000,
      message: 'All three see v1+v2',
    })
    expect(await appC.app.library.fileCount()).toBe(1)

    // Device B goes offline, trashes the file
    appB.pause()
    await appB.app.files.trashFile('tri-v1')
    expect(await appB.app.library.fileCount()).toBe(0)

    // Device C goes offline
    appC.pause()

    // Device A trashes then permanently deletes v1 and v2
    await appA.app.files.trashFile('tri-v1')
    const trashedOnA = await appA.getFiles()
    const toDelete = trashedOnA
      .filter((f) => f.trashedAt != null)
      .map((f) => ({ id: f.id, type: f.type, localId: f.localId }))
    await appA.app.files.permanentlyDeleteWithCleanup(toDelete)
    await waitForCondition(
      async () => (await appA.getFileById('tri-v1'))?.deletedAt != null,
      { timeout: 15_000, message: 'A tombstones v1+v2' },
    )

    // Device C creates v3 while offline via app flow
    await addVersionFile(appC, 'tri-v3', 'notes.txt')

    // Both B and C come back online
    appB.resume()
    appC.resume()

    // Wait for all to converge: v3 exists on all devices
    for (const device of [appA, appB, appC]) {
      await waitForCondition(
        async () => (await device.getFileById('tri-v3')) != null,
        { timeout: 15_000, message: 'Device sees v3' },
      )
    }

    // All three devices: v1+v2 tombstoned/trashed, v3 alive, library = 1
    for (const device of [appA, appB, appC]) {
      const v3 = await device.getFileById('tri-v3')
      expect(v3!.deletedAt).toBeNull()
      expect(v3!.trashedAt).toBeNull()
      expect(await device.app.library.fileCount()).toBe(1)
    }

    await appA.shutdown()
    await appB.shutdown()
    await appC.shutdown()
  }, 60_000)
})

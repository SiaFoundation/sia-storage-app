import {
  createEmptyIndexerStorage,
  generateMockFileMetadata,
  type MockIndexerStorage,
  resetObjectIdCounter,
} from '@siastorage/sdk-mock'
import { createTestApp, generateTestFiles, type TestApp, waitForCondition } from './app'

beforeEach(() => {
  resetObjectIdCounter()
})

describe('Multi-Device Sync (simultaneous instances)', () => {
  let appA: TestApp
  let appB: TestApp
  let shared: MockIndexerStorage

  beforeEach(async () => {
    shared = createEmptyIndexerStorage()
    appA = createTestApp(shared)
    appB = createTestApp(shared)
    await appA.start()
    await appB.start()
  })

  afterEach(async () => {
    await appA.shutdown()
    await appB.shutdown()
  })

  it('files injected on shared indexer sync to both devices', async () => {
    const now = Date.now()
    for (let i = 0; i < 3; i++) {
      appA.sdk.injectObject({
        metadata: {
          id: `file-${i}`,
          name: `photo-${i}.jpg`,
          type: 'image/jpeg',
          kind: 'file',
          size: 1024 * (i + 1),
          hash: `hash-${i}`,
          createdAt: now - i * 1000,
          updatedAt: now - i * 1000,
          trashedAt: null,
        },
      })
    }

    await Promise.all([appA.waitForFileCount(3), appB.waitForFileCount(3)])

    const filesA = await appA.getFiles()
    const filesB = await appB.getFiles()
    expect(filesA.map((f) => f.id).sort()).toEqual(filesB.map((f) => f.id).sort())
  })

  it("both devices see each other's injected files", async () => {
    const now = Date.now()

    appA.sdk.injectObject({
      metadata: {
        id: 'file-a',
        name: 'a.jpg',
        type: 'image/jpeg',
        kind: 'file',
        size: 1024,
        hash: 'hash-a',
        createdAt: now,
        updatedAt: now,
        trashedAt: null,
      },
    })

    appB.sdk.injectObject({
      metadata: {
        id: 'file-b',
        name: 'b.jpg',
        type: 'image/jpeg',
        kind: 'file',
        size: 2048,
        hash: 'hash-b',
        createdAt: now,
        updatedAt: now,
        trashedAt: null,
      },
    })

    await Promise.all([appA.waitForFileCount(2), appB.waitForFileCount(2)])

    const aFiles = await appA.getFiles()
    const bFiles = await appB.getFiles()
    expect(aFiles.map((f) => f.id).sort()).toEqual(['file-a', 'file-b'])
    expect(bFiles.map((f) => f.id).sort()).toEqual(['file-a', 'file-b'])
  })

  it('delete propagation: both devices converge after delete', async () => {
    const now = Date.now()

    appA.sdk.injectObject({
      metadata: {
        id: 'keep-me',
        name: 'keep.jpg',
        type: 'image/jpeg',
        kind: 'file',
        size: 1024,
        hash: 'hash-keep',
        createdAt: now,
        updatedAt: now,
        trashedAt: null,
      },
    })

    const deleted = appA.sdk.injectObject({
      metadata: {
        id: 'delete-me',
        name: 'delete.jpg',
        type: 'image/jpeg',
        kind: 'file',
        size: 2048,
        hash: 'hash-delete',
        createdAt: now,
        updatedAt: now,
        trashedAt: null,
      },
    })

    await Promise.all([appA.waitForFileCount(2), appB.waitForFileCount(2)])

    appA.sdk.injectDeleteEvent(deleted.id)

    await appA.waitForCondition(async () => {
      const file = await appA.getFileById('delete-me')
      return file?.deletedAt != null
    })
    await appB.waitForCondition(async () => {
      const file = await appB.getFileById('delete-me')
      return file?.deletedAt != null
    })

    const deletedA = await appA.getFileById('delete-me')
    expect(deletedA).not.toBeNull()
    expect(deletedA!.deletedAt).not.toBeNull()

    const deletedB = await appB.getFileById('delete-me')
    expect(deletedB).not.toBeNull()
    expect(deletedB!.deletedAt).not.toBeNull()

    const keepA = await appA.getFileById('keep-me')
    expect(keepA).not.toBeNull()
    expect(keepA!.deletedAt).toBeNull()

    const keepB = await appB.getFileById('keep-me')
    expect(keepB).not.toBeNull()
    expect(keepB!.deletedAt).toBeNull()
  })

  it('metadata update on one device syncs to both via shared indexer', async () => {
    const now = Date.now()

    const obj = appA.sdk.injectObject({
      metadata: {
        id: 'rename-me',
        name: 'original.jpg',
        type: 'image/jpeg',
        kind: 'file',
        size: 1024,
        hash: 'hash-rename',
        createdAt: now,
        updatedAt: now,
        trashedAt: null,
      },
    })

    await Promise.all([appA.waitForFileCount(1), appB.waitForFileCount(1)])

    appA.sdk.injectMetadataChange(obj.id, {
      name: 'renamed.jpg',
      updatedAt: now + 5000,
    })

    await appA.waitForCondition(async () => {
      const files = await appA.getFiles()
      return files.length === 1 && files[0].name === 'renamed.jpg'
    })

    await appB.waitForCondition(async () => {
      const files = await appB.getFiles()
      return files.length === 1 && files[0].name === 'renamed.jpg'
    })
  })

  it('tags and directories sync correctly to both devices', async () => {
    const now = Date.now()

    appA.sdk.injectObject({
      metadata: {
        id: 'tagged-file',
        name: 'tagged.jpg',
        type: 'image/jpeg',
        kind: 'file',
        size: 1024,
        hash: 'hash-tagged',
        createdAt: now,
        updatedAt: now,
        tags: ['vacation', 'summer'],
        directory: 'Photos',
        trashedAt: null,
      },
    })

    await Promise.all([appA.waitForFileCount(1), appB.waitForFileCount(1)])

    const tagsA = await appA.app.tags.getForFile('tagged-file')
    const tagsB = await appB.app.tags.getForFile('tagged-file')
    expect(tagsA.map((t) => t.name).sort()).toEqual(['summer', 'vacation'])
    expect(tagsB.map((t) => t.name).sort()).toEqual(['summer', 'vacation'])

    const dirA = await appA.app.directories.getPathForFile('tagged-file')
    const dirB = await appB.app.directories.getPathForFile('tagged-file')
    expect(dirA).toBe('Photos')
    expect(dirB).toBe('Photos')
  })

  it('three devices converge on shared state', async () => {
    const appC = createTestApp(shared)
    await appC.start()

    try {
      const now = Date.now()
      for (let i = 0; i < 5; i++) {
        appA.sdk.injectObject({
          metadata: {
            id: `file-${i}`,
            name: `file-${i}.bin`,
            type: 'application/octet-stream',
            kind: 'file',
            size: 512 * (i + 1),
            hash: `hash-${i}`,
            createdAt: now - i * 1000,
            updatedAt: now - i * 1000,
            trashedAt: null,
          },
        })
      }

      await Promise.all([
        appA.waitForFileCount(5),
        appB.waitForFileCount(5),
        appC.waitForFileCount(5),
      ])

      const filesA = await appA.getFiles()
      const filesB = await appB.getFiles()
      const filesC = await appC.getFiles()

      const idsA = filesA.map((f) => f.id).sort()
      const idsB = filesB.map((f) => f.id).sort()
      const idsC = filesC.map((f) => f.id).sort()

      expect(idsA).toEqual(idsB)
      expect(idsB).toEqual(idsC)
    } finally {
      await appC.shutdown()
    }
  })
})

describe('Multi-Device Sync (upload + sync)', () => {
  let appA: TestApp
  let appB: TestApp
  let shared: MockIndexerStorage

  beforeEach(async () => {
    shared = createEmptyIndexerStorage()
    appA = createTestApp(shared)
    appB = createTestApp(shared)
    await appA.start()
    await appB.start()
  })

  afterEach(async () => {
    await appA.shutdown()
    await appB.shutdown()
  })

  // Scenario: User uploads same photo from two devices simultaneously. Each
  // device assigns its own file ID, so both records are kept separately.
  it('keeps files from multiple devices as separate records by ID', async () => {
    const [file] = await appA.addFiles(generateTestFiles(1, { startId: 1 }))

    appB.sdk.injectObject({
      metadata: {
        ...generateMockFileMetadata(1),
        hash: file.hash,
        name: 'IMG_from_phone.bin',
      },
    })

    await waitForCondition(
      async () => {
        const allFiles = await appA.getFiles()
        const files = allFiles.filter((f) => f.kind === 'file')
        return files.length >= 2
      },
      { timeout: 10_000, message: 'Both files to exist' },
    )

    const allFiles = await appA.getFiles()
    const files = allFiles.filter((f) => f.kind === 'file')
    expect(files).toHaveLength(2)
    expect(files[0].hash).toBe(files[1].hash)
    expect(files[0].id).not.toBe(files[1].id)
  }, 30_000)

  // Scenario: User edits file on desktop, then edits on phone. Newest edit
  // wins when syncing.
  it('resolves conflicts using newest-wins strategy', async () => {
    const [file] = await appA.addFiles(generateTestFiles(1, { startId: 1 }))

    await waitForCondition(() => appA.getUploadState(file.id) !== undefined, {
      timeout: 10_000,
      message: 'File to be detected by scanner',
    })

    await appA.waitForNoActiveUploads()
    const localObjects = await appA.readLocalObjectsForFile(file.id)
    const objectId = localObjects[0].id

    const currentFile = await appA.getFileById(file.id)
    const T1 = currentFile!.updatedAt

    const T2 = T1 + 5000
    appA.sdk.injectMetadataChange(objectId, {
      name: 'phone-edit.bin',
      updatedAt: T2,
    })

    await waitForCondition(
      async () => {
        const dbFile = await appA.getFileById(file.id)
        return dbFile?.name === 'phone-edit.bin'
      },
      { timeout: 10_000, message: 'Phone edit to sync down' },
    )

    const dbFile = await appA.getFileById(file.id)
    expect(dbFile!.name).toBe('phone-edit.bin')
    expect(dbFile!.updatedAt).toBe(T2)
  }, 30_000)

  // Scenario: User deletes file on phone. Desktop should see the deletion
  // after sync.
  it('syncs file deletions from other devices', async () => {
    const [file] = await appA.addFiles(generateTestFiles(1, { startId: 1 }))

    await waitForCondition(() => appA.getUploadState(file.id) !== undefined, {
      timeout: 10_000,
      message: 'File to be detected by scanner',
    })

    await appA.waitForNoActiveUploads()
    const localObjects = await appA.readLocalObjectsForFile(file.id)
    const objectId = localObjects[0].id

    expect(await appA.getFileById(file.id)).not.toBeNull()

    appA.sdk.injectDeleteEvent(objectId)

    await waitForCondition(
      async () => {
        const dbFile = await appA.getFileById(file.id)
        return dbFile?.deletedAt != null
      },
      { timeout: 10_000, message: 'File to be tombstoned' },
    )

    const tombstoned = await appA.getFileById(file.id)
    expect(tombstoned).not.toBeNull()
    expect(tombstoned!.deletedAt).not.toBeNull()
    const objects = await appA.readLocalObjectsForFile(file.id)
    expect(objects).toHaveLength(0)
  }, 30_000)

  it('catches up on events after being offline', async () => {
    for (let i = 1; i <= 5; i++) {
      appA.sdk.injectObject({
        metadata: generateMockFileMetadata(i, { name: `new-file-${i}.jpg` }),
      })
    }

    await waitForCondition(
      async () => {
        const files = await appA.getFiles()
        return files.length === 5
      },
      { timeout: 10_000, message: 'All 5 files to sync' },
    )

    const files = await appA.getFiles()
    expect(files).toHaveLength(5)

    const names = files.map((f) => f.name).sort()
    expect(names).toEqual([
      'new-file-1.jpg',
      'new-file-2.jpg',
      'new-file-3.jpg',
      'new-file-4.jpg',
      'new-file-5.jpg',
    ])
  }, 30_000)
})

import { createEmptyIndexerStorage, generateMockFileMetadata } from '@siastorage/sdk-mock'
import { createTestApp, type TestApp, waitForCondition } from './app'

describe('Sync Down', () => {
  let app: TestApp

  beforeEach(async () => {
    app = createTestApp(createEmptyIndexerStorage())
    await app.start()
  })

  afterEach(async () => {
    await app.shutdown()
  })

  it('syncs objects injected from server', async () => {
    app.sdk.injectObject({
      metadata: generateMockFileMetadata(1, { name: 'from-server.jpg' }),
    })

    await waitForCondition(
      async () => {
        const files = await app.getFiles()
        return files.length === 1 && files[0].name === 'from-server.jpg'
      },
      { timeout: 10_000, message: 'File to sync from server' },
    )
  })

  it('syncs multiple objects from server', async () => {
    app.sdk.injectObject({
      metadata: generateMockFileMetadata(1, { name: 'file1.jpg' }),
    })
    app.sdk.injectObject({
      metadata: generateMockFileMetadata(2, { name: 'file2.jpg' }),
    })
    app.sdk.injectObject({
      metadata: generateMockFileMetadata(3, { name: 'file3.jpg' }),
    })

    await app.waitForFileCount(3)

    const files = await app.getFiles()
    const names = files.map((f) => f.name).sort()
    expect(names).toContain('file1.jpg')
    expect(names).toContain('file2.jpg')
    expect(names).toContain('file3.jpg')
  })

  it('handles metadata updates from server', async () => {
    const stored = app.sdk.injectObject({
      metadata: generateMockFileMetadata(1, { name: 'original.jpg' }),
    })

    await waitForCondition(
      async () => {
        const files = await app.getFiles()
        return files.length === 1 && files[0].name === 'original.jpg'
      },
      { timeout: 10_000, message: 'Initial file to sync' },
    )

    app.sdk.injectMetadataChange(stored.id, { name: 'renamed.jpg' })

    await waitForCondition(
      async () => {
        const files = await app.getFiles()
        return files.length === 1 && files[0].name === 'renamed.jpg'
      },
      { timeout: 10_000, message: 'Renamed file to sync' },
    )
  })

  it('renaming the current version promotes the remaining version in its old group', async () => {
    // Two versions of one name: a stack where only the newer is current.
    const base = Date.now()
    app.sdk.injectObject({
      metadata: generateMockFileMetadata(1, { name: 'versioned.jpg', updatedAt: base - 60_000 }),
    })
    const newer = app.sdk.injectObject({
      metadata: generateMockFileMetadata(2, { name: 'versioned.jpg', updatedAt: base - 30_000 }),
    })

    // Current versions only (getFiles includes old versions).
    const currentNames = async () =>
      (await app.app.files.query({ order: 'ASC' })).map((f) => f.name).sort()

    await waitForCondition(
      async () =>
        (await app.getFileById('mock-file-1')) != null &&
        (await app.getFileById('mock-file-2')) != null,
      { timeout: 10_000, message: 'Both versions to sync' },
    )
    expect(await currentNames()).toEqual(['versioned.jpg'])

    // Renaming the current version vacates the versioned.jpg group; the remaining version
    // must take current there, so both names stay visible as current files.
    app.sdk.injectMetadataChange(newer.id, { name: 'renamed.jpg' })

    await waitForCondition(
      async () => {
        const names = await currentNames()
        return names.length === 2 && names[0] === 'renamed.jpg' && names[1] === 'versioned.jpg'
      },
      { timeout: 10_000, message: 'Vacated group to regain a current version' },
    )
  })

  it('handles delete events from server', async () => {
    const stored = app.sdk.injectObject({
      metadata: generateMockFileMetadata(1, { name: 'to-delete.jpg' }),
    })

    await app.waitForFileCount(1)

    const files = await app.getFiles()
    const fileId = files[0].id

    app.sdk.injectDeleteEvent(stored.id)

    await waitForCondition(
      async () => {
        const file = await app.getFileById(fileId)
        return file?.deletedAt != null
      },
      { timeout: 10_000, message: 'File to be tombstoned' },
    )
  })

  it('syncs objects with tags from server', async () => {
    app.sdk.injectObject({
      metadata: generateMockFileMetadata(1, {
        name: 'tagged.jpg',
        tags: ['vacation', 'beach'],
      }),
    })

    let fileId: string | undefined
    await waitForCondition(
      async () => {
        const files = await app.getFiles()
        if (files.length === 1 && files[0].name === 'tagged.jpg') {
          fileId = files[0].id
          return true
        }
        return false
      },
      { timeout: 10_000, message: 'Tagged file to sync' },
    )

    const tags = (await app.readTagsForFile(fileId!)).filter((t) => !t.system)
    expect(tags.map((t) => t.name).sort()).toEqual(['beach', 'vacation'])
  })

  it('two objects for one file in one batch apply the newest metadata to the row, tags and folder', async () => {
    // Sync-up can have pushed a change to one of a file's objects and not yet
    // the other, so a device that has never seen the file fetches both. The
    // newer copy comes first here, so taking the last copy would be wrong.
    const older = generateMockFileMetadata(1, { name: 'notes.txt', tags: ['keep'] })
    older.directory = 'docs'
    const newer = {
      ...older,
      name: 'renamed.txt',
      tags: [],
      directory: '',
      updatedAt: older.updatedAt + 1000,
    }
    app.pause()
    app.sdk.injectObject({ metadata: newer })
    app.sdk.injectObject({ metadata: older })
    app.resume()

    await waitForCondition(async () => (await app.getFiles()).some((f) => f.id === older.id), {
      timeout: 10_000,
      message: 'the file to sync',
    })
    expect((await app.getFiles()).find((f) => f.id === older.id)?.name).toBe('renamed.txt')
    const tags = (await app.readTagsForFile(older.id)).filter((t) => !t.system)
    expect(tags).toEqual([])
    expect(await app.app.directories.getPathForFile(older.id)).toBeUndefined()
  })

  it('metadata without tags or a directory leaves the local folder and tags alone', async () => {
    const meta = generateMockFileMetadata(1, { name: 'photo.jpg' })
    const stored = app.sdk.injectObject({ metadata: meta })
    await waitForCondition(async () => (await app.getFileById(meta.id)) !== null, {
      timeout: 10_000,
      message: 'the file to sync',
    })

    const folder = await app.app.directories.getOrCreateAtPath('docs')
    await app.app.files.moveFile(meta.id, folder.id)
    await app.addTagToFile(meta.id, 'myTag')
    // Sync-up publishing the local change after the injection below would overwrite it.
    await waitForCondition(
      async () => {
        const object = app.sdk.getStoredObjects().find((o) => o.id === stored.id)
        const published = JSON.parse(new TextDecoder().decode(object?.metadata))
        return published.directory === 'docs' && published.tags?.includes('myTag')
      },
      { timeout: 10_000, message: 'sync-up to publish the folder and tag' },
    )

    app.sdk.injectObject({
      id: stored.id,
      metadata: { ...meta, name: 'renamed.jpg', updatedAt: Date.now() + 1000 },
      omit: ['tags', 'directory'],
    })
    await waitForCondition(async () => (await app.getFileById(meta.id))?.name === 'renamed.jpg', {
      timeout: 10_000,
      message: 'the update to sync',
    })

    const tags = (await app.readTagsForFile(meta.id)).filter((t) => !t.system)
    expect(tags.map((t) => t.name)).toEqual(['myTag'])
    expect(await app.app.directories.getPathForFile(meta.id)).toBe('docs')
  })

  it('syncs tag updates from server', async () => {
    const stored = app.sdk.injectObject({
      metadata: generateMockFileMetadata(1, {
        name: 'file.jpg',
        tags: ['original'],
      }),
    })

    let fileId: string | undefined
    await waitForCondition(
      async () => {
        const files = await app.getFiles()
        if (files.length === 1) {
          fileId = files[0].id
          const tags = (await app.readTagsForFile(files[0].id)).filter((t) => !t.system)
          return tags.length === 1 && tags[0].name === 'original'
        }
        return false
      },
      { timeout: 10_000, message: 'Initial tags to sync' },
    )

    app.sdk.injectMetadataChange(stored.id, { tags: ['updated', 'new'] })

    await waitForCondition(
      async () => {
        const tags = (await app.readTagsForFile(fileId!)).filter((t) => !t.system)
        return (
          tags.length === 2 &&
          tags
            .map((t) => t.name)
            .sort()
            .join(',') === 'new,updated'
        )
      },
      { timeout: 10_000, message: 'Updated tags to sync' },
    )
  })

  it('syncs objects with directory from server', async () => {
    app.sdk.injectObject({
      metadata: generateMockFileMetadata(1, {
        name: 'vacation-photo.jpg',
        directory: 'Vacation',
      }),
    })

    let fileId: string | undefined
    await waitForCondition(
      async () => {
        const files = await app.getFiles()
        if (files.length === 1 && files[0].name === 'vacation-photo.jpg') {
          fileId = files[0].id
          return true
        }
        return false
      },
      { timeout: 10_000, message: 'File with directory to sync' },
    )

    const dirPath = await app.readDirectoryPathForFile(fileId!)
    expect(dirPath).toBe('Vacation')

    const dirs = await app.readAllDirectoriesWithCounts()
    expect(dirs).toHaveLength(1)
    expect(dirs[0].path).toBe('Vacation')
    expect(dirs[0].fileCount).toBe(1)
  })

  it('syncs directory updates from server', async () => {
    const stored = app.sdk.injectObject({
      metadata: generateMockFileMetadata(1, {
        name: 'photo.jpg',
        directory: 'Trip',
      }),
    })

    let fileId: string | undefined
    await waitForCondition(
      async () => {
        const files = await app.getFiles()
        if (files.length === 1) {
          fileId = files[0].id
          const dir = await app.readDirectoryPathForFile(files[0].id)
          return dir === 'Trip'
        }
        return false
      },
      { timeout: 10_000, message: 'Initial directory to sync' },
    )

    app.sdk.injectMetadataChange(stored.id, { directory: 'Vacation' })

    await waitForCondition(
      async () => {
        const dir = await app.readDirectoryPathForFile(fileId!)
        return dir === 'Vacation'
      },
      { timeout: 10_000, message: 'Updated directory to sync' },
    )

    const dirs = await app.readAllDirectoriesWithCounts()
    const vacationDir = dirs.find((d) => d.path === 'Vacation')
    expect(vacationDir).toBeDefined()
    expect(vacationDir!.fileCount).toBe(1)
  })

  it('addedAt preserved across sync updates', async () => {
    const stored = app.sdk.injectObject({
      metadata: generateMockFileMetadata(1, { name: 'keep-added.jpg' }),
    })

    let fileId: string | undefined
    let originalAddedAt: number | undefined
    await waitForCondition(
      async () => {
        const files = await app.getFiles()
        if (files.length === 1) {
          fileId = files[0].id
          originalAddedAt = files[0].addedAt
          return true
        }
        return false
      },
      { timeout: 10_000, message: 'Initial file to sync' },
    )

    app.sdk.injectMetadataChange(stored.id, {
      name: 'keep-added-renamed.jpg',
    })

    await waitForCondition(
      async () => {
        const file = await app.getFileById(fileId!)
        return file?.name === 'keep-added-renamed.jpg'
      },
      { timeout: 10_000, message: 'File renamed via sync' },
    )

    const updated = await app.getFileById(fileId!)
    expect(updated!.addedAt).toBe(originalAddedAt)
  })

  it('older remote metadata still upserts local object', async () => {
    const now = Date.now()

    app.sdk.injectObject({
      metadata: generateMockFileMetadata(1, {
        id: 'obj-test-file',
        name: 'photo.jpg',
        type: 'image/jpeg',
        createdAt: now,
        updatedAt: now + 1000,
      }),
    })

    await waitForCondition(
      async () => {
        const files = await app.getFiles()
        return files.length === 1
      },
      { timeout: 10_000, message: 'Initial file synced' },
    )

    // Inject a second object with OLDER updatedAt but different object ID
    app.sdk.injectObject({
      metadata: generateMockFileMetadata(2, {
        id: 'obj-test-file',
        name: 'photo-old.jpg',
        type: 'image/jpeg',
        createdAt: now,
        updatedAt: now + 500,
      }),
    })

    await waitForCondition(
      async () => {
        const objects = await app.readLocalObjectsForFile('obj-test-file')
        return objects.length === 2
      },
      { timeout: 10_000, message: 'Second object upserted' },
    )

    // Name should NOT have changed (older metadata not merged)
    const file = await app.getFileById('obj-test-file')
    expect(file!.name).toBe('photo.jpg')

    // But both objects exist
    const objects = await app.readLocalObjectsForFile('obj-test-file')
    expect(objects).toHaveLength(2)
  })

  it('synced files sort correctly by name (natural sort)', async () => {
    app.sdk.injectObject({
      metadata: generateMockFileMetadata(1, { name: 'file10.jpg' }),
    })
    app.sdk.injectObject({
      metadata: generateMockFileMetadata(2, { name: 'file2.jpg' }),
    })
    app.sdk.injectObject({
      metadata: generateMockFileMetadata(3, { name: 'file1.jpg' }),
    })

    await app.waitForFileCount(3)

    const ids = await app.app.library.sortedFileIds(
      { sortBy: 'NAME', sortDir: 'ASC', tags: [] },
      10,
      0,
    )
    const files = await app.app.files.getByIds(ids)
    const names = ids.map((id) => files.find((f) => f.id === id)?.name)
    expect(names).toEqual(['file1.jpg', 'file2.jpg', 'file10.jpg'])
  })

  // A same-ms cluster larger than batchSize must sync completely — mirrors
  // indexd's MigrateSector cascade, which UPDATEs many object_events rows
  // with one shared transaction_timestamp().
  it('syncs same-ms cluster larger than batchSize', async () => {
    const N = 600
    for (let i = 0; i < N; i++) {
      app.sdk.injectObject({
        metadata: generateMockFileMetadata(i, { name: `cluster-${i}.jpg`, size: 1 }),
      })
    }

    const sharedUpdatedAt = new Date()
    const storage = app.sdk.getStorage()
    for (const event of storage.events) {
      event.updatedAt = sharedUpdatedAt
    }
    for (const obj of storage.objects.values()) {
      obj.updatedAt = sharedUpdatedAt
    }

    await app.waitForFileCount(N, 60_000)
  })
})

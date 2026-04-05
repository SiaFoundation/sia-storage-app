import {
  createEmptyIndexerStorage,
  generateMockFileMetadata,
} from '@siastorage/sdk-mock'
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

  it('preserves local tags when remote metadata has no tag data', async () => {
    app.sdk.injectObject({
      metadata: generateMockFileMetadata(1, { name: 'photo.jpg' }),
    })

    let fileId: string | undefined
    await waitForCondition(
      async () => {
        const files = await app.getFiles()
        if (files.length === 1) {
          fileId = files[0].id
          return true
        }
        return false
      },
      { timeout: 10_000, message: 'File to sync' },
    )

    await app.addTagToFile(fileId!, 'myTag')
    const tagsAfterAdd = (await app.readTagsForFile(fileId!)).filter(
      (t) => !t.system,
    )
    expect(tagsAfterAdd).toHaveLength(1)
    expect(tagsAfterAdd[0].name).toBe('myTag')

    await new Promise((r) => setTimeout(r, 3000))

    const tagsAfterSync = (await app.readTagsForFile(fileId!)).filter(
      (t) => !t.system,
    )
    expect(tagsAfterSync).toHaveLength(1)
    expect(tagsAfterSync[0].name).toBe('myTag')
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
          const tags = (await app.readTagsForFile(files[0].id)).filter(
            (t) => !t.system,
          )
          return tags.length === 1 && tags[0].name === 'original'
        }
        return false
      },
      { timeout: 10_000, message: 'Initial tags to sync' },
    )

    app.sdk.injectMetadataChange(stored.id, { tags: ['updated', 'new'] })

    await waitForCondition(
      async () => {
        const tags = (await app.readTagsForFile(fileId!)).filter(
          (t) => !t.system,
        )
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
})

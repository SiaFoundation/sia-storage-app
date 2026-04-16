import { createEmptyIndexerStorage, generateMockFileMetadata } from '@siastorage/sdk-mock'
import { createTestApp, generateTestFiles, waitForCondition, type TestApp } from './app'

describe('Directory Cascade', () => {
  let app: TestApp

  beforeEach(async () => {
    app = createTestApp(createEmptyIndexerStorage())
    await app.start()
  })

  afterEach(async () => {
    await app.shutdown()
  })

  it('delete directory trashes its files', async () => {
    const dir = await app.createDirectory('Photos')
    const files = await app.addFiles(generateTestFiles(3, { startId: 1 }))

    await app.moveFileToDirectory(files[0].id, dir.id)
    await app.moveFileToDirectory(files[1].id, dir.id)

    const trashedCount = await app.app.directories.deleteAndTrashFiles(dir.id)
    expect(trashedCount).toBe(2)

    const allFiles = await app.getFiles()
    const trashed = allFiles.filter((f) => f.trashedAt !== null)
    const active = allFiles.filter((f) => f.trashedAt === null)

    expect(trashed).toHaveLength(2)
    expect(trashed.map((f) => f.id).sort()).toEqual([files[0].id, files[1].id].sort())
    expect(active).toHaveLength(1)
    expect(active[0].id).toBe(files[2].id)

    const dirs = await app.readAllDirectoriesWithCounts()
    expect(dirs).toHaveLength(0)
  })

  it('delete empty directory', async () => {
    await app.createDirectory('Empty')

    const dirsBefore = await app.readAllDirectoriesWithCounts()
    expect(dirsBefore).toHaveLength(1)
    expect(dirsBefore[0].path).toBe('Empty')

    await app.app.directories.delete(dirsBefore[0].id)

    const dirsAfter = await app.readAllDirectoriesWithCounts()
    expect(dirsAfter).toHaveLength(0)
  })

  it('sync-down delete of last file in directory removes the directory', async () => {
    const fileId = 'mock-file-1'
    const stored = app.sdk.injectObject({
      metadata: generateMockFileMetadata(1, {
        name: 'ephemeral.jpg',
        directory: 'Ephemeral',
      }),
    })

    await waitForCondition(
      async () => {
        const dirs = await app.readAllDirectoriesWithCounts()
        return dirs.some((d) => d.path === 'Ephemeral' && d.fileCount === 1)
      },
      { timeout: 10_000, message: 'Directory with file to sync' },
    )

    app.sdk.injectDeleteEvent(stored.id)

    await waitForCondition(
      async () => {
        const file = await app.getFileById(fileId)
        return file?.deletedAt != null
      },
      { timeout: 10_000, message: 'File to be tombstoned' },
    )

    await waitForCondition(
      async () => {
        const dirs = await app.readAllDirectoriesWithCounts()
        return !dirs.some((d) => d.path === 'Ephemeral')
      },
      { timeout: 10_000, message: 'Empty directory to be cleaned up' },
    )
  })

  it('sync-down cascades cleanup through nested directories', async () => {
    const stored1 = app.sdk.injectObject({
      metadata: generateMockFileMetadata(1, {
        name: 'a.jpg',
        directory: 'Photos/Trips/Italy',
      }),
    })
    const stored2 = app.sdk.injectObject({
      metadata: generateMockFileMetadata(2, {
        name: 'b.jpg',
        directory: 'Photos/Trips/Italy',
      }),
    })
    const stored3 = app.sdk.injectObject({
      metadata: generateMockFileMetadata(3, {
        name: 'c.jpg',
        directory: 'Photos/Trips/Italy',
      }),
    })

    await waitForCondition(
      async () => {
        const dirs = await app.readAllDirectoriesWithCounts()
        const paths = new Set(dirs.map((d) => d.path))
        return paths.has('Photos') && paths.has('Photos/Trips') && paths.has('Photos/Trips/Italy')
      },
      { timeout: 10_000, message: 'Nested directories to sync' },
    )

    app.sdk.injectDeleteEvent(stored1.id)
    app.sdk.injectDeleteEvent(stored2.id)
    app.sdk.injectDeleteEvent(stored3.id)

    await waitForCondition(
      async () => {
        const dirs = await app.readAllDirectoriesWithCounts()
        return dirs.length === 0
      },
      { timeout: 10_000, message: 'Entire directory chain to be cleaned up' },
    )
  })

  it('sync-down move that empties the source directory removes it', async () => {
    const stored = app.sdk.injectObject({
      metadata: generateMockFileMetadata(1, {
        name: 'moved.jpg',
        directory: 'Source',
      }),
    })

    await waitForCondition(
      async () => {
        const dirs = await app.readAllDirectoriesWithCounts()
        return dirs.some((d) => d.path === 'Source' && d.fileCount === 1)
      },
      { timeout: 10_000, message: 'Source directory with file' },
    )

    app.sdk.injectMetadataChange(stored.id, { directory: 'Destination' })

    await waitForCondition(
      async () => {
        const dirs = await app.readAllDirectoriesWithCounts()
        const paths = new Set(dirs.map((d) => d.path))
        return paths.has('Destination') && !paths.has('Source')
      },
      { timeout: 10_000, message: 'Destination created and Source cleaned up' },
    )
  })

  it('move files between directories', async () => {
    const src = await app.createDirectory('Src')
    const dst = await app.createDirectory('Dst')
    const files = await app.addFiles(generateTestFiles(2, { startId: 1 }))

    await app.moveFileToDirectory(files[0].id, src.id)

    const pathAfterSrc = await app.readDirectoryPathForFile(files[0].id)
    expect(pathAfterSrc).toBe('Src')

    await app.moveFileToDirectory(files[0].id, dst.id)

    const pathAfterDst = await app.readDirectoryPathForFile(files[0].id)
    expect(pathAfterDst).toBe('Dst')
  })
})

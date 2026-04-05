import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import { createTestApp, generateTestFiles, type TestApp } from './app'

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

    const trashedIds = await app.app.directories.deleteAndTrashFiles(dir.id)
    expect(trashedIds.sort()).toEqual([files[0].id, files[1].id].sort())

    const allFiles = await app.getFiles()
    const trashed = allFiles.filter((f) => f.trashedAt !== null)
    const active = allFiles.filter((f) => f.trashedAt === null)

    expect(trashed).toHaveLength(2)
    expect(trashed.map((f) => f.id).sort()).toEqual(
      [files[0].id, files[1].id].sort(),
    )
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

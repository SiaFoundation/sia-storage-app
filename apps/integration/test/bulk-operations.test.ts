import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import { createTestApp, generateTestFiles, type TestApp } from './app'

describe('Bulk Operations', () => {
  let app: TestApp

  beforeEach(async () => {
    app = createTestApp(createEmptyIndexerStorage())
    await app.start()
  })

  afterEach(async () => {
    await app.shutdown()
  })

  it('adds a tag to multiple files', async () => {
    const files = await app.addFiles(generateTestFiles(3))

    for (const file of files) {
      await app.addTagToFile(file.id, 'vacation')
    }

    for (const file of files) {
      const tags = await app.readTagsForFile(file.id)
      expect(tags).toHaveLength(1)
      expect(tags[0].name).toBe('vacation')
    }

    const allTags = await app.readAllTagsWithCounts()
    const vacationTag = allTags.find((t) => t.name === 'vacation')
    expect(vacationTag).toBeDefined()
    expect(vacationTag!.fileCount).toBe(3)
  })

  it('moves multiple files to a directory', async () => {
    const files = await app.addFiles(generateTestFiles(3))
    const dir = await app.createDirectory('Photos')

    for (const file of files) {
      await app.moveFileToDirectory(file.id, dir.id)
    }

    const dirs = await app.readAllDirectoriesWithCounts()
    const photosDir = dirs.find((d) => d.path === 'Photos')
    expect(photosDir).toBeDefined()
    expect(photosDir!.fileCount).toBe(3)
  })

  it('trashes and restores multiple files', async () => {
    const files = await app.addFiles(generateTestFiles(3))
    const ids = files.map((f) => f.id)

    await app.app.files.trash(ids)

    const afterTrash = await app.app.files.queryLibrary({
      sortBy: 'NAME',
      sortDir: 'ASC',
    })
    expect(afterTrash).toHaveLength(0)

    await app.app.files.restore(ids)

    const afterRestore = await app.app.files.queryLibrary({
      sortBy: 'NAME',
      sortDir: 'ASC',
    })
    expect(afterRestore).toHaveLength(3)
  })
})

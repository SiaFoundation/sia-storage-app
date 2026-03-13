import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import { createTestApp, generateTestFiles, type TestApp } from './app'

describe('Trash and Restore', () => {
  let app: TestApp

  beforeEach(async () => {
    app = createTestApp(createEmptyIndexerStorage())
    await app.start()
  })

  afterEach(async () => {
    await app.shutdown()
  })

  async function getActiveFiles() {
    return app.app.files.query({ order: 'ASC', activeOnly: true })
  }

  it('trash excludes files from library queries', async () => {
    const files = await app.addFiles(generateTestFiles(3))

    const before = await getActiveFiles()
    expect(before).toHaveLength(3)

    await app.app.files.trash([files[0].id, files[1].id])

    const after = await getActiveFiles()
    expect(after).toHaveLength(1)
    expect(after[0].id).toBe(files[2].id)
  })

  it('restore makes trashed files reappear', async () => {
    const files = await app.addFiles(generateTestFiles(3))

    await app.app.files.trash([files[0].id, files[1].id])
    expect(await getActiveFiles()).toHaveLength(1)

    await app.app.files.restore([files[0].id, files[1].id])

    const after = await getActiveFiles()
    expect(after).toHaveLength(3)
  })

  it('auto-purge removes old trashed files', async () => {
    const files = await app.addFiles(generateTestFiles(3))

    await app.app.files.trash([files[0].id, files[1].id])

    // Backdate trashedAt so auto-purge considers them expired
    for (const file of [files[0], files[1]]) {
      await app.app.files.update({ id: file.id, trashedAt: 1 })
    }

    const purged = await app.app.files.autoPurge()
    expect(purged).toHaveLength(2)
    expect(purged.sort()).toEqual([files[0].id, files[1].id].sort())

    const remaining = await getActiveFiles()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(files[2].id)
  })
})

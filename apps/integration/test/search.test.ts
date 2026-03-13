import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import { createTestApp, generateTestFiles, type TestApp } from './app'

describe('Search', () => {
  let app: TestApp

  beforeEach(async () => {
    app = createTestApp(createEmptyIndexerStorage())
    await app.start()
  })

  afterEach(async () => {
    await app.shutdown()
  })

  it('searches files by partial name match', async () => {
    await app.addFiles(generateTestFiles(3))

    const results = await app.app.files.queryLibrary({
      query: 'file-1',
      sortBy: 'NAME',
      sortDir: 'ASC',
    })

    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('file-1.bin')
  })

  it('returns empty results for no match', async () => {
    await app.addFiles(generateTestFiles(3))

    const results = await app.app.files.queryLibrary({
      query: 'nonexistent',
      sortBy: 'NAME',
      sortDir: 'ASC',
    })

    expect(results).toHaveLength(0)
  })

  it('searches case-insensitively', async () => {
    await app.app.files.create({
      id: 'custom-photo',
      name: 'MyPhoto.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-custom-photo',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      localId: null,
      addedAt: Date.now(),
      trashedAt: null,
      deletedAt: null,
    })

    const results = await app.app.files.queryLibrary({
      query: 'myphoto',
      sortBy: 'NAME',
      sortDir: 'ASC',
    })

    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('MyPhoto.jpg')
  })
})

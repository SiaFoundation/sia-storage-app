import { initializeDB, resetDb } from '../db'
import { app } from './appService'

describe('tags store (core stores)', () => {
  beforeEach(async () => {
    await initializeDB()
  })

  afterEach(async () => {
    await resetDb()
    jest.restoreAllMocks()
  })

  async function createTestFile(id: string) {
    await app().files.create({
      id,
      name: `${id}.jpg`,
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: `hash-${id}`,
      createdAt: 1000,
      updatedAt: 1000,
      localId: null,
      addedAt: 1000,
      trashedAt: null,
      deletedAt: null,
    })
  }

  test('createTag invalidates cache', async () => {
    const spy = jest.spyOn(app().caches.tags, 'invalidateAll')
    await app().tags.create('vacation')
    expect(spy).toHaveBeenCalled()
  })

  test('addTagToFile associates tag with file', async () => {
    await createTestFile('f1')
    const tagSpy = jest.spyOn(app().caches.tags, 'invalidateAll')
    const verSpy = jest.spyOn(app().caches.libraryVersion, 'invalidate')
    await app().tags.add('f1', 'tag1')
    const tags = await app().tags.getForFile('f1')
    expect(tags.some((t) => t.name === 'tag1')).toBe(true)
    expect(tagSpy).toHaveBeenCalled()
    expect(verSpy).toHaveBeenCalled()
  })

  test('toggleFavorite adds favorite tag', async () => {
    await createTestFile('f1')
    app().tags.ensureSystemTags()
    const tagSpy = jest.spyOn(app().caches.tags, 'invalidateAll')
    const verSpy = jest.spyOn(app().caches.libraryVersion, 'invalidate')
    await app().tags.toggleFavorite('f1')
    const tags = await app().tags.getForFile('f1')
    expect(tags.some((t) => t.name === 'Favorites')).toBe(true)
    expect(tagSpy).toHaveBeenCalled()
    expect(verSpy).toHaveBeenCalled()
  })

  test('renameTag updates tag name', async () => {
    const tag = await app().tags.create('old')
    const tagSpy = jest.spyOn(app().caches.tags, 'invalidateAll')
    const verSpy = jest.spyOn(app().caches.libraryVersion, 'invalidate')
    await app().tags.rename(tag.id, 'new')
    await createTestFile('f1')
    await app().tags.add('f1', 'new')
    const tags = await app().tags.getForFile('f1')
    expect(tags.some((t: { name: string }) => t.name === 'new')).toBe(true)
    expect(tagSpy).toHaveBeenCalled()
    expect(verSpy).toHaveBeenCalled()
  })

  test('deleteTag removes tag', async () => {
    const tag = await app().tags.create('toDelete')
    const tagSpy = jest.spyOn(app().caches.tags, 'invalidateAll')
    const verSpy = jest.spyOn(app().caches.libraryVersion, 'invalidate')
    await app().tags.delete(tag.id)
    const newTag = await app().tags.create('toDelete')
    expect(newTag.id).not.toBe(tag.id)
    expect(tagSpy).toHaveBeenCalled()
    expect(verSpy).toHaveBeenCalled()
  })

  test('syncTagsFromMetadata skips when undefined', async () => {
    await createTestFile('f1')
    await app().tags.add('f1', 'existing')
    const tagSpy = jest.spyOn(app().caches.tags, 'invalidateAll')
    const verSpy = jest.spyOn(app().caches.libraryVersion, 'invalidate')

    await app().tags.syncFromMetadata('f1', undefined)

    const tags = await app().tags.getForFile('f1')
    expect(tags.some((t: { name: string }) => t.name === 'existing')).toBe(true)
    expect(tagSpy).not.toHaveBeenCalled()
    expect(verSpy).not.toHaveBeenCalled()
  })

  test('syncTagsFromMetadata applies defined tags', async () => {
    await createTestFile('f1')
    const tagSpy = jest.spyOn(app().caches.tags, 'invalidateAll')
    const verSpy = jest.spyOn(app().caches.libraryVersion, 'invalidate')
    await app().tags.syncFromMetadata('f1', ['newTag'])
    const tags = await app().tags.getForFile('f1')
    expect(tags.some((t: { name: string }) => t.name === 'newTag')).toBe(true)
    expect(tagSpy).toHaveBeenCalled()
    expect(verSpy).toHaveBeenCalled()
  })
})

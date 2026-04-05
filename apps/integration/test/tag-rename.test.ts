import { decodeFileMetadata } from '@siastorage/core/encoding/fileMetadata'
import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import { createTestApp, generateTestFiles, type TestApp, waitForCondition } from './app'

describe('Tag Rename', () => {
  let app: TestApp

  beforeEach(async () => {
    app = createTestApp(createEmptyIndexerStorage())
    await app.start()
  })

  afterEach(async () => {
    await app.shutdown()
  })

  it('rename tag updates tag name', async () => {
    const [file] = await app.addFiles(generateTestFiles(1, { startId: 1 }))

    await app.addTagToFile(file.id, 'old-name')

    const tagsBefore = await app.readAllTagsWithCounts()
    const oldTag = tagsBefore.find((t) => t.name === 'old-name')
    expect(oldTag).toBeDefined()

    await app.renameTag(oldTag!.id, 'new-name')

    const tagsAfter = await app.readAllTagsWithCounts()
    expect(tagsAfter.find((t) => t.name === 'new-name')).toBeDefined()
    expect(tagsAfter.find((t) => t.name === 'old-name')).toBeUndefined()
  })

  it('renamed tag preserves file associations', async () => {
    const files = await app.addFiles(generateTestFiles(2, { startId: 1 }))

    await app.addTagToFile(files[0].id, 'vacation')
    await app.addTagToFile(files[1].id, 'vacation')

    const tags = await app.readAllTagsWithCounts()
    const vacationTag = tags.find((t) => t.name === 'vacation')!
    expect(vacationTag.fileCount).toBe(2)

    await app.renameTag(vacationTag.id, 'holiday')

    const tagsForFile0 = await app.readTagsForFile(files[0].id)
    expect(tagsForFile0).toHaveLength(1)
    expect(tagsForFile0[0].name).toBe('holiday')

    const tagsForFile1 = await app.readTagsForFile(files[1].id)
    expect(tagsForFile1).toHaveLength(1)
    expect(tagsForFile1[0].name).toBe('holiday')

    const allTags = await app.readAllTagsWithCounts()
    const holidayTag = allTags.find((t) => t.name === 'holiday')
    expect(holidayTag).toBeDefined()
    expect(holidayTag!.fileCount).toBe(2)
    expect(allTags.find((t) => t.name === 'vacation')).toBeUndefined()
  })

  it('tag rename syncs up', async () => {
    const [file] = await app.addFiles(generateTestFiles(1, { startId: 1 }))

    await waitForCondition(() => app.getUploadState(file.id) !== undefined, {
      timeout: 10_000,
      message: 'File to be detected by scanner',
    })
    await app.waitForNoActiveUploads()

    const localObjects = await app.readLocalObjectsForFile(file.id)
    expect(localObjects.length).toBeGreaterThan(0)
    const objectId = localObjects[0].id

    await app.addTagToFile(file.id, 'vacation')
    await app.updateFileRecord({ id: file.id, updatedAt: Date.now() }, { includeUpdatedAt: true })

    await waitForCondition(
      async () => {
        const remote = await app.sdk.getPinnedObject(objectId)
        const remoteMeta = decodeFileMetadata(remote.metadata())
        return remoteMeta.tags?.includes('vacation') === true
      },
      { timeout: 10_000, message: 'Remote metadata to include tag' },
    )

    const tags = await app.readAllTagsWithCounts()
    const vacationTag = tags.find((t) => t.name === 'vacation')!
    await app.renameTag(vacationTag.id, 'holiday')

    await waitForCondition(
      async () => {
        const remote = await app.sdk.getPinnedObject(objectId)
        const remoteMeta = decodeFileMetadata(remote.metadata())
        return (
          remoteMeta.tags?.includes('holiday') === true && !remoteMeta.tags?.includes('vacation')
        )
      },
      { timeout: 10_000, message: 'Remote metadata to have renamed tag' },
    )

    const remoteAfterSync = await app.sdk.getPinnedObject(objectId)
    const remoteMeta = decodeFileMetadata(remoteAfterSync.metadata())
    expect(remoteMeta.tags).toContain('holiday')
    expect(remoteMeta.tags).not.toContain('vacation')
  }, 30_000)
})

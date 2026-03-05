import { decodeFileMetadata } from '@siastorage/core/encoding/fileMetadata'
import { createEmptyStorage } from '@siastorage/sdk-mock'
import {
  createTestApp,
  generateTestFiles,
  type TestApp,
  waitForCondition,
} from './app'

describe('Sync Up Metadata', () => {
  let app: TestApp

  beforeEach(async () => {
    app = createTestApp(createEmptyStorage())
    await app.start()
  })

  afterEach(async () => {
    await app.shutdown()
  })

  it('pushes local file rename to remote', async () => {
    const [file] = await app.addFiles(generateTestFiles(1, { startId: 1 }))

    await waitForCondition(() => app.getUploadState(file.id) !== undefined, {
      timeout: 10_000,
      message: 'File to be detected by scanner',
    })

    await app.waitForNoActiveUploads()
    const localObjects = await app.readLocalObjectsForFile(file.id)
    expect(localObjects.length).toBeGreaterThan(0)
    const objectId = localObjects[0].id

    const remoteBeforeRename = await app.sdk.getPinnedObject(objectId)
    expect(remoteBeforeRename).toBeDefined()

    const newName = 'renamed-file.bin'
    const renameTimestamp = Date.now()
    await app.updateFileRecord(
      { id: file.id, name: newName, updatedAt: renameTimestamp },
      { includeUpdatedAt: true },
    )

    await waitForCondition(
      async () => {
        const remote = await app.sdk.getPinnedObject(objectId)
        const remoteMeta = decodeFileMetadata(remote.metadata())
        return remoteMeta.name === newName
      },
      { timeout: 10_000, message: 'Remote metadata to have new name' },
    )

    const remoteAfterSync = await app.sdk.getPinnedObject(objectId)
    const remoteMeta = decodeFileMetadata(remoteAfterSync.metadata())
    expect(remoteMeta.name).toBe(newName)
  }, 30_000)

  it('does not overwrite newer remote changes', async () => {
    const files = await app.addFiles(generateTestFiles(2, { startId: 1 }))
    const [file1, file2] = files

    await waitForCondition(() => app.getUploadState(file1.id) !== undefined, {
      timeout: 10_000,
      message: 'File 1 to be detected by scanner',
    })
    await waitForCondition(() => app.getUploadState(file2.id) !== undefined, {
      timeout: 10_000,
      message: 'File 2 to be detected by scanner',
    })
    await app.waitForNoActiveUploads()

    const localObjects1 = await app.readLocalObjectsForFile(file1.id)
    const localObjects2 = await app.readLocalObjectsForFile(file2.id)
    expect(localObjects1.length).toBeGreaterThan(0)
    expect(localObjects2.length).toBeGreaterThan(0)
    const objectId1 = localObjects1[0].id
    const objectId2 = localObjects2[0].id

    const currentFile1 = await app.getFileById(file1.id)
    const T1 = currentFile1!.updatedAt

    const remoteNewerName = 'remote-edited-name.bin'
    const T_remote = T1 + 10000
    app.sdk.injectMetadataChange(objectId1, {
      name: remoteNewerName,
      updatedAt: T_remote,
    })

    const localOlderName = 'local-older-edit.bin'
    const T_local_old = T1 + 1000
    await app.updateFileRecord(
      { id: file1.id, name: localOlderName, updatedAt: T_local_old },
      { includeUpdatedAt: true },
    )

    const file2NewName = 'file2-local-rename.bin'
    const T_file2 = Date.now()
    await app.updateFileRecord(
      { id: file2.id, name: file2NewName, updatedAt: T_file2 },
      { includeUpdatedAt: true },
    )

    await waitForCondition(
      async () => {
        const remote = await app.sdk.getPinnedObject(objectId2)
        const remoteMeta = decodeFileMetadata(remote.metadata())
        return remoteMeta.name === file2NewName
      },
      { timeout: 10_000, message: 'File 2 remote metadata to have new name' },
    )

    const remote1AfterSync = await app.sdk.getPinnedObject(objectId1)
    const remoteMeta1 = decodeFileMetadata(remote1AfterSync.metadata())
    expect(remoteMeta1.name).toBe(remoteNewerName)
    expect(remoteMeta1.updatedAt).toBe(T_remote)
  }, 30_000)

  it('pushes local tags to remote', async () => {
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
    await app.addTagToFile(file.id, 'beach')
    await app.updateFileRecord(
      { id: file.id, updatedAt: Date.now() },
      { includeUpdatedAt: true },
    )

    await waitForCondition(
      async () => {
        const remote = await app.sdk.getPinnedObject(objectId)
        const remoteMeta = decodeFileMetadata(remote.metadata())
        return (
          remoteMeta.tags !== undefined &&
          remoteMeta.tags.length === 2 &&
          remoteMeta.tags.slice().sort().join(',') === 'beach,vacation'
        )
      },
      { timeout: 10_000, message: 'Remote metadata to include tags' },
    )
  }, 30_000)

  it('pushes local directory to remote', async () => {
    const [file] = await app.addFiles(generateTestFiles(1, { startId: 1 }))

    await waitForCondition(() => app.getUploadState(file.id) !== undefined, {
      timeout: 10_000,
      message: 'File to be detected by scanner',
    })
    await app.waitForNoActiveUploads()

    const localObjects = await app.readLocalObjectsForFile(file.id)
    expect(localObjects.length).toBeGreaterThan(0)
    const objectId = localObjects[0].id

    const dir = await app.createDirectory('Vacation')
    await app.moveFileToDirectory(file.id, dir.id)

    await waitForCondition(
      async () => {
        const remote = await app.sdk.getPinnedObject(objectId)
        const remoteMeta = decodeFileMetadata(remote.metadata())
        return remoteMeta.directory === 'Vacation'
      },
      { timeout: 10_000, message: 'Remote metadata to include directory' },
    )
  }, 30_000)

  it('pushes renamed tag to remote', async () => {
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
    await app.updateFileRecord(
      { id: file.id, updatedAt: Date.now() },
      { includeUpdatedAt: true },
    )

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
    await app.renameTag(vacationTag.id, 'travel')

    await waitForCondition(
      async () => {
        const remote = await app.sdk.getPinnedObject(objectId)
        const remoteMeta = decodeFileMetadata(remote.metadata())
        return (
          remoteMeta.tags?.includes('travel') === true &&
          !remoteMeta.tags?.includes('vacation')
        )
      },
      { timeout: 10_000, message: 'Remote metadata to have renamed tag' },
    )
  }, 30_000)

  it('pushes renamed directory to remote', async () => {
    const [file] = await app.addFiles(generateTestFiles(1, { startId: 1 }))

    await waitForCondition(() => app.getUploadState(file.id) !== undefined, {
      timeout: 10_000,
      message: 'File to be detected by scanner',
    })
    await app.waitForNoActiveUploads()

    const localObjects = await app.readLocalObjectsForFile(file.id)
    expect(localObjects.length).toBeGreaterThan(0)
    const objectId = localObjects[0].id

    const dir = await app.createDirectory('Vacation')
    await app.moveFileToDirectory(file.id, dir.id)

    await waitForCondition(
      async () => {
        const remote = await app.sdk.getPinnedObject(objectId)
        const remoteMeta = decodeFileMetadata(remote.metadata())
        return remoteMeta.directory === 'Vacation'
      },
      { timeout: 10_000, message: 'Remote metadata to include directory' },
    )

    await app.renameDirectory(dir.id, 'Travel')

    await waitForCondition(
      async () => {
        const remote = await app.sdk.getPinnedObject(objectId)
        const remoteMeta = decodeFileMetadata(remote.metadata())
        return remoteMeta.directory === 'Travel'
      },
      { timeout: 10_000, message: 'Remote metadata to have renamed directory' },
    )
  }, 30_000)
})

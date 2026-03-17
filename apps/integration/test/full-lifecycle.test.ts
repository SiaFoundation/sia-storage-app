import { decodeFileMetadata } from '@siastorage/core/encoding/fileMetadata'
import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import {
  createTestApp,
  generateTestFiles,
  type TestApp,
  waitForCondition,
} from './app'

describe('Full File Lifecycle', () => {
  let app: TestApp

  beforeEach(async () => {
    app = createTestApp(createEmptyIndexerStorage())
    await app.start()
  })

  afterEach(async () => {
    await app.shutdown()
  })

  it('handles complete file lifecycle across local and remote', async () => {
    const [file] = await app.addFiles(generateTestFiles(1, { startId: 1 }))

    let dbFile = await app.getFileById(file.id)
    expect(dbFile).not.toBeNull()
    expect(dbFile!.name).toBe(file.name)
    let objects = await app.readLocalObjectsForFile(file.id)
    expect(objects).toHaveLength(0)

    await waitForCondition(() => app.getUploadState(file.id) !== undefined, {
      timeout: 10_000,
      message: 'File to be detected by scanner',
    })

    await app.waitForNoActiveUploads()

    objects = await app.readLocalObjectsForFile(file.id)
    expect(objects).toHaveLength(1)
    const objectId = objects[0].id

    await app.updateFileRecord(
      { id: file.id, name: 'beach-sunset.bin', updatedAt: Date.now() },
      { includeUpdatedAt: true },
    )

    await waitForCondition(
      () => {
        const remote = app.sdk.getStoredObjects().find((o) => o.id === objectId)
        return (
          remote !== undefined &&
          decodeFileMetadata(remote.metadata).name === 'beach-sunset.bin'
        )
      },
      { timeout: 10_000, message: 'Remote to have updated name' },
    )

    dbFile = await app.getFileById(file.id)
    expect(dbFile!.name).toBe('beach-sunset.bin')
    const remote = app.sdk.getStoredObjects().find((o) => o.id === objectId)!
    expect(decodeFileMetadata(remote.metadata).name).toBe('beach-sunset.bin')

    app.sdk.injectDeleteEvent(objectId)

    await waitForCondition(
      async () => {
        const deletedFile = await app.getFileById(file.id)
        return deletedFile?.deletedAt != null
      },
      { timeout: 10_000, message: 'File to be tombstoned' },
    )

    dbFile = await app.getFileById(file.id)
    expect(dbFile).not.toBeNull()
    expect(dbFile!.deletedAt).not.toBeNull()
    objects = await app.readLocalObjectsForFile(file.id)
    expect(objects).toHaveLength(0)
    const deletedRemote = app.sdk
      .getStoredObjects()
      .find((o) => o.id === objectId)
    expect(deletedRemote).toBeUndefined()
  }, 60_000)

  it('handles selective remote edits across multiple files', async () => {
    const testFiles = await app.addFiles(generateTestFiles(3, { startId: 1 }))

    await waitForCondition(
      () => testFiles.every((f) => app.getUploadState(f.id) !== undefined),
      { timeout: 10_000, message: 'Files to be detected by scanner' },
    )

    await app.waitForNoActiveUploads()

    for (const f of testFiles) {
      const objects = await app.readLocalObjectsForFile(f.id)
      expect(objects).toHaveLength(1)
    }

    const objects1 = await app.readLocalObjectsForFile(testFiles[1].id)
    app.sdk.injectMetadataChange(objects1[0].id, {
      name: 'renamed-remotely.bin',
      updatedAt: Date.now() + 1000,
    })

    await waitForCondition(
      async () => {
        const file1 = await app.getFileById(testFiles[1].id)
        return file1?.name === 'renamed-remotely.bin'
      },
      { timeout: 10_000, message: 'File 2 to be renamed' },
    )

    const file0 = await app.getFileById(testFiles[0].id)
    const file1 = await app.getFileById(testFiles[1].id)
    const file2 = await app.getFileById(testFiles[2].id)

    expect(file0!.name).toBe(testFiles[0].name)
    expect(file1!.name).toBe('renamed-remotely.bin')
    expect(file2!.name).toBe(testFiles[2].name)
  }, 60_000)
})

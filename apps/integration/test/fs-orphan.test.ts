import {
  deleteFsFileMetadataBatch,
  readFsFileMetadata,
} from '@siastorage/core/db/operations'
import { runOrphanScanner } from '@siastorage/core/services'
import { createEmptyStorage } from '@siastorage/sdk-mock'
import * as nodeFs from 'fs'
import * as path from 'path'
import { createTestApp, generateTestFiles, type TestApp } from './app'

describe('FS Orphan Scanner', () => {
  let app: TestApp

  beforeEach(async () => {
    app = createTestApp(createEmptyStorage())
    await app.start()
  })

  afterEach(async () => {
    await app.shutdown()
  })

  function listFsFiles() {
    return app.listFsFiles().map((name) => ({ name }))
  }

  it('removes files not tracked in the database', async () => {
    // Create an orphan file on disk (no corresponding files/fs row)
    const orphanPath = path.join(app.tempDir, 'orphan-file.bin')
    nodeFs.writeFileSync(orphanPath, Buffer.alloc(100))

    const deleted: string[] = []
    const result = await runOrphanScanner({
      db: app.db,
      listFiles: listFsFiles,
      deleteFile: (file) => {
        const fp = path.join(app.tempDir, file.name)
        if (nodeFs.existsSync(fp)) nodeFs.unlinkSync(fp)
        deleted.push(file.name)
      },
      deleteFsMetadataBatch: (fileIds) =>
        deleteFsFileMetadataBatch(app.db, fileIds),
    })

    expect(result).toBeDefined()
    expect(result!.removed).toBe(1)
    expect(deleted).toContain('orphan-file.bin')
    expect(nodeFs.existsSync(orphanPath)).toBe(false)
  })

  it('keeps tracked files intact', async () => {
    const fileFactories = generateTestFiles(2, {
      startId: 1,
      sizeBytes: 100,
    })
    const files = await app.addFiles(fileFactories)

    const deleted: string[] = []
    await runOrphanScanner({
      db: app.db,
      listFiles: listFsFiles,
      deleteFile: (file) => {
        deleted.push(file.name)
      },
      deleteFsMetadataBatch: (fileIds) =>
        deleteFsFileMetadataBatch(app.db, fileIds),
    })

    expect(deleted).toHaveLength(0)

    for (const file of files) {
      const uri = await app.getFsFileUri({ id: file.id, type: file.type })
      expect(uri).not.toBeNull()
    }
  })

  it('removes files whose file record has been soft-deleted', async () => {
    const fileFactories = generateTestFiles(1, {
      startId: 1,
      sizeBytes: 100,
    })
    const [file] = await app.addFiles(fileFactories)

    const uriBefore = await app.getFsFileUri({ id: file.id, type: file.type })
    expect(uriBefore).not.toBeNull()

    // Soft-delete the file record
    await app.updateFileRecord(
      { id: file.id, deletedAt: Date.now() },
      { includeUpdatedAt: false },
    )

    const deleted: string[] = []
    const result = await runOrphanScanner({
      db: app.db,
      listFiles: listFsFiles,
      deleteFile: (file) => {
        const fp = path.join(app.tempDir, file.name)
        if (nodeFs.existsSync(fp)) nodeFs.unlinkSync(fp)
        deleted.push(file.name)
      },
      deleteFsMetadataBatch: (fileIds) =>
        deleteFsFileMetadataBatch(app.db, fileIds),
    })

    expect(result).toBeDefined()
    expect(result!.removed).toBe(1)
  })

  it('handles mix of tracked, orphaned, and deleted files', async () => {
    // 1. Tracked file (should be kept)
    const [trackedFile] = await app.addFiles(
      generateTestFiles(1, { startId: 1, sizeBytes: 100 }),
    )

    // 2. Orphan file (not in DB at all)
    const orphanPath = path.join(app.tempDir, 'stale-orphan.bin')
    nodeFs.writeFileSync(orphanPath, Buffer.alloc(50))

    // 3. Soft-deleted file
    const [deletedFile] = await app.addFiles(
      generateTestFiles(1, { startId: 2, sizeBytes: 100 }),
    )
    await app.updateFileRecord(
      { id: deletedFile.id, deletedAt: Date.now() },
      { includeUpdatedAt: false },
    )

    const deletedNames: string[] = []
    await runOrphanScanner({
      db: app.db,
      listFiles: listFsFiles,
      deleteFile: (file) => {
        const fp = path.join(app.tempDir, file.name)
        if (nodeFs.existsSync(fp)) nodeFs.unlinkSync(fp)
        deletedNames.push(file.name)
      },
      deleteFsMetadataBatch: (fileIds) =>
        deleteFsFileMetadataBatch(app.db, fileIds),
    })

    // Orphan + soft-deleted = 2 removed
    expect(deletedNames).toHaveLength(2)

    // Tracked file still exists
    const trackedUri = await app.getFsFileUri({
      id: trackedFile.id,
      type: trackedFile.type,
    })
    expect(trackedUri).not.toBeNull()

    // Orphan is gone
    expect(nodeFs.existsSync(orphanPath)).toBe(false)
  })

  it('cleans up fs metadata for orphaned entries', async () => {
    const [file] = await app.addFiles(
      generateTestFiles(1, { startId: 1, sizeBytes: 100 }),
    )

    // Verify metadata exists
    const metaBefore = await readFsFileMetadata(app.db, file.id)
    expect(metaBefore).not.toBeNull()

    // Delete the file record (making it an orphan)
    await app.db.runAsync('DELETE FROM files WHERE id = ?', file.id)

    await runOrphanScanner({
      db: app.db,
      listFiles: listFsFiles,
      deleteFile: (f) => {
        const fp = path.join(app.tempDir, f.name)
        if (nodeFs.existsSync(fp)) nodeFs.unlinkSync(fp)
      },
      deleteFsMetadataBatch: (fileIds) =>
        deleteFsFileMetadataBatch(app.db, fileIds),
    })

    // fs metadata should also be cleaned up
    const metaAfter = await readFsFileMetadata(app.db, file.id)
    expect(metaAfter).toBeNull()
  })

  it('returns undefined when no files exist on disk', async () => {
    const result = await runOrphanScanner({
      db: app.db,
      listFiles: () => [],
      deleteFile: () => {},
      deleteFsMetadataBatch: (fileIds) =>
        deleteFsFileMetadataBatch(app.db, fileIds),
    })

    expect(result).toBeUndefined()
  })
})

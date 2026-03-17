import { runOrphanScanner } from '@siastorage/core/services'
import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import * as nodeFs from 'fs'
import * as path from 'path'
import { createTestApp, generateTestFiles, type TestApp } from './app'

describe('FS Orphan Scanner', () => {
  let app: TestApp

  beforeEach(async () => {
    app = createTestApp(createEmptyIndexerStorage())
    await app.start()
  })

  afterEach(async () => {
    await app.shutdown()
  })

  it('removes files not tracked in the database', async () => {
    // Create an orphan file on disk (no corresponding files/fs row)
    const orphanPath = path.join(app.tempDir, 'orphan-file.bin')
    nodeFs.writeFileSync(orphanPath, Buffer.alloc(100))

    const result = await runOrphanScanner(app.app)

    expect(result).toBeDefined()
    expect(result!.removed).toBe(1)
    expect(nodeFs.existsSync(orphanPath)).toBe(false)
  })

  it('keeps tracked files intact', async () => {
    const fileFactories = generateTestFiles(2, {
      startId: 1,
      sizeBytes: 100,
    })
    const files = await app.addFiles(fileFactories)

    const result = await runOrphanScanner(app.app)

    expect(result).toBeDefined()
    expect(result!.removed).toBe(0)

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

    const result = await runOrphanScanner(app.app)

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

    const result = await runOrphanScanner(app.app)

    // Orphan + soft-deleted = 2 removed
    expect(result).toBeDefined()
    expect(result!.removed).toBe(2)

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
    const metaBefore = await app.app.fs.readMeta(file.id)
    expect(metaBefore).not.toBeNull()

    // Delete the file record (making it an orphan)
    await app.app.files.delete(file.id)

    await runOrphanScanner(app.app)

    // fs metadata should also be cleaned up
    const metaAfter = await app.app.fs.readMeta(file.id)
    expect(metaAfter).toBeNull()
  })

  it('returns undefined when no files exist on disk', async () => {
    const result = await runOrphanScanner(app.app)

    expect(result).toBeUndefined()
  })
})

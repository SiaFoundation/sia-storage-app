import {
  readFsFileMetadata,
  upsertFsFileMetadata,
} from '@siastorage/core/db/operations'
import { runCacheEviction } from '@siastorage/core/services'
import { createEmptyStorage } from '@siastorage/sdk-mock'
import * as nodeFs from 'fs'
import { createTestApp, generateTestFiles, type TestApp } from './app'

describe('FS Cache Eviction', () => {
  let app: TestApp

  beforeEach(async () => {
    app = createTestApp(createEmptyStorage())
    await app.start()
  })

  afterEach(async () => {
    await app.shutdown()
  })

  it('evicts oldest cached files when total size exceeds limit', async () => {
    const fileFactories = generateTestFiles(3, {
      startId: 1,
      sizeBytes: 1000,
    })
    const files = await app.addFiles(fileFactories)
    await app.waitForNoActiveUploads()

    // Backdate usedAt on first two files so they're eviction candidates
    const oldTime = Date.now() - 8 * 24 * 60 * 60 * 1000 // 8 days ago
    for (const file of files.slice(0, 2)) {
      await upsertFsFileMetadata(app.db, {
        fileId: file.id,
        size: file.size,
        addedAt: oldTime,
        usedAt: oldTime,
      })
    }

    const deleted: string[] = []
    await runCacheEviction({
      db: app.db,
      deleteFile: async (fileId, type) => {
        await app.removeFsFile(fileId, type)
        deleted.push(fileId)
      },
      maxBytes: 1500,
      minAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    })

    expect(deleted.length).toBeGreaterThanOrEqual(1)
    for (const fileId of deleted) {
      const uri = await app.getFsFileUri({
        id: fileId,
        type: 'application/octet-stream',
      })
      expect(uri).toBeNull()
    }
  }, 60_000)

  it('does not evict local-only files (no associated object)', async () => {
    const fileFactories = generateTestFiles(2, {
      startId: 1,
      sizeBytes: 2000,
    })
    const files = await app.addFiles(fileFactories)

    // Don't wait for uploads — files remain local-only
    // Backdate usedAt so they'd be eviction candidates if they had objects
    const oldTime = Date.now() - 30 * 24 * 60 * 60 * 1000
    for (const file of files) {
      await upsertFsFileMetadata(app.db, {
        fileId: file.id,
        size: file.size,
        addedAt: oldTime,
        usedAt: oldTime,
      })
    }

    app.setConnected(false)

    const deleted: string[] = []
    await runCacheEviction({
      db: app.db,
      deleteFile: async (fileId, type) => {
        await app.removeFsFile(fileId, type)
        deleted.push(fileId)
      },
      maxBytes: 100,
      minAge: 0,
    })

    expect(deleted).toHaveLength(0)

    for (const file of files) {
      const uri = await app.getFsFileUri({
        id: file.id,
        type: file.type,
      })
      expect(uri).not.toBeNull()
    }
  }, 60_000)

  it('does not evict files newer than minAge', async () => {
    const fileFactories = generateTestFiles(2, {
      startId: 1,
      sizeBytes: 2000,
    })
    await app.addFiles(fileFactories)
    await app.waitForNoActiveUploads()

    const deleted: string[] = []
    await runCacheEviction({
      db: app.db,
      deleteFile: async (fileId, type) => {
        await app.removeFsFile(fileId, type)
        deleted.push(fileId)
      },
      maxBytes: 100,
      minAge: 7 * 24 * 60 * 60 * 1000,
    })

    expect(deleted).toHaveLength(0)
  }, 60_000)

  it('skips eviction when total size is under limit', async () => {
    const fileFactories = generateTestFiles(2, {
      startId: 1,
      sizeBytes: 100,
    })
    await app.addFiles(fileFactories)
    await app.waitForNoActiveUploads()

    const result = await runCacheEviction({
      db: app.db,
      deleteFile: async () => {},
      maxBytes: 1_000_000,
    })

    expect(result).toBeUndefined()
  }, 60_000)

  it('getFsFileUri cleans up metadata when file is missing from disk', async () => {
    const fileFactories = generateTestFiles(1, { startId: 1, sizeBytes: 100 })
    const [file] = await app.addFiles(fileFactories)

    const uriBefore = await app.getFsFileUri({
      id: file.id,
      type: file.type,
    })
    expect(uriBefore).not.toBeNull()

    const metaBefore = await readFsFileMetadata(app.db, file.id)
    expect(metaBefore).not.toBeNull()

    // Delete the file from disk without updating metadata
    const filePath = uriBefore!.replace('file://', '')
    nodeFs.unlinkSync(filePath)

    const uriAfter = await app.getFsFileUri({
      id: file.id,
      type: file.type,
    })
    expect(uriAfter).toBeNull()

    const metaAfter = await readFsFileMetadata(app.db, file.id)
    expect(metaAfter).toBeNull()
  })

  it('getFsFileUri auto-tracks untracked files on disk', async () => {
    const fileFactories = generateTestFiles(1, { startId: 1, sizeBytes: 100 })
    const [file] = await app.addFiles(fileFactories)

    const uri = await app.getFsFileUri({ id: file.id, type: file.type })
    expect(uri).not.toBeNull()

    // Manually delete the metadata but keep the file on disk
    await app.db.runAsync('DELETE FROM fs WHERE fileId = ?', file.id)
    const metaGone = await readFsFileMetadata(app.db, file.id)
    expect(metaGone).toBeNull()

    // getFsFileUri should re-insert the metadata
    const uri2 = await app.getFsFileUri({ id: file.id, type: file.type })
    expect(uri2).not.toBeNull()

    const metaRestored = await readFsFileMetadata(app.db, file.id)
    expect(metaRestored).not.toBeNull()
    expect(metaRestored!.fileId).toBe(file.id)
  })

  it('getFsFileUri throttles usedAt updates', async () => {
    const fileFactories = generateTestFiles(1, { startId: 1, sizeBytes: 100 })
    const [file] = await app.addFiles(fileFactories)

    await app.getFsFileUri({ id: file.id, type: file.type })
    const meta1 = await readFsFileMetadata(app.db, file.id)

    // Second call within throttle window should not update usedAt
    await app.getFsFileUri({ id: file.id, type: file.type })
    const meta2 = await readFsFileMetadata(app.db, file.id)
    expect(meta2!.usedAt).toBe(meta1!.usedAt)
  })
})

import { runCacheEviction, runOrphanScanner } from '@siastorage/core/services'
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
    await app.updateFileRecord({ id: file.id, deletedAt: Date.now() }, { updatedAt: 'now' })

    const result = await runOrphanScanner(app.app)

    expect(result).toBeDefined()
    expect(result!.removed).toBe(1)
  })

  it('handles mix of tracked, orphaned, and deleted files', async () => {
    // 1. Tracked file (should be kept)
    const [trackedFile] = await app.addFiles(generateTestFiles(1, { startId: 1, sizeBytes: 100 }))

    // 2. Orphan file (not in DB at all)
    const orphanPath = path.join(app.tempDir, 'stale-orphan.bin')
    nodeFs.writeFileSync(orphanPath, Buffer.alloc(50))

    // 3. Soft-deleted file
    const [deletedFile] = await app.addFiles(generateTestFiles(1, { startId: 2, sizeBytes: 100 }))
    await app.updateFileRecord({ id: deletedFile.id, deletedAt: Date.now() }, { updatedAt: 'now' })

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
    const [file] = await app.addFiles(generateTestFiles(1, { startId: 1, sizeBytes: 100 }))

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

  it('a live file found on disk without an fs row is recorded as unused, so eviction can take it', async () => {
    const [file] = await app.addFiles(generateTestFiles(1, { startId: 1, sizeBytes: 100 }))
    await app.waitForNoActiveUploads()
    // The state a cleared database leaves once sync-down brings the record
    // back: the bytes and the files row are there, the fs row is not.
    await app.app.fs.deleteMeta(file.id)

    await runOrphanScanner(app.app)

    const meta = await app.app.fs.readMeta(file.id)
    expect(meta?.usedAt).toBe(0)
    const evicted = await runCacheEviction(app.app, { maxBytes: 0 })
    expect(evicted?.evictedFileIds).toContain(file.id)
  })

  it('reports the bytes of the orphans it removes', async () => {
    const stray = { id: 'stray', type: 'image/jpeg' }
    await app.app.fs.writeFileData(stray, new Uint8Array(300).buffer)

    const result = await runOrphanScanner(app.app)

    expect(result).toMatchObject({ removed: 1, bytesFreed: 300 })
  })

  it('spares a file whose fs row was written within the given window, as a thumbnail is before its files row', async () => {
    const thumb = { id: 'thumb-in-progress', type: 'image/webp' }
    await app.app.fs.writeFileData(thumb, new Uint8Array(50).buffer)

    const result = await runOrphanScanner(app.app, undefined, undefined, {
      spareWrittenWithin: 10 * 60_000,
    })

    expect(result?.removed).toBe(0)
    expect(await app.app.fs.readMeta(thumb.id)).not.toBeNull()
    expect(await app.app.fs.sizeOnDisk(thumb)).toBe(50)
  })

  it('returns undefined when no files exist on disk', async () => {
    const result = await runOrphanScanner(app.app)

    expect(result).toBeUndefined()
  })

  it.each([
    [
      'writeFileData',
      (app: TestApp['app']) =>
        app.fs.writeFileData({ id: 'thumb-new', type: 'image/webp' }, new ArrayBuffer(10)),
    ],
    [
      'copyFile',
      (app: TestApp['app']) =>
        app.fs.copyFile({ id: 'thumb-new', type: 'image/webp' }, 'file:///exports/source.webp'),
    ],
  ])(
    'keeps a new file whose bytes land through %s before its fs row is written',
    async (_writer, write) => {
      // Writers put the bytes down, then record the fs row, then the files
      // row. A scan that lists the bytes before the fs row exists sees a file
      // nothing records.
      const disk = new Set<string>()
      const removed: string[] = []
      let finishWrite!: () => void
      const writePaused = new Promise<void>((resolve) => {
        finishWrite = resolve
      })
      const putDown = async (fileId: string, size: number) => {
        disk.add(`/files/${fileId}.webp`)
        await writePaused
        return { uri: `file:///files/${fileId}.webp`, size }
      }
      const writer = createTestApp(createEmptyIndexerStorage(), {
        fsIO: {
          list: async () => [...disk],
          writeFile: (file, data) => putDown(file.id, data.byteLength),
          copy: (file) => putDown(file.id, 10),
          remove: async (fileId) => {
            removed.push(fileId)
          },
        },
      })
      await writer.start()
      try {
        const writing = write(writer.app)
        while (disk.size === 0) await new Promise((resolve) => setImmediate(resolve))

        const result = await runOrphanScanner(writer.app, undefined, undefined, {
          spareWrittenWithin: 10 * 60_000,
        })

        expect(removed).toEqual([])
        expect(result).toMatchObject({ removed: 0 })
        finishWrite()
        await writing
        expect(await writer.app.fs.readMeta('thumb-new')).not.toBeNull()
      } finally {
        finishWrite()
        await writer.shutdown()
      }
    },
  )

  it('keeps a file while a second write of it is still going after the first finished', async () => {
    const disk = new Set<string>()
    const removed: string[] = []
    const finishes: Array<() => void> = []
    const writer = createTestApp(createEmptyIndexerStorage(), {
      fsIO: {
        list: async () => [...disk],
        writeFile: async (file, data) => {
          disk.add(`/files/${file.id}.webp`)
          await new Promise<void>((resolve) => finishes.push(resolve))
          return { uri: `file:///files/${file.id}.webp`, size: data.byteLength }
        },
        remove: async (fileId) => {
          removed.push(fileId)
          disk.delete(`/files/${fileId}.webp`)
        },
      },
    })
    await writer.start()
    try {
      const file = { id: 'thumb-twice', type: 'image/webp' }
      const first = writer.app.fs.writeFileData(file, new ArrayBuffer(10))
      const second = writer.app.fs.writeFileData(file, new ArrayBuffer(10))
      while (finishes.length < 2) await new Promise((resolve) => setImmediate(resolve))
      finishes[0]()
      await first
      // The first write recorded its fs row, so drop it to stand for the
      // moment before the second write records its own.
      await writer.app.fs.deleteMeta(file.id)

      await runOrphanScanner(writer.app, undefined, undefined, { spareWrittenWithin: 10 * 60_000 })

      expect(removed).toEqual([])
      finishes[1]()
      await second
    } finally {
      for (const finish of finishes) finish()
      await writer.shutdown()
    }
  })
})

import type { FsIOAdapter } from '@siastorage/core/services/fsFileUri'
import { createEmptyIndexerStorage, type MockIndexerStorage } from '@siastorage/sdk-mock'
import { createFsAdapter } from './adapters/fs'
import { createTestApp, generateTestFiles } from './app'

/*
 * Holds every packer add until `release`, recording the path of each one. The
 * uploader packs the first file of a poll on its own, since it opens the
 * packer, and fires the rest together once that add settles. So while the
 * hold is on, the first file reads as packing and the others sit in the
 * uploader's queue, or, after `release` lets the first add through, the
 * others read as packing with their adds waiting on the next hold.
 */
function holdAdds(storage: MockIndexerStorage) {
  const paths: string[] = []
  let release: () => void = () => {}
  let gate = new Promise<void>((resolve) => {
    release = resolve
  })
  storage.beforeAdd = async (path) => {
    paths.push(path)
    await gate
  }
  return {
    paths,
    release: () => release(),
    holdAgain: () => {
      gate = new Promise<void>((resolve) => {
        release = resolve
      })
    },
  }
}

describe('Trashing a file waiting to upload', () => {
  it('drops a file trashed while it waits in the upload queue, without reading or uploading it', async () => {
    const storage = createEmptyIndexerStorage()
    const hold = holdAdds(storage)
    const app = createTestApp(storage)
    await app.start()
    try {
      const files = await app.addFiles(generateTestFiles(4, { sizeBytes: 4096 }))
      await app.waitForCondition(() => app.getUploadState(files[0].id)?.status === 'packing')
      await app.waitForCondition(() => files.every((f) => app.getUploadState(f.id) !== undefined))

      await app.app.files.trashFile(files[2].id)
      await app.app.files.trashFile(files[3].id)
      hold.release()

      await app.waitForCondition(
        async () => (await app.readLocalObjectsForFile(files[1].id)).length > 0,
        30_000,
      )
      await app.waitForCondition(() => app.getActiveUploadCount() === 0)

      for (const trashed of [files[2], files[3]]) {
        expect(await app.readLocalObjectsForFile(trashed.id)).toHaveLength(0)
        expect(hold.paths.some((p) => p.includes(trashed.id))).toBe(false)
      }
      expect(storage.objects.size).toBe(2)
    } finally {
      await app.shutdown()
    }
  })

  it('drops the queued files of a folder deleted while they wait to upload', async () => {
    const storage = createEmptyIndexerStorage()
    const hold = holdAdds(storage)
    const app = createTestApp(storage)
    await app.start()
    try {
      const files = await app.addFiles(generateTestFiles(4, { sizeBytes: 4096 }))
      await app.waitForCondition(() => app.getUploadState(files[0].id)?.status === 'packing')
      await app.waitForCondition(() => files.every((f) => app.getUploadState(f.id) !== undefined))
      const folder = await app.createDirectory('Drafts')
      await app.moveFileToDirectory(files[2].id, folder.id)
      await app.moveFileToDirectory(files[3].id, folder.id)

      await app.app.directories.deleteAndTrashFiles(folder.id)
      hold.release()

      await app.waitForCondition(
        async () => (await app.readLocalObjectsForFile(files[1].id)).length > 0,
        30_000,
      )
      await app.waitForCondition(() => app.getActiveUploadCount() === 0)

      for (const trashed of [files[2], files[3]]) {
        expect(await app.readLocalObjectsForFile(trashed.id)).toHaveLength(0)
        expect(hold.paths.some((p) => p.includes(trashed.id))).toBe(false)
      }
      expect(storage.objects.size).toBe(2)
    } finally {
      await app.shutdown()
    }
  })

  it('does not pin a file trashed while its add is in flight', async () => {
    const storage = createEmptyIndexerStorage()
    const hold = holdAdds(storage)
    const app = createTestApp(storage)
    await app.start()
    try {
      const files = await app.addFiles(generateTestFiles(3, { sizeBytes: 4096 }))
      await app.waitForCondition(() => app.getUploadState(files[0].id)?.status === 'packing')
      await app.waitForCondition(() => files.every((f) => app.getUploadState(f.id) !== undefined))
      // The first file's add goes through, and the adds fired after it wait.
      hold.release()
      hold.holdAgain()
      await app.waitForCondition(() => app.getUploadState(files[2].id)?.status === 'packing')

      await app.app.files.trashFile(files[1].id)
      hold.release()

      await app.waitForCondition(
        async () => (await app.readLocalObjectsForFile(files[2].id)).length > 0,
        30_000,
      )
      await app.waitForCondition(() => app.getActiveUploadCount() === 0)

      expect(await app.readLocalObjectsForFile(files[1].id)).toHaveLength(0)
      // The trashed file's bytes went up with the batch, but only pinned
      // objects reach the indexer's event feed.
      expect(storage.events.filter((event) => !event.deleted)).toHaveLength(2)
    } finally {
      await app.shutdown()
    }
  })

  it('uploads a file restored from the trash after it was dropped from the queue', async () => {
    const storage = createEmptyIndexerStorage()
    const hold = holdAdds(storage)
    const app = createTestApp(storage)
    await app.start()
    try {
      const files = await app.addFiles(generateTestFiles(2, { sizeBytes: 4096 }))
      await app.waitForCondition(() => app.getUploadState(files[0].id)?.status === 'packing')
      await app.waitForCondition(() => files.every((f) => app.getUploadState(f.id) !== undefined))

      await app.app.files.trashFile(files[1].id)
      hold.release()
      await app.waitForCondition(
        async () => (await app.readLocalObjectsForFile(files[0].id)).length > 0,
        30_000,
      )
      expect(await app.readLocalObjectsForFile(files[1].id)).toHaveLength(0)

      const entries = await app.app.files.trashEntries()
      await app.app.files.restoreTrashEntries(entries.map((e) => e.id))
      await app.waitForCondition(
        async () => (await app.readLocalObjectsForFile(files[1].id)).length > 0,
        30_000,
      )
    } finally {
      await app.shutdown()
    }
  })

  it('does not pack a file trashed while the poll is reading its local copy', async () => {
    const storage = createEmptyIndexerStorage()
    const added: string[] = []
    storage.beforeAdd = async (path) => {
      added.push(path)
    }
    // The poll stats each candidate's local copy before it registers any of
    // them, so holding the first stat leaves the poll between the two.
    let real: FsIOAdapter | null = null
    let releaseStat: (() => void) | null = null
    let holdNextStat = true
    const app = createTestApp(storage, {
      fsIO: {
        uri: (fileId, type) => real!.uri(fileId, type),
        remove: (fileId, type) => real!.remove(fileId, type),
        size: async (fileId, type) => {
          if (fileId === 'test-file-1' && holdNextStat) {
            holdNextStat = false
            await new Promise<void>((resolve) => {
              releaseStat = resolve
            })
          }
          return real!.size(fileId, type)
        },
      },
    })
    real = createFsAdapter({ tempDir: app.tempDir }).fsIO
    await app.start()
    try {
      const [trashed, kept] = await app.addFiles(generateTestFiles(2, { sizeBytes: 4096 }))
      await app.waitForCondition(() => releaseStat !== null)

      await app.app.files.trashFile(trashed.id)
      releaseStat!()

      await app.waitForCondition(
        async () => (await app.readLocalObjectsForFile(kept.id)).length > 0,
        30_000,
      )
      await app.waitForCondition(() => app.getActiveUploadCount() === 0)
      expect(added.some((p) => p.includes(trashed.id))).toBe(false)
      expect(await app.readLocalObjectsForFile(trashed.id)).toHaveLength(0)
    } finally {
      await app.shutdown()
    }
  })

  it('drops a queued thumbnail with the file it belongs to', async () => {
    const storage = createEmptyIndexerStorage()
    const hold = holdAdds(storage)
    const app = createTestApp(storage)
    await app.start()
    try {
      const files = await app.addFiles(generateTestFiles(3, { sizeBytes: 4096 }))
      await app.waitForCondition(() => app.getUploadState(files[0].id)?.status === 'packing')
      const thumb = { id: 'thumb-of-3', type: 'image/webp' }
      await app.app.files.create({
        ...thumb,
        name: 'thumb-of-3.webp',
        kind: 'thumb',
        size: 512,
        hash: 'sha256:hash-thumb-of-3',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        mediaAssetId: null,
        addedAt: Date.now(),
        thumbForId: files[2].id,
        thumbSize: 512,
        trashedAt: null,
        deletedAt: null,
      })
      await app.app.fs.writeFileData(thumb, new Uint8Array(512).fill(7).buffer)
      expect(await app.app.uploader.enqueueByIds([thumb.id])).toEqual({ queued: 1, skipped: 0 })

      await app.app.files.trashFile(files[2].id)
      expect(app.getUploadState(thumb.id)).toBeUndefined()
      hold.release()

      await app.waitForCondition(
        async () => (await app.readLocalObjectsForFile(files[1].id)).length > 0,
        30_000,
      )
      await app.waitForCondition(() => app.getActiveUploadCount() === 0)
      expect(hold.paths.some((p) => p.includes(thumb.id))).toBe(false)
      expect(await app.readLocalObjectsForFile(thumb.id)).toHaveLength(0)
    } finally {
      await app.shutdown()
    }
  })

  it('does not queue a file trashed while a direct enqueue reads its local copy', async () => {
    const storage = createEmptyIndexerStorage()
    let real: FsIOAdapter | null = null
    let releaseStat: (() => void) | null = null
    let holdStats = false
    const app = createTestApp(storage, {
      fsIO: {
        uri: (fileId, type) => real!.uri(fileId, type),
        remove: (fileId, type) => real!.remove(fileId, type),
        size: async (fileId, type) => {
          if (fileId === 'test-file-1' && holdStats) {
            holdStats = false
            await new Promise<void>((resolve) => {
              releaseStat = resolve
            })
          }
          return real!.size(fileId, type)
        },
      },
    })
    real = createFsAdapter({ tempDir: app.tempDir }).fsIO
    await app.start()
    try {
      // Only the direct enqueue below may take the file.
      await app.app.settings.setAutoScanUploads(false)
      const [file] = await app.addFiles(generateTestFiles(1, { sizeBytes: 4096 }))
      holdStats = true
      const enqueue = app.app.uploader.enqueueByIds([file.id])
      await app.waitForCondition(() => releaseStat !== null)

      await app.app.files.trashFile(file.id)
      releaseStat!()

      expect(await enqueue).toEqual({ queued: 0, skipped: 1 })
      expect(app.getUploadState(file.id)).toBeUndefined()
    } finally {
      await app.shutdown()
    }
  })
})

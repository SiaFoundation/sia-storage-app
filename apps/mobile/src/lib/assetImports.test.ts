import { db, initializeDB, resetDb } from '../db'
import { markImportCopyComplete, markImportCopyStarted } from '../managers/importScanner'
import { app } from '../stores/appService'
import { copyFileToFs } from '../stores/fs'
import { calculateContentHash } from './contentHash'
import { getMimeType } from './fileTypes'
import { getMediaLibraryUri } from './mediaLibrary'
import { catalogAssets, importAssets, syncAssets } from './assetImports'

jest.mock('./mediaLibrary', () => ({
  getMediaLibraryUri: jest.fn(),
}))
jest.mock('./contentHash', () => ({
  calculateContentHash: jest.fn(async (uri) => `sha256:hash:${uri}`),
}))
jest.mock('../managers/thumbnailer', () => ({
  generateThumbnails: jest.fn(),
}))
jest.mock('../managers/importScanner', () => ({
  triggerImportScanner: jest.fn(),
  markImportCopyStarted: jest.fn(),
  markImportCopyComplete: jest.fn(),
}))
jest.mock('./fileTypes', () => {
  const actual = jest.requireActual('./fileTypes')
  return { ...actual, getMimeType: jest.fn(actual.getMimeType) }
})

beforeEach(async () => {
  await initializeDB()
  jest.spyOn(require('../stores/fs'), 'copyFileToFs')
  jest.clearAllMocks()
})

afterEach(async () => {
  await resetDb()
  jest.restoreAllMocks()
  jest.clearAllMocks()
})

describe('importAssets — picker / camera / share intent', () => {
  describe('placeholder creation', () => {
    it('creates records with empty hash so UI shows files before copy completes', async () => {
      const assets = [
        {
          id: undefined,
          name: 'large.zip',
          size: 100_000_000,
          sourceUri: 'file:///tmp/large.zip',
          type: 'application/zip',
          timestamp: '2024-06-01',
        },
      ]

      const { files, newVersionCount } = await importAssets(assets)

      expect(files).toHaveLength(1)
      expect(newVersionCount).toBe(0)
      expect(files[0]).toMatchObject({
        name: 'large.zip',
        hash: '',
        size: 100_000_000,
        kind: 'file',
      })

      const row = await app().files.getById(files[0].id)
      expect(row).toBeTruthy()
      expect(row!.hash).toBe('')
    })

    it('returns before copy starts so the caller is not blocked by I/O', async () => {
      let releaseCopy!: () => void
      const copyBlocker = new Promise<string>((resolve) => {
        releaseCopy = () => resolve('/local/file.zip')
      })
      jest.mocked(copyFileToFs).mockReturnValueOnce(copyBlocker)

      const assets = [
        {
          id: undefined,
          name: 'big.zip',
          size: 5_000_000_000,
          sourceUri: 'file:///tmp/big.zip',
          type: 'application/zip',
          timestamp: '2024-06-01',
        },
      ]

      const { files } = await importAssets(assets)

      expect(files).toHaveLength(1)
      const row = await app().files.getById(files[0].id)
      expect(row).toBeTruthy()
      expect(row!.hash).toBe('')

      expect(copyFileToFs).toHaveBeenCalledTimes(1)

      releaseCopy()
      await new Promise((r) => setTimeout(r, 0))
    })

    it('creates multiple placeholders in a single batch insert', async () => {
      const assets = [
        {
          id: undefined,
          name: 'file1.txt',
          size: 10,
          sourceUri: 'file:///tmp/file1.txt',
          type: 'text/plain',
          timestamp: '2024-06-01',
        },
        {
          id: undefined,
          name: 'file2.txt',
          size: 20,
          sourceUri: 'file:///tmp/file2.txt',
          type: 'text/plain',
          timestamp: '2024-06-01',
        },
        {
          id: 'local-id-3',
          name: 'photo.jpg',
          size: 30,
          sourceUri: 'file:///tmp/photo.jpg',
          type: 'image/jpeg',
          timestamp: '2024-06-01',
        },
      ]

      const { files } = await importAssets(assets)
      expect(files).toHaveLength(3)

      // Manual imports never set localId — that namespace belongs to auto-sync.
      // Even if the picker hands us a localId on the asset, we drop it.
      expect(files.every((f) => f.localId === null)).toBe(true)

      await new Promise((r) => setTimeout(r, 0))

      expect(copyFileToFs).toHaveBeenCalledTimes(3)
    })

    it('skips assets without sourceUri', async () => {
      const assets = [
        {
          id: undefined,
          name: 'no-uri.zip',
          size: 500,
          sourceUri: undefined,
          type: 'application/zip',
          timestamp: '2024-06-01',
        },
      ]

      const { files } = await importAssets(assets)
      expect(files).toHaveLength(0)
      expect(copyFileToFs).not.toHaveBeenCalled()
    })
  })

  describe('manual import is independent of localId / hash', () => {
    it('regression #594: succeeds even when an existing row holds the picked localId', async () => {
      await app().files.create({
        id: 'existing-1',
        name: 'old-name.jpg',
        size: 100,
        createdAt: 1,
        updatedAt: 1,
        type: 'image/jpeg',
        kind: 'file',
        localId: 'ph://A',
        hash: 'sha256:known',
        addedAt: 1,
        trashedAt: null,
        deletedAt: null,
      })

      const { files, newVersionCount } = await importAssets([
        {
          id: 'ph://A',
          name: 'fresh-name.jpg',
          size: 100,
          sourceUri: 'file:///tmp/fresh-name.jpg',
          type: 'image/jpeg',
          timestamp: '2024-06-01',
        },
      ])

      expect(files).toHaveLength(1)
      expect(files[0].localId).toBeNull()
      expect(newVersionCount).toBe(0)

      const original = await app().files.getById('existing-1')
      expect(original!.localId).toBe('ph://A')
    })

    it('does not dedup by content hash at import — the import scanner handles that later', async () => {
      await app().files.create({
        id: 'existing-1',
        name: 'something.jpg',
        size: 100,
        createdAt: 1,
        updatedAt: 1,
        type: 'image/jpeg',
        kind: 'file',
        localId: null,
        hash: 'sha256:abc',
        addedAt: 1,
        trashedAt: null,
        deletedAt: null,
      })

      const { files, newVersionCount } = await importAssets([
        {
          id: undefined,
          name: 'else.jpg',
          size: 100,
          sourceUri: 'file:///tmp/else.jpg',
          type: 'image/jpeg',
          timestamp: '2024-06-01',
        },
      ])

      expect(files).toHaveLength(1)
      expect(newVersionCount).toBe(0)
      const all = await app().files.query({ order: 'ASC' })
      expect(all).toHaveLength(2)
    })

    it('re-importing a previously trashed photo inserts a new row; trashed row stays in trash', async () => {
      await app().files.create({
        id: 'trashed-1',
        name: 'IMG.jpg',
        size: 100,
        createdAt: 1,
        updatedAt: 1,
        type: 'image/jpeg',
        kind: 'file',
        localId: 'ph://Y',
        hash: 'sha256:trashed',
        addedAt: 1,
        trashedAt: 123,
        deletedAt: null,
      })

      const { files, newVersionCount } = await importAssets([
        {
          id: 'ph://Y',
          name: 'IMG.jpg',
          size: 100,
          sourceUri: 'file:///tmp/IMG.jpg',
          type: 'image/jpeg',
          timestamp: '2024-06-01',
        },
      ])

      expect(files).toHaveLength(1)
      expect(files[0].id).not.toBe('trashed-1')
      expect(files[0].localId).toBeNull()
      expect(newVersionCount).toBe(0)

      const trashed = await app().files.getById('trashed-1')
      expect(trashed!.trashedAt).toBe(123)
    })
  })

  describe('name collisions and version bumps', () => {
    it('bumps a new version when the picked name matches a current file in the destination directory', async () => {
      const dir = await app().directories.getOrCreateAtPath('Docs')
      await app().files.create({
        id: 'existing',
        name: 'notes.txt',
        size: 10,
        createdAt: 1,
        updatedAt: 1,
        type: 'text/plain',
        kind: 'file',
        localId: null,
        hash: 'sha256:v1',
        addedAt: 1,
        trashedAt: null,
        deletedAt: null,
      })
      await app().directories.moveFiles(['existing'], dir.id)

      const { files, newVersionCount } = await importAssets(
        [
          {
            id: undefined,
            name: 'notes.txt',
            sourceUri: 'file:///tmp/notes.txt',
            type: 'text/plain',
            timestamp: '2024-06-01',
          },
        ],
        'file',
        { destinationDirectoryId: dir.id },
      )

      expect(files).toHaveLength(1)
      expect(newVersionCount).toBe(1)

      const newRow = await db().getFirstAsync<{ current: number; directoryId: string | null }>(
        'SELECT current, directoryId FROM files WHERE id = ?',
        files[0].id,
      )
      expect(newRow?.current).toBe(1)
      expect(newRow?.directoryId).toBe(dir.id)

      const oldRow = await db().getFirstAsync<{ current: number; directoryId: string | null }>(
        'SELECT current, directoryId FROM files WHERE id = ?',
        'existing',
      )
      expect(oldRow?.current).toBe(0)
      expect(oldRow?.directoryId).toBe(dir.id)
    })

    it('same name in a different directory does NOT bump a version', async () => {
      const dir = await app().directories.getOrCreateAtPath('Docs')
      await app().files.create({
        id: 'root-notes',
        name: 'notes.txt',
        size: 10,
        createdAt: 1,
        updatedAt: 1,
        type: 'text/plain',
        kind: 'file',
        localId: null,
        hash: 'sha256:root',
        addedAt: 1,
        trashedAt: null,
        deletedAt: null,
      })

      const { files, newVersionCount } = await importAssets(
        [
          {
            id: undefined,
            name: 'notes.txt',
            sourceUri: 'file:///tmp/notes.txt',
            type: 'text/plain',
            timestamp: '2024-06-01',
          },
        ],
        'file',
        { destinationDirectoryId: dir.id },
      )

      expect(files).toHaveLength(1)
      expect(newVersionCount).toBe(0)

      const rootRow = await db().getFirstAsync<{ current: number }>(
        'SELECT current FROM files WHERE id = ?',
        'root-notes',
      )
      expect(rootRow?.current).toBe(1)
    })
  })

  describe('destination directory and tag context', () => {
    it('inserts directly into destinationDirectoryId', async () => {
      const dir = await app().directories.getOrCreateAtPath('Vacation')
      const { files } = await importAssets(
        [
          {
            id: undefined,
            name: 'beach.jpg',
            sourceUri: 'file:///tmp/beach.jpg',
            type: 'image/jpeg',
            timestamp: '2024-06-01',
          },
        ],
        'file',
        { destinationDirectoryId: dir.id },
      )
      const row = await db().getFirstAsync<{ directoryId: string | null }>(
        'SELECT directoryId FROM files WHERE id = ?',
        files[0].id,
      )
      expect(row?.directoryId).toBe(dir.id)
    })

    it('attaches assignTagName to every inserted file', async () => {
      const { files } = await importAssets(
        [
          {
            id: undefined,
            name: 'a.jpg',
            sourceUri: 'file:///tmp/a.jpg',
            type: 'image/jpeg',
            timestamp: '2024-06-01',
          },
          {
            id: undefined,
            name: 'b.jpg',
            sourceUri: 'file:///tmp/b.jpg',
            type: 'image/jpeg',
            timestamp: '2024-06-01',
          },
        ],
        'file',
        { assignTagName: 'Travel' },
      )
      expect(files).toHaveLength(2)
      for (const f of files) {
        const tags = await app().tags.getNamesForFile(f.id)
        expect(tags).toContain('Travel')
      }
    })

    it('combines destination directory and tag in a single import', async () => {
      const dir = await app().directories.getOrCreateAtPath('Trip')
      const { files } = await importAssets(
        [
          {
            id: undefined,
            name: 'sunset.jpg',
            sourceUri: 'file:///tmp/sunset.jpg',
            type: 'image/jpeg',
            timestamp: '2024-06-01',
          },
        ],
        'file',
        { destinationDirectoryId: dir.id, assignTagName: 'Travel' },
      )
      expect(files).toHaveLength(1)
      const row = await db().getFirstAsync<{ directoryId: string | null }>(
        'SELECT directoryId FROM files WHERE id = ?',
        files[0].id,
      )
      expect(row?.directoryId).toBe(dir.id)
      const tags = await app().tags.getNamesForFile(files[0].id)
      expect(tags).toContain('Travel')
    })
  })

  describe('copyPromise', () => {
    it('resolves only after every file is copied', async () => {
      const releasers: Array<() => void> = []
      jest.mocked(copyFileToFs).mockImplementation(() => {
        return new Promise<string>((resolve) => {
          releasers.push(() => resolve('/local/file'))
        })
      })

      const assets = [
        {
          id: undefined,
          name: 'a.txt',
          size: 100,
          sourceUri: 'file:///tmp/a.txt',
          type: 'text/plain',
          timestamp: '2024-06-01',
        },
        {
          id: undefined,
          name: 'b.txt',
          size: 200,
          sourceUri: 'file:///tmp/b.txt',
          type: 'text/plain',
          timestamp: '2024-06-01',
        },
      ]

      const { copyPromise } = await importAssets(assets)

      let settled = false
      copyPromise.then(() => {
        settled = true
      })

      // Both copies dispatch in parallel up to the concurrency cap.
      await new Promise((r) => setTimeout(r, 0))
      expect(settled).toBe(false)
      expect(releasers).toHaveLength(2)

      releasers[0]()
      await new Promise((r) => setTimeout(r, 0))
      expect(settled).toBe(false)

      releasers[1]()
      const result = await copyPromise
      expect(result).toEqual({ copied: 2, failed: 0 })
    })

    it('reports onCopyProgress once per file in order', async () => {
      const events: number[] = []
      const assets = [
        {
          id: undefined,
          name: 'one.bin',
          size: 11,
          sourceUri: 'file:///tmp/one.bin',
          type: 'application/octet-stream',
          timestamp: '2024-06-01',
        },
        {
          id: undefined,
          name: 'two.bin',
          size: 22,
          sourceUri: 'file:///tmp/two.bin',
          type: 'application/octet-stream',
          timestamp: '2024-06-01',
        },
        {
          id: undefined,
          name: 'three.bin',
          size: 33,
          sourceUri: 'file:///tmp/three.bin',
          type: 'application/octet-stream',
          timestamp: '2024-06-01',
        },
      ]

      const { copyPromise } = await importAssets(assets, 'file', {
        onCopyProgress: (bytes) => events.push(bytes),
      })
      await copyPromise

      expect(events).toEqual([11, 22, 33])
    })

    it('counts failures and continues past per-file errors', async () => {
      jest
        .mocked(copyFileToFs)
        .mockResolvedValueOnce('/local/ok-1')
        .mockRejectedValueOnce(new Error('disk full'))
        .mockResolvedValueOnce('/local/ok-2')

      const assets = [
        {
          id: undefined,
          name: 'ok1.txt',
          size: 1,
          sourceUri: 'file:///tmp/ok1.txt',
          type: 'text/plain',
          timestamp: '2024-06-01',
        },
        {
          id: undefined,
          name: 'bad.txt',
          size: 2,
          sourceUri: 'file:///tmp/bad.txt',
          type: 'text/plain',
          timestamp: '2024-06-01',
        },
        {
          id: undefined,
          name: 'ok2.txt',
          size: 3,
          sourceUri: 'file:///tmp/ok2.txt',
          type: 'text/plain',
          timestamp: '2024-06-01',
        },
      ]

      const events: number[] = []
      const { copyPromise } = await importAssets(assets, 'file', {
        onCopyProgress: (bytes) => events.push(bytes),
      })
      const result = await copyPromise
      expect(result).toEqual({ copied: 2, failed: 1 })
      expect(events).toEqual([1, 3])
    })

    it('registers every placeholder before createMany commits the rows', async () => {
      // insertManyFiles commits its INSERTs individually; a scanner tick
      // that lands mid-INSERT could see a row with no fs row, no localId,
      // and no in-flight marker, and flag it lost. markImportCopyStarted
      // must run before createMany so every committed row is protected
      // from the first instant it becomes visible.
      const createManySpy = jest.spyOn(app().files, 'createMany')

      const assets = [
        {
          id: undefined,
          name: 'a.txt',
          size: 1,
          sourceUri: 'file:///tmp/a.txt',
          type: 'text/plain',
          timestamp: '2024-06-01',
        },
        {
          id: undefined,
          name: 'b.txt',
          size: 2,
          sourceUri: 'file:///tmp/b.txt',
          type: 'text/plain',
          timestamp: '2024-06-01',
        },
      ]

      const { files, copyPromise } = await importAssets(assets)
      await copyPromise

      const startedIds = jest.mocked(markImportCopyStarted).mock.calls.map((c) => c[0])
      expect(startedIds).toEqual(files.map((f) => f.id))

      const createOrder = createManySpy.mock.invocationCallOrder[0]
      for (const markOrder of jest.mocked(markImportCopyStarted).mock.invocationCallOrder) {
        expect(markOrder).toBeLessThan(createOrder)
      }
    })

    it('releases marks when setup fails between createMany and copyAssets', async () => {
      // If anything between the mark and the copy dispatch throws,
      // copyAssets never runs and its per-file finally cannot release
      // the marks. importAssets must release them itself so future
      // scanner ticks can clean up the now-orphaned placeholders.
      jest.spyOn(app(), 'optimize').mockRejectedValueOnce(new Error('boom'))

      const assets = [
        {
          id: undefined,
          name: 'a.txt',
          size: 1,
          sourceUri: 'file:///tmp/a.txt',
          type: 'text/plain',
          timestamp: '2024-06-01',
        },
      ]

      await expect(importAssets(assets)).rejects.toThrow('boom')

      const startedIds = jest
        .mocked(markImportCopyStarted)
        .mock.calls.map((c) => c[0])
        .sort()
      const completedIds = jest
        .mocked(markImportCopyComplete)
        .mock.calls.map((c) => c[0])
        .sort()
      expect(startedIds.length).toBe(1)
      expect(completedIds).toEqual(startedIds)
    })

    it('clears each registration as its copy resolves (success and failure both unregister)', async () => {
      jest
        .mocked(copyFileToFs)
        .mockResolvedValueOnce('/local/ok')
        .mockRejectedValueOnce(new Error('disk full'))

      const assets = [
        {
          id: undefined,
          name: 'ok.txt',
          size: 1,
          sourceUri: 'file:///tmp/ok.txt',
          type: 'text/plain',
          timestamp: '2024-06-01',
        },
        {
          id: undefined,
          name: 'bad.txt',
          size: 2,
          sourceUri: 'file:///tmp/bad.txt',
          type: 'text/plain',
          timestamp: '2024-06-01',
        },
      ]

      const { files, copyPromise } = await importAssets(assets)
      await copyPromise

      const startedIds = jest
        .mocked(markImportCopyStarted)
        .mock.calls.map((c) => c[0])
        .sort()
      const completedIds = jest
        .mocked(markImportCopyComplete)
        .mock.calls.map((c) => c[0])
        .sort()
      const expectedIds = files.map((f) => f.id).sort()

      expect(startedIds).toEqual(expectedIds)
      expect(completedIds).toEqual(expectedIds)
    })

    it('reports totalBytes as the sum of placeholder sizes', async () => {
      const { totalBytes } = await importAssets([
        {
          id: undefined,
          name: 'a',
          size: 10,
          sourceUri: 'file:///tmp/a',
          type: 'text/plain',
          timestamp: '2024-06-01',
        },
        {
          id: undefined,
          name: 'b',
          size: 25,
          sourceUri: 'file:///tmp/b',
          type: 'text/plain',
          timestamp: '2024-06-01',
        },
      ])
      expect(totalBytes).toBe(35)
    })
  })

  describe('bounded concurrency', () => {
    const MB = 1024 * 1024

    function makeAssets(count: number, sizeBytes: number) {
      return Array.from({ length: count }, (_, i) => ({
        id: undefined as string | undefined,
        name: `f${i}.bin`,
        size: sizeBytes,
        sourceUri: `file:///tmp/f${i}.bin`,
        type: 'application/octet-stream',
        timestamp: '2024-06-01',
      }))
    }

    /**
     * Stubs `copyFileToFs` with deferred promises, tracks peak
     * concurrency, and drains pending copies in waves. Each invocation
     * parks on a promise resolved by the next `releaseNext()` call.
     */
    function deferredCopyStub() {
      const pending: Array<() => void> = []
      let inFlight = 0
      let peakInFlight = 0
      jest.mocked(copyFileToFs).mockImplementation(() => {
        inFlight++
        if (inFlight > peakInFlight) peakInFlight = inFlight
        return new Promise<string>((resolve) => {
          pending.push(() => {
            inFlight--
            resolve('/local/x')
          })
        })
      })
      return {
        pending,
        peak: () => peakInFlight,
        async drain() {
          // Release whatever is currently pending and yield so the
          // dispatcher can fill in the next wave. Repeat until empty.
          while (pending.length > 0) {
            const wave = pending.splice(0)
            for (const r of wave) r()
            await new Promise((r) => setTimeout(r, 0))
          }
        },
      }
    }

    it('caps concurrent copies at 4 even with a large queue', async () => {
      const stub = deferredCopyStub()
      const { copyPromise } = await importAssets(makeAssets(10, 1 * MB))

      // Drain microtasks so the dispatcher fills up to its cap.
      await new Promise((r) => setTimeout(r, 0))
      expect(copyFileToFs).toHaveBeenCalledTimes(4)
      expect(stub.peak()).toBe(4)

      await stub.drain()
      await copyPromise
      // Final peak across the whole run is still bounded by the cap.
      expect(stub.peak()).toBe(4)
      expect(copyFileToFs).toHaveBeenCalledTimes(10)
    })

    it('blocks new dispatch when adding the next file would exceed the byte budget', async () => {
      // Each 6 MB; budget is 16 MB. The first file dispatches regardless
      // (deadlock guard). The second adds to 12 MB. A third would push to
      // 18 MB > 16 MB, so the dispatcher must wait. Peak in flight = 2.
      const stub = deferredCopyStub()
      const { copyPromise } = await importAssets(makeAssets(5, 6 * MB))

      await new Promise((r) => setTimeout(r, 0))
      expect(stub.peak()).toBe(2)
      expect(copyFileToFs).toHaveBeenCalledTimes(2)

      await stub.drain()
      await copyPromise
      expect(stub.peak()).toBe(2)
      expect(copyFileToFs).toHaveBeenCalledTimes(5)
    })

    it('runs a single oversized file alone without deadlocking', async () => {
      // 50 MB > 16 MB budget; the "first file regardless of size" carve-out
      // must let it run alone, otherwise it'd never start.
      const stub = deferredCopyStub()
      const { copyPromise } = await importAssets(makeAssets(1, 50 * MB))

      await new Promise((r) => setTimeout(r, 0))
      expect(copyFileToFs).toHaveBeenCalledTimes(1)
      expect(stub.peak()).toBe(1)

      await stub.drain()
      await copyPromise
    })
  })

  describe('background copy', () => {
    it('fires a background copy to capture ephemeral source URIs', async () => {
      const assets = [
        {
          id: undefined,
          name: 'doc.pdf',
          size: 500,
          sourceUri: 'file:///tmp/doc.pdf',
          type: 'application/pdf',
          timestamp: '2024-06-01',
        },
      ]

      const { files } = await importAssets(assets)

      await new Promise((r) => setTimeout(r, 0))

      expect(copyFileToFs).toHaveBeenCalledTimes(1)
      expect(copyFileToFs).toHaveBeenCalledWith(
        expect.objectContaining({ id: files[0].id }),
        'file:///tmp/doc.pdf',
      )
    })
  })

  describe('scanner integration', () => {
    it('triggers the import scanner once the copy loop finishes', async () => {
      const { triggerImportScanner } = require('../managers/importScanner')
      const assets = [
        {
          id: undefined,
          name: 'file.txt',
          size: 10,
          sourceUri: 'file:///tmp/file.txt',
          type: 'text/plain',
          timestamp: '2024-06-01',
        },
      ]

      const { copyPromise } = await importAssets(assets)
      await copyPromise
      expect(triggerImportScanner).toHaveBeenCalled()
    })
  })
})

describe('syncAssets — eager background sync for recent photos', () => {
  describe('dedup', () => {
    it('skips files already tracked by localId', async () => {
      await app().files.create({
        id: 'existing-1',
        name: 'old.jpg',
        size: 5,
        createdAt: 1,
        updatedAt: 1,
        type: 'image/jpeg',
        kind: 'file',
        localId: '1',
        hash: '',
        addedAt: 1,
        trashedAt: null,
        deletedAt: null,
      })

      jest.mocked(getMediaLibraryUri).mockImplementation(async (localId) => {
        if (localId === '1') return { status: 'resolved', uri: 'file://1' }
        return { status: 'deleted' }
      })
      const assets = [
        {
          id: '1',
          name: 'new.jpg',
          sourceUri: 'file://1',
          type: 'image/jpeg',
          timestamp: '2021-01-01',
        },
      ]
      const { files, updatedFiles } = await syncAssets(assets)

      expect(updatedFiles).toHaveLength(1)
      expect(files).toHaveLength(0)
      expect(calculateContentHash).not.toHaveBeenCalled()
      const updated = await app().files.getById('existing-1')
      expect(updated).toMatchObject({
        id: 'existing-1',
        name: 'new.jpg',
        size: 5,
      })
      expect(copyFileToFs).toHaveBeenCalledTimes(0)
    })

    it('blocks content-hash duplicates from another device', async () => {
      await app().files.create({
        id: 'existing',
        name: 'existing.jpg',
        size: 10,
        createdAt: 1,
        updatedAt: 1,
        type: 'image/jpeg',
        kind: 'file',
        hash: 'sha256:existing-hash',
        localId: null,
        addedAt: 1,
        trashedAt: null,
        deletedAt: null,
      })

      jest.mocked(calculateContentHash).mockImplementation(async () => 'sha256:existing-hash')
      const assets = [
        {
          id: 'same-hash',
          name: 'same-hash.jpg',
          sourceUri: 'file://same-hash.jpg',
          type: 'image/jpeg',
          timestamp: '2021-01-01',
        },
      ]
      const { files, updatedFiles } = await syncAssets(assets)

      expect(files).toHaveLength(0)
      expect(updatedFiles).toHaveLength(1)
      expect(updatedFiles[0]).toMatchObject({ id: 'existing' })
    })

    it('allows same-hash files within a single batch', async () => {
      jest.mocked(getMediaLibraryUri).mockImplementation(async () => {
        return { status: 'deleted' }
      })
      jest.mocked(calculateContentHash).mockImplementation(async () => 'sha256:same-for-all')
      const assets = [
        {
          id: undefined,
          name: '1.jpg',
          size: 123,
          sourceUri: 'file://1.jpg',
          type: 'image/jpeg',
          timestamp: '2021-01-01',
        },
        {
          id: undefined,
          name: '2.jpg',
          size: 123,
          sourceUri: 'file://2.jpg',
          type: 'image/png',
          timestamp: '2021-01-01',
        },
      ]

      const { files } = await syncAssets(assets)
      expect(files).toHaveLength(2)
    })
  })

  describe('file processing', () => {
    it('creates finalized record with hash and size', async () => {
      const assets = [
        {
          id: '1',
          name: 'a.jpg',
          sourceUri: 'file://1',
          type: 'image/jpeg',
          timestamp: '2021-01-01',
        },
      ]

      const { files } = await syncAssets(assets)
      expect(files).toHaveLength(1)
      const rows = await app().files.query({ order: 'ASC' })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        id: files[0].id,
        name: 'a.jpg',
      })
      const meta = await app().fs.readMeta(files[0].id)
      expect(meta).toMatchObject({
        fileId: files[0].id,
      })
    })

    it('prefers full-quality media library URI over sourceUri', async () => {
      jest.mocked(getMediaLibraryUri).mockImplementation(async () => {
        return { status: 'resolved', uri: 'file:///full-quality.jpg' }
      })
      const assets = [
        {
          id: 'valid',
          name: 'no-id.jpg',
          size: 123,
          sourceUri: 'file:///tmp/no-id.jpg',
          type: 'image/jpeg',
          timestamp: '2021-01-01',
        },
      ]

      const { files } = await syncAssets(assets)

      expect(files).toHaveLength(1)
      expect(getMediaLibraryUri).toHaveBeenCalledTimes(1)
      expect(getMediaLibraryUri).toHaveBeenCalledWith('valid')

      expect(copyFileToFs).toHaveBeenCalledTimes(1)
      expect(copyFileToFs).toHaveBeenCalledWith(
        expect.objectContaining({ id: files[0].id, type: 'image/jpeg' }),
        'file:///full-quality.jpg',
      )
    })

    it('falls back to sourceUri when media library URI is unavailable', async () => {
      jest.mocked(getMediaLibraryUri).mockImplementation(async () => {
        return { status: 'deleted' }
      })
      const assets = [
        {
          id: 'invalid',
          name: 'file.jpg',
          sourceUri: 'file:///source.jpg',
          type: 'image/jpeg',
          timestamp: '2021-01-01',
        },
      ]

      const { files } = await syncAssets(assets)

      expect(files).toHaveLength(1)
      expect(getMediaLibraryUri).toHaveBeenCalledTimes(1)
      expect(getMediaLibraryUri).toHaveBeenCalledWith('invalid')
      expect(copyFileToFs).toHaveBeenCalledTimes(1)
      const file = await app().files.getById(files[0].id)
      expect(file).toMatchObject({
        id: files[0].id,
      })
      const meta = await app().fs.readMeta(files[0].id)
      expect(meta).toMatchObject({
        fileId: files[0].id,
      })
    })

    it('retries MIME detection from local file when initial returns octet-stream', async () => {
      jest.mocked(getMediaLibraryUri).mockImplementation(async () => {
        return { status: 'resolved', uri: 'file:///local/photo' }
      })
      jest
        .mocked(getMimeType)
        .mockResolvedValueOnce('application/octet-stream')
        .mockResolvedValueOnce('image/jpeg')

      const assets = [
        {
          id: '1',
          name: 'data',
          sourceUri: 'ph://asset-123',
          type: undefined,
          timestamp: '2021-01-01',
        },
      ]

      const { files } = await syncAssets(assets)
      expect(files).toHaveLength(1)
      expect(files[0].type).toBe('image/jpeg')
      expect(getMimeType).toHaveBeenCalledTimes(2)
      expect(getMimeType).toHaveBeenNthCalledWith(1, {
        type: undefined,
        name: 'data',
        uri: 'ph://asset-123',
      })
      expect(getMimeType).toHaveBeenNthCalledWith(2, {
        name: 'data',
        uri: 'file:///local/photo',
      })
    })

    it('captures file size from the copied file', async () => {
      const { rnfsStat } = (global as unknown as { __rnfs: { rnfsStat: jest.Mock } }).__rnfs
      rnfsStat.mockResolvedValue({ size: 333 })
      const assets = [
        {
          id: undefined,
          name: 'no-id.jpg',
          size: undefined,
          sourceUri: 'file:///tmp/no-id.jpg',
          type: 'image/jpeg',
          timestamp: '2021-01-01',
        },
      ]
      const { files } = await syncAssets(assets)
      expect(files).toHaveLength(1)
      expect(files[0].size).toBe(333)
    })
  })

  describe('existing records', () => {
    it('updates existing records with new metadata by default', async () => {
      await app().files.create({
        id: 'existing-1',
        name: 'old.jpg',
        size: 5,
        createdAt: 1,
        updatedAt: 1,
        type: 'image/jpeg',
        kind: 'file',
        localId: '1',
        hash: '',
        addedAt: 1,
        trashedAt: null,
        deletedAt: null,
      })

      jest.mocked(getMediaLibraryUri).mockImplementation(async (localId) => {
        if (localId === '1') return { status: 'resolved', uri: 'file://1' }
        return { status: 'deleted' }
      })
      const assets = [
        {
          id: '1',
          name: 'new.jpg',
          sourceUri: 'file://1',
          type: 'image/jpeg',
          timestamp: '2021-01-01',
        },
      ]
      const { updatedFiles } = await syncAssets(assets)

      expect(updatedFiles).toHaveLength(1)
      const updated = await app().files.getById('existing-1')
      expect(updated).toMatchObject({
        id: 'existing-1',
        name: 'new.jpg',
      })
    })

    it('skipExistingUpdates prevents spurious updatedAt bumps', async () => {
      await app().files.create({
        id: 'existing-1',
        name: 'old.jpg',
        size: 5,
        createdAt: 1,
        updatedAt: 1,
        type: 'image/jpeg',
        kind: 'file',
        localId: '1',
        hash: '',
        addedAt: 1,
        trashedAt: null,
        deletedAt: null,
      })

      jest.mocked(getMediaLibraryUri).mockImplementation(async (localId) => {
        if (localId === '1') return { status: 'resolved', uri: 'file://1' }
        return { status: 'deleted' }
      })
      const assets = [
        {
          id: '1',
          name: 'new.jpg',
          sourceUri: 'file://1',
          type: 'image/jpeg',
          timestamp: '2021-01-01',
        },
      ]
      const { files, updatedFiles } = await syncAssets(assets, 'file', {
        skipExistingUpdates: true,
      })

      expect(updatedFiles).toHaveLength(1)
      expect(files).toHaveLength(0)
      const record = await app().files.getById('existing-1')
      expect(record).toMatchObject({
        id: 'existing-1',
        name: 'old.jpg',
        updatedAt: 1,
      })
    })
  })

  describe('import directory', () => {
    it('does not move files by default', async () => {
      await app().settings.setPhotoImportDirectory('Camera Roll')
      const assets = [
        {
          id: undefined,
          name: 'photo.jpg',
          sourceUri: 'file:///photo.jpg',
          type: 'image/jpeg',
          timestamp: '2021-01-01',
        },
      ]
      const { files } = await syncAssets(assets)
      expect(files).toHaveLength(1)
      const row = await db().getFirstAsync<{ directoryId: string | null }>(
        'SELECT directoryId FROM files WHERE id = ?',
        files[0].id,
      )
      expect(row?.directoryId).toBeNull()
      const dirs = await app().directories.getAll()
      expect(dirs).toHaveLength(0)
    })

    it('moves media files when addToImportDirectory is set', async () => {
      await app().settings.setPhotoImportDirectory('Camera Roll')
      const assets = [
        {
          id: undefined,
          name: 'photo.jpg',
          sourceUri: 'file:///photo.jpg',
          type: 'image/jpeg',
          timestamp: '2021-01-01',
        },
      ]
      const { files } = await syncAssets(assets, 'file', {
        addToImportDirectory: true,
      })
      expect(files).toHaveLength(1)
      const row = await db().getFirstAsync<{ directoryId: string | null }>(
        'SELECT directoryId FROM files WHERE id = ?',
        files[0].id,
      )
      expect(row?.directoryId).toBeTruthy()
      const dirs = await app().directories.getAll()
      expect(dirs).toHaveLength(1)
      expect(dirs[0].path).toBe('Camera Roll')
    })

    it('files non-media types into the import directory too', async () => {
      await app().settings.setPhotoImportDirectory('Camera Roll')
      const assets = [
        {
          id: undefined,
          name: 'note.txt',
          sourceUri: 'file:///note.txt',
          type: 'text/plain',
          timestamp: '2021-01-01',
        },
      ]
      const { files } = await syncAssets(assets, 'file', {
        addToImportDirectory: true,
      })
      expect(files).toHaveLength(1)
      const row = await db().getFirstAsync<{ directoryId: string | null }>(
        'SELECT directoryId FROM files WHERE id = ?',
        files[0].id,
      )
      const dirs = await app().directories.getAll()
      expect(row?.directoryId).toBe(dirs[0].id)
    })

    it('places files into a nested import directory path with separators', async () => {
      await app().settings.setPhotoImportDirectory('Media/iOS Sync')
      const assets = [
        {
          id: undefined,
          name: 'photo.jpg',
          sourceUri: 'file:///photo.jpg',
          type: 'image/jpeg',
          timestamp: '2021-01-01',
        },
      ]
      const { files } = await syncAssets(assets, 'file', {
        addToImportDirectory: true,
      })
      expect(files).toHaveLength(1)
      const dirs = await app().directories.getAll()
      const paths = dirs.map((d) => d.path).sort()
      expect(paths).toEqual(['Media', 'Media/iOS Sync'])
      const leaf = dirs.find((d) => d.path === 'Media/iOS Sync')!
      const row = await db().getFirstAsync<{ directoryId: string | null }>(
        'SELECT directoryId FROM files WHERE id = ?',
        files[0].id,
      )
      expect(row?.directoryId).toBe(leaf.id)
    })
  })
})

describe('catalogAssets — deferred bulk catalog for archive sync', () => {
  it('creates placeholders with empty hash and zero size', async () => {
    const assets = [
      {
        id: 'local-1',
        name: 'photo.jpg',
        sourceUri: 'file:///photo.jpg',
        type: 'image/jpeg',
        timestamp: '2021-01-01',
      },
    ]
    const { newCount, existingCount } = await catalogAssets(assets)
    expect(newCount).toBe(1)
    expect(existingCount).toBe(0)
    const rows = await app().files.query({ order: 'ASC' })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      hash: '',
      size: 0,
      kind: 'file',
    })
  })

  it('silently skips localId duplicates via INSERT OR IGNORE', async () => {
    await app().files.create({
      id: 'existing-1',
      name: 'old.jpg',
      size: 5,
      createdAt: 1,
      updatedAt: 1,
      type: 'image/jpeg',
      kind: 'file',
      localId: 'local-1',
      hash: '',
      addedAt: 1,
      trashedAt: null,
      deletedAt: null,
    })

    const assets = [
      {
        id: 'local-1',
        name: 'same.jpg',
        sourceUri: 'file:///same.jpg',
        type: 'image/jpeg',
        timestamp: '2021-01-01',
      },
    ]
    const { newCount, existingCount } = await catalogAssets(assets)
    expect(newCount).toBe(0)
    expect(existingCount).toBe(1)

    const rows = await app().files.query({ order: 'ASC' })
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('existing-1')
  })

  it('does not copy files or compute content hashes', async () => {
    const assets = [
      {
        id: 'local-1',
        name: 'photo.jpg',
        sourceUri: 'file:///photo.jpg',
        type: 'image/jpeg',
        timestamp: '2021-01-01',
      },
    ]
    await catalogAssets(assets)
    expect(copyFileToFs).not.toHaveBeenCalled()
    expect(calculateContentHash).not.toHaveBeenCalled()
  })

  it('triggers the import scanner', async () => {
    const { triggerImportScanner } = require('../managers/importScanner')
    const assets = [
      {
        id: 'local-1',
        name: 'photo.jpg',
        sourceUri: 'file:///photo.jpg',
        type: 'image/jpeg',
        timestamp: '2021-01-01',
      },
    ]
    await catalogAssets(assets)
    expect(triggerImportScanner).toHaveBeenCalled()
  })

  it('moves media files when addToImportDirectory is set', async () => {
    await app().settings.setPhotoImportDirectory('Camera Roll')
    const assets = [
      {
        id: 'local-1',
        name: 'photo.jpg',
        sourceUri: 'file:///photo.jpg',
        type: 'image/jpeg',
        timestamp: '2021-01-01',
      },
    ]
    const { newCount } = await catalogAssets(assets, 'file', {
      addToImportDirectory: true,
    })
    expect(newCount).toBe(1)
    const rows = await app().files.query({ order: 'ASC' })
    expect(rows).toHaveLength(1)
    const row = await db().getFirstAsync<{ directoryId: string | null }>(
      'SELECT directoryId FROM files WHERE id = ?',
      rows[0].id,
    )
    expect(row?.directoryId).toBeTruthy()
    const dirs = await app().directories.getAll()
    expect(dirs).toHaveLength(1)
    expect(dirs[0].path).toBe('Camera Roll')
  })

  it('files non-media types into the import directory too', async () => {
    await app().settings.setPhotoImportDirectory('Camera Roll')
    const assets = [
      {
        id: 'local-1',
        name: 'note.txt',
        sourceUri: 'file:///note.txt',
        type: 'text/plain',
        timestamp: '2021-01-01',
      },
    ]
    await catalogAssets(assets, 'file', { addToImportDirectory: true })
    const rows = await app().files.query({ order: 'ASC' })
    expect(rows).toHaveLength(1)
    const row = await db().getFirstAsync<{ directoryId: string | null }>(
      'SELECT directoryId FROM files WHERE id = ?',
      rows[0].id,
    )
    const dirs = await app().directories.getAll()
    expect(row?.directoryId).toBe(dirs[0].id)
  })

  describe('dedup against synced-down rows (localId=NULL)', () => {
    async function setupImportDir() {
      await app().settings.setPhotoImportDirectory('Camera Roll')
      const dir = await app().directories.getOrCreateAtPath('Camera Roll')
      return dir.id
    }

    async function seedInDir(
      dirId: string,
      fields: {
        id: string
        name: string
        createdAt: number
        localId: string | null
        trashedAt?: number | null
      },
    ) {
      await app().files.create({
        id: fields.id,
        name: fields.name,
        size: 0,
        createdAt: fields.createdAt,
        updatedAt: fields.createdAt,
        type: 'image/jpeg',
        kind: 'file',
        localId: fields.localId,
        hash: '',
        addedAt: fields.createdAt,
        trashedAt: fields.trashedAt ?? null,
        deletedAt: null,
      })
      await app().directories.moveFiles([fields.id], dirId)
    }

    function asset(name: string, createdAt: number, id?: string) {
      return {
        id,
        name,
        sourceUri: `file:///${name}`,
        type: 'image/jpeg',
        timestamp: new Date(createdAt).toISOString(),
      }
    }

    it('dedups a candidate that matches a synced-down row by (name, createdAt)', async () => {
      const dirId = await setupImportDir()
      await seedInDir(dirId, {
        id: 'synced-down',
        name: 'IMG_0042.HEIC',
        createdAt: 1_710_000_000_000,
        localId: null,
      })
      const { newCount, existingCount } = await catalogAssets(
        [asset('IMG_0042.HEIC', 1_710_000_000_000, 'L_new')],
        'file',
        { addToImportDirectory: true },
      )
      expect(newCount).toBe(0)
      expect(existingCount).toBe(1)
      const rows = await app().files.query({ order: 'ASC' })
      expect(rows.map((r) => r.id)).toEqual(['synced-down'])
    })

    // Asymmetric rule: when the existing row already has a localId, the
    // new dedup doesn't fire. Same-device siblings sharing (name, time)
    // — e.g., OEM camera bursts that reuse filenames at second precision
    // — insert as distinct rows. (Same-name files in the same folder
    // still collapse to a single visible row downstream; not changed by
    // this dedup.)
    it('does not block same-device siblings when the existing row has a localId', async () => {
      const dirId = await setupImportDir()
      await seedInDir(dirId, {
        id: 'sibling-1',
        name: '20240115_142345.jpg',
        createdAt: 1_710_000_000_000,
        localId: 'local_1',
      })
      const siblings = Array.from({ length: 4 }, (_, i) =>
        asset('20240115_142345.jpg', 1_710_000_000_000, `local_${i + 2}`),
      )
      const { newCount } = await catalogAssets(siblings, 'file', { addToImportDirectory: true })
      expect(newCount).toBe(4)
      const rows = await app().files.query({ order: 'ASC', includeOldVersions: true })
      expect(rows.map((r) => r.localId).sort()).toEqual([
        'local_1',
        'local_2',
        'local_3',
        'local_4',
        'local_5',
      ])
    })

    // Same captureTime, different filenames (e.g. an iPhone Live Photo's
    // .HEIC + .MOV pair): both import — name disambiguates.
    it('imports both when names differ at the same captureTime', async () => {
      await setupImportDir()
      const ts = 1_710_000_000_000
      const { newCount } = await catalogAssets(
        [asset('IMG_0042.HEIC', ts, 'still'), asset('IMG_0042.MOV', ts, 'motion')],
        'file',
        { addToImportDirectory: true },
      )
      expect(newCount).toBe(2)
    })

    // Same name, different captureTime (AirDrop name clash, iPhone
    // counter wraparound): import proceeds — createdAt disambiguates.
    it('imports as distinct when name matches but createdAt differs', async () => {
      const dirId = await setupImportDir()
      await seedInDir(dirId, {
        id: 'mine',
        name: 'IMG_0042.HEIC',
        createdAt: 1_700_000_000_000,
        localId: 'mine_localId',
      })
      const { newCount } = await catalogAssets(
        [asset('IMG_0042.HEIC', 1_710_000_000_000, 'other_localId')],
        'file',
        { addToImportDirectory: true },
      )
      expect(newCount).toBe(1)
    })

    it('does not block re-import when the matching synced-down row is trashed', async () => {
      const dirId = await setupImportDir()
      await seedInDir(dirId, {
        id: 'synced-down-trashed',
        name: 'IMG_0042.HEIC',
        createdAt: 1_710_000_000_000,
        localId: null,
        trashedAt: 1_710_000_500_000,
      })
      const { newCount } = await catalogAssets(
        [asset('IMG_0042.HEIC', 1_710_000_000_000, 'L_new')],
        'file',
        { addToImportDirectory: true },
      )
      expect(newCount).toBe(1)
    })

    it('does not match synced-down rows in a different directory', async () => {
      await setupImportDir()
      const otherDir = await app().directories.getOrCreateAtPath('Trip 2024')
      await seedInDir(otherDir.id, {
        id: 'in-other-dir',
        name: 'IMG_0042.HEIC',
        createdAt: 1_710_000_000_000,
        localId: null,
      })
      const { newCount } = await catalogAssets(
        [asset('IMG_0042.HEIC', 1_710_000_000_000, 'L_new')],
        'file',
        { addToImportDirectory: true },
      )
      expect(newCount).toBe(1)
    })

    // Documents a known limitation: when both rows carry non-null
    // localIds (e.g. Android factory reset rotated the MediaStore id),
    // the asymmetric rule doesn't fire and a duplicate row inserts.
    // Hashes are computed at scanner finalize but aren't used for
    // dedup today — a future hash-dedup pass there could recover this.
    it('inserts a duplicate when both rows have non-null but rotated localIds', async () => {
      const dirId = await setupImportDir()
      await seedInDir(dirId, {
        id: 'pre-rotation',
        name: '20240115_142345.jpg',
        createdAt: 1_710_000_000_000,
        localId: 'old_id',
      })
      const { newCount } = await catalogAssets(
        [asset('20240115_142345.jpg', 1_710_000_000_000, 'new_id')],
        'file',
        { addToImportDirectory: true },
      )
      expect(newCount).toBe(1)
      const rows = await app().files.query({ order: 'ASC', includeOldVersions: true })
      expect(rows).toHaveLength(2)
    })
  })
})

import { ImportScanner, type ResolveLocalIdResult } from './importScanner'

type MockHelper = {
  app: any
  fileRecords: Map<string, any>
  fsFiles: Map<string, string>
  fsMeta: Map<string, any>
  caches: any
  addFile: (id: string, overrides?: any) => void
  addLocalFile: (fileId: string, uri: string) => void
}

function createMockApp(): MockHelper {
  const fileRecords = new Map<string, any>()
  const fsFiles = new Map<string, string>()
  const fsMeta = new Map<string, any>()

  const caches = {
    library: { invalidateAll: jest.fn() },
    libraryVersion: { invalidate: jest.fn() },
    fileById: { invalidate: jest.fn() },
  }

  const app: any = {
    files: {
      query: jest.fn(async (opts: any) => {
        const excludeSet = new Set(opts.excludeIds ?? [])
        const results: any[] = []
        for (const [, file] of fileRecords) {
          if (excludeSet.has(file.id)) continue
          if (!opts.includeTrashed && file.trashedAt) continue
          if (!opts.includeDeleted && file.deletedAt) continue
          if (opts.hashEmpty && file.hash !== '') continue
          if (opts.fileExistsLocally === true && !fsFiles.has(file.id)) continue
          if (opts.fileExistsLocally === false && fsFiles.has(file.id)) continue
          results.push({ ...file, objects: {} })
        }
        results.sort((a: any, b: any) =>
          opts.order === 'DESC' ? b.addedAt - a.addedAt : a.addedAt - b.addedAt,
        )
        if (opts.limit) return results.slice(0, opts.limit)
        return results
      }),
      updateMany: jest.fn(async (updates: any[]) => {
        for (const u of updates) {
          const existing = fileRecords.get(u.id)
          if (existing) {
            fileRecords.set(u.id, { ...existing, ...u, updatedAt: Date.now() })
          }
        }
      }),
    },
    fs: {
      getFileUri: jest.fn(async (file: any) => fsFiles.get(file.id) ?? null),
      copyFile: jest.fn(async (file: any, _sourceUri: string) => {
        const uri = `/local/${file.id}.${file.type.split('/')[1]}`
        fsFiles.set(file.id, uri)
        fsMeta.set(file.id, {
          fileId: file.id,
          size: 1234,
          addedAt: Date.now(),
          usedAt: Date.now(),
        })
        return uri
      }),
      readMeta: jest.fn(async (fileId: string) => fsMeta.get(fileId) ?? null),
    },
    caches,
  }

  return {
    app,
    fileRecords,
    fsFiles,
    fsMeta,
    caches,
    addFile: (id: string, overrides: any = {}) => {
      fileRecords.set(id, {
        id,
        name: `${id}.jpg`,
        type: 'image/jpeg',
        kind: 'file',
        size: 0,
        hash: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        addedAt: Date.now(),
        localId: null,
        trashedAt: null,
        deletedAt: null,
        lostReason: null,
        ...overrides,
      })
    },
    addLocalFile: (fileId: string, uri: string) => {
      fsFiles.set(fileId, uri)
      fsMeta.set(fileId, {
        fileId,
        size: 1234,
        addedAt: Date.now(),
        usedAt: Date.now(),
      })
    },
  }
}

describe('ImportScanner', () => {
  let scanner: ImportScanner
  let mock: MockHelper
  const mockHash: jest.Mock<Promise<string | null>, [string]> = jest.fn(
    async (uri: string) => `sha256:hash-of-${uri}`,
  )
  const mockMimeType = jest.fn(async () => 'image/jpeg')

  beforeEach(() => {
    jest.useFakeTimers()
    scanner = new ImportScanner()
    mock = createMockApp()
    scanner.initialize(mock.app, mockHash, mockMimeType)
    jest.clearAllMocks()
  })

  afterEach(() => {
    scanner.reset()
    jest.useRealTimers()
  })

  describe('initialization', () => {
    it('starts uninitialized', () => {
      const s = new ImportScanner()
      expect(s.isInitialized()).toBe(false)
    })

    it('is initialized after initialize()', () => {
      expect(scanner.isInitialized()).toBe(true)
    })

    it('throws when running scan without initialization', async () => {
      const s = new ImportScanner()
      await expect(s.runScan()).rejects.toThrow('not initialized')
    })
  })

  describe('phase 1: requires hash (local file exists)', () => {
    it('hashes local file and updates record', async () => {
      mock.addFile('f1')
      mock.addLocalFile('f1', '/local/f1.jpg')

      const result = await scanner.runScan()

      expect(result.finalized).toBe(1)
      expect(result.failed).toBe(0)
      expect(result.lost).toBe(0)
      expect(mock.app.files.updateMany).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'f1',
          hash: 'sha256:hash-of-/local/f1.jpg',
        }),
      ])
    })

    it('processes local files regardless of maxDeferred=0', async () => {
      mock.addFile('f1')
      mock.addLocalFile('f1', '/local/f1.jpg')

      const result = await scanner.runScan(undefined, undefined, 0)

      expect(result.finalized).toBe(1)
    })

    it('queries with fileExistsLocally: true for phase 1', async () => {
      await scanner.runScan()

      expect(mock.app.files.query).toHaveBeenCalledWith(
        expect.objectContaining({
          hashEmpty: true,
          fileExistsLocally: true,
          includeThumbnails: true,
          includeOldVersions: true,
        }),
      )
    })
  })

  describe('phase 2: requires copy and hash (photo library placeholder)', () => {
    it('resolves localId and copies', async () => {
      mock.addFile('f4', { localId: 'ph://asset-123' })
      const resolveLocalId = jest.fn(
        async (): Promise<ResolveLocalIdResult> => ({
          status: 'resolved',
          uri: 'file:///photo.jpg',
        }),
      )

      const result = await scanner.runScan(undefined, resolveLocalId)

      expect(result.finalized).toBe(1)
      expect(resolveLocalId).toHaveBeenCalledWith('ph://asset-123')
      expect(mock.app.fs.copyFile).toHaveBeenCalledWith(
        { id: 'f4', type: 'image/jpeg' },
        'file:///photo.jpg',
      )
    })

    it('limits deferred candidates to maxDeferred', async () => {
      mock.addFile('f1', { localId: 'ph://1', addedAt: 3000 })
      mock.addFile('f2', { localId: 'ph://2', addedAt: 2000 })
      mock.addFile('f3', { localId: 'ph://3', addedAt: 1000 })
      const resolveLocalId = jest.fn(
        async (): Promise<ResolveLocalIdResult> => ({
          status: 'resolved',
          uri: 'file:///photo.jpg',
        }),
      )

      const result = await scanner.runScan(undefined, resolveLocalId, 1)

      expect(result.finalized).toBe(1)
      expect(resolveLocalId).toHaveBeenCalledTimes(1)
    })

    it('skips phase 2 entirely when maxDeferred=0', async () => {
      mock.addFile('f1', { localId: 'ph://1' })
      const resolveLocalId = jest.fn(
        async (): Promise<ResolveLocalIdResult> => ({
          status: 'resolved',
          uri: 'file:///photo.jpg',
        }),
      )

      const result = await scanner.runScan(undefined, resolveLocalId, 0)

      expect(result.finalized).toBe(0)
      expect(resolveLocalId).not.toHaveBeenCalled()
      // Only phase 1 query runs
      expect(mock.app.files.query).toHaveBeenCalledTimes(1)
      expect(mock.app.files.query).toHaveBeenCalledWith(
        expect.objectContaining({ fileExistsLocally: true }),
      )
    })

    it('queries with fileExistsLocally: false for phase 2', async () => {
      mock.addFile('f1', { localId: 'ph://1' })
      const resolveLocalId = jest.fn(
        async (): Promise<ResolveLocalIdResult> => ({
          status: 'resolved',
          uri: 'file:///photo.jpg',
        }),
      )

      await scanner.runScan(undefined, resolveLocalId)

      expect(mock.app.files.query).toHaveBeenCalledWith(
        expect.objectContaining({
          hashEmpty: true,
          fileExistsLocally: false,
          includeThumbnails: true,
          includeOldVersions: true,
        }),
      )
    })

    it('skips files with localId when no resolver is provided', async () => {
      mock.addFile('f1', { localId: 'ph://1' })

      const result = await scanner.runScan()

      expect(result.skipped).toBe(1)
      expect(result.lost).toBe(0)
    })
  })

  describe('lostReason marking', () => {
    it('marks file lost when localId does not resolve', async () => {
      mock.addFile('f5', { localId: 'ph://deleted-asset' })
      const resolveLocalId = jest.fn(
        async (): Promise<ResolveLocalIdResult> => ({ status: 'deleted' }),
      )

      const result = await scanner.runScan(undefined, resolveLocalId)

      expect(result.lost).toBe(1)
      expect(mock.app.files.updateMany).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'f5',
          lostReason: 'Source photo deleted from device',
        }),
      ])
    })

    it('retries copy failure with backoff instead of marking lost', async () => {
      mock.addFile('f6', { localId: 'ph://asset' })
      const resolveLocalId = jest.fn(
        async (): Promise<ResolveLocalIdResult> => ({
          status: 'resolved',
          uri: 'file:///photo.jpg',
        }),
      )
      mock.app.fs.copyFile.mockRejectedValueOnce(new Error('Copy failed'))

      const result = await scanner.runScan(undefined, resolveLocalId)

      expect(result.failed).toBe(1)
      expect(result.lost).toBe(0)
      // No lostReason written to DB
      expect(mock.app.files.updateMany).not.toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ lostReason: expect.any(String) })]),
      )
    })

    it('skips file when content is temporarily unavailable (not lost)', async () => {
      mock.addFile('f-icloud', { localId: 'ph://icloud-video' })
      const resolveLocalId = jest.fn(
        async (): Promise<ResolveLocalIdResult> => ({ status: 'unavailable' }),
      )

      const result = await scanner.runScan(undefined, resolveLocalId)

      expect(result.skipped).toBe(1)
      expect(result.lost).toBe(0)
      expect(mock.app.files.updateMany).not.toHaveBeenCalled()
    })

    it('marks orphan file (no local file, no localId) as lost', async () => {
      mock.addFile('f7')

      const result = await scanner.runScan()

      expect(result.lost).toBe(1)
      expect(mock.app.files.updateMany).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'f7',
          lostReason: 'No local file or source available',
        }),
      ])
    })
  })

  describe('backoff tracking', () => {
    it('unavailable files enter backoff and are excluded on next tick', async () => {
      mock.addFile('f-cloud', { localId: 'ph://cloud' })
      const resolveLocalId = jest.fn(
        async (): Promise<ResolveLocalIdResult> => ({ status: 'unavailable' }),
      )

      // First scan: file is skipped
      const r1 = await scanner.runScan(undefined, resolveLocalId)
      expect(r1.skipped).toBe(1)

      // Second scan (immediately): file excluded via backoff
      jest.clearAllMocks()
      const r2 = await scanner.runScan(undefined, resolveLocalId)
      expect(r2.skipped).toBe(0)
      expect(resolveLocalId).not.toHaveBeenCalled()
    })

    it('backed-off files are retried after cooldown expires', async () => {
      mock.addFile('f-cloud', { localId: 'ph://cloud' })
      let callCount = 0
      const resolveLocalId = jest.fn(async (): Promise<ResolveLocalIdResult> => {
        callCount++
        if (callCount === 1) return { status: 'unavailable' }
        return { status: 'resolved', uri: 'file:///photo.jpg' }
      })

      // First scan: unavailable → backoff
      await scanner.runScan(undefined, resolveLocalId)

      // Advance past 5-min backoff
      jest.advanceTimersByTime(5 * 60 * 1000)

      // Second scan: retried and succeeds
      const r2 = await scanner.runScan(undefined, resolveLocalId)
      expect(r2.finalized).toBe(1)
    })

    it('copy failure enters backoff and is retried', async () => {
      mock.addFile('f-copy', { localId: 'ph://asset' })
      const resolveLocalId = jest.fn(
        async (): Promise<ResolveLocalIdResult> => ({
          status: 'resolved',
          uri: 'file:///photo.jpg',
        }),
      )

      // First scan: copy fails
      mock.app.fs.copyFile.mockRejectedValueOnce(new Error('Copy failed'))
      const r1 = await scanner.runScan(undefined, resolveLocalId)
      expect(r1.failed).toBe(1)

      // Immediately: excluded via backoff
      jest.clearAllMocks()
      await scanner.runScan(undefined, resolveLocalId)
      expect(resolveLocalId).not.toHaveBeenCalled()

      // After backoff: retried
      jest.advanceTimersByTime(5 * 60 * 1000)
      jest.clearAllMocks()
      const r3 = await scanner.runScan(undefined, resolveLocalId)
      expect(r3.finalized).toBe(1)
    })

    it('successful finalization clears backoff', async () => {
      mock.addFile('f1', { localId: 'ph://1' })
      let callCount = 0
      const resolveLocalId = jest.fn(async (): Promise<ResolveLocalIdResult> => {
        callCount++
        if (callCount === 1) return { status: 'unavailable' }
        return { status: 'resolved', uri: 'file:///photo.jpg' }
      })

      // Skip → backoff
      await scanner.runScan(undefined, resolveLocalId)

      // Advance past backoff, finalize
      jest.advanceTimersByTime(5 * 60 * 1000)
      await scanner.runScan(undefined, resolveLocalId)

      // File is now finalized (hash set), so it won't appear in hashEmpty queries.
      // If it were still in backoff, it would be excluded. Verify backoff was cleared
      // by checking no excludeIds are passed.
      jest.clearAllMocks()
      await scanner.runScan(undefined, resolveLocalId)
      const phase2Call = mock.app.files.query.mock.calls.find(
        (c: any[]) => c[0].fileExistsLocally === false,
      )
      expect(phase2Call?.[0].excludeIds).toBeUndefined()
    })

    it('hash failure enters backoff', async () => {
      mock.addFile('f-hash')
      mock.addLocalFile('f-hash', '/local/f-hash.jpg')
      mockHash.mockResolvedValueOnce(null)

      const r1 = await scanner.runScan()
      expect(r1.failed).toBe(1)

      // Immediately: excluded via backoff
      jest.clearAllMocks()
      mockHash.mockResolvedValue('sha256:ok')
      const r2 = await scanner.runScan()
      expect(r2.finalized).toBe(0)

      // After backoff: retried
      jest.advanceTimersByTime(5 * 60 * 1000)
      const r3 = await scanner.runScan()
      expect(r3.finalized).toBe(1)
    })

    it('excludeIds from backoff are passed to both queries', async () => {
      mock.addFile('f-local')
      mock.addLocalFile('f-local', '/local/f-local.jpg')
      mock.addFile('f-deferred', { localId: 'ph://1' })
      const resolveLocalId = jest.fn(
        async (): Promise<ResolveLocalIdResult> => ({
          status: 'resolved',
          uri: 'file:///photo.jpg',
        }),
      )

      // Put a file in backoff
      ;(scanner as any).backoff.recordSkip('some-backed-off-id')

      await scanner.runScan(undefined, resolveLocalId)

      // Both queries should include the backed-off ID
      for (const call of mock.app.files.query.mock.calls) {
        expect(call[0].excludeIds).toContain('some-backed-off-id')
      }
    })
  })

  describe('skip in-progress files', () => {
    it('skips files currently being processed', async () => {
      mock.addFile('f7')
      mock.addLocalFile('f7', '/local/f7.jpg')
      ;(scanner as any).processingFiles.add('f7')

      const result = await scanner.runScan()

      expect(result.skipped).toBe(1)
      expect(result.finalized).toBe(0)
    })
  })

  describe('abort signal', () => {
    it('respects aborted signal', async () => {
      mock.addFile('f10')
      mock.addFile('f11')
      mock.addLocalFile('f10', '/local/f10.jpg')
      mock.addLocalFile('f11', '/local/f11.jpg')

      const controller = new AbortController()
      controller.abort()

      const result = await scanner.runScan(controller.signal)

      expect(result.finalized).toBe(0)
    })
  })

  describe('batch limit', () => {
    it('processes at most MAX_PER_TICK local files', async () => {
      for (let i = 0; i < 25; i++) {
        mock.addFile(`batch-${i}`, { addedAt: Date.now() - i })
        mock.addLocalFile(`batch-${i}`, `/local/batch-${i}.jpg`)
      }

      const result = await scanner.runScan()

      expect(result.finalized).toBe(20)
    })
  })

  describe('priority ordering', () => {
    it('processes newest addedAt first (DESC order)', async () => {
      mock.addFile('old', { addedAt: 1000 })
      mock.addFile('new', { addedAt: 2000 })
      mock.addLocalFile('old', '/local/old.jpg')
      mock.addLocalFile('new', '/local/new.jpg')

      await scanner.runScan()

      expect(mock.app.files.query).toHaveBeenCalledWith(
        expect.objectContaining({
          order: 'DESC',
          orderBy: 'addedAt',
          hashEmpty: true,
        }),
      )
    })
  })

  describe('MIME re-detection', () => {
    it('re-detects MIME when type is application/octet-stream', async () => {
      mock.addFile('f12', { type: 'application/octet-stream' })
      mock.addLocalFile('f12', '/local/f12.bin')
      mockMimeType.mockResolvedValueOnce('image/png')

      const result = await scanner.runScan()

      expect(result.finalized).toBe(1)
      expect(mockMimeType).toHaveBeenCalledWith({
        name: 'f12.jpg',
        uri: '/local/f12.bin',
      })
      expect(mock.app.files.updateMany).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'f12', type: 'image/png' }),
      ])
    })
  })

  describe('cache invalidation', () => {
    it('invalidates caches after finalization', async () => {
      mock.addFile('f13')
      mock.addLocalFile('f13', '/local/f13.jpg')

      await scanner.runScan()

      expect(mock.caches.library.invalidateAll).toHaveBeenCalled()
      expect(mock.caches.libraryVersion.invalidate).toHaveBeenCalled()
    })

    it('invalidates caches after marking files lost', async () => {
      mock.addFile('f14')

      await scanner.runScan()

      expect(mock.caches.library.invalidateAll).toHaveBeenCalled()
      expect(mock.caches.libraryVersion.invalidate).toHaveBeenCalled()
    })

    it('does not invalidate when no files processed', async () => {
      const result = await scanner.runScan()

      expect(result.finalized).toBe(0)
      expect(mock.caches.library.invalidateAll).not.toHaveBeenCalled()
    })
  })

  describe('files with real hash are skipped', () => {
    it('only queries files with hash = empty string', async () => {
      mock.addFile('has-hash', { hash: 'sha256:real-hash' })

      const result = await scanner.runScan()

      expect(result.finalized).toBe(0)
      for (const call of mock.app.files.query.mock.calls) {
        expect(call[0].hashEmpty).toBe(true)
      }
    })
  })

  describe('split queries: mixed file types', () => {
    it('processes local files in phase 1 and deferred files in phase 2', async () => {
      mock.addFile('local-file', { addedAt: 3000 })
      mock.addLocalFile('local-file', '/local/local-file.jpg')

      mock.addFile('photo-file', { localId: 'ph://123', addedAt: 1000 })

      const resolveLocalId = jest.fn(
        async (): Promise<ResolveLocalIdResult> => ({
          status: 'resolved',
          uri: 'file:///photo.jpg',
        }),
      )

      const result = await scanner.runScan(undefined, resolveLocalId)

      expect(result.finalized).toBe(2)
      expect(result.lost).toBe(0)
    })

    it('always hashes local files but limits deferred files', async () => {
      mock.addFile('local1', { addedAt: 5000 })
      mock.addLocalFile('local1', '/local/local1.jpg')

      mock.addFile('local2', { addedAt: 4000 })
      mock.addLocalFile('local2', '/local/local2.jpg')

      mock.addFile('deferred1', { localId: 'ph://1', addedAt: 3000 })
      mock.addFile('deferred2', { localId: 'ph://2', addedAt: 2000 })

      const resolveLocalId = jest.fn(
        async (): Promise<ResolveLocalIdResult> => ({
          status: 'resolved',
          uri: 'file:///photo.jpg',
        }),
      )

      const result = await scanner.runScan(undefined, resolveLocalId, 1)

      expect(result.finalized).toBe(3) // 2 local + 1 deferred
    })
  })

  describe('hash failure', () => {
    it('marks file as failed when hash returns null', async () => {
      mock.addFile('hash-fail')
      mock.addLocalFile('hash-fail', '/local/hash-fail.jpg')
      mockHash.mockResolvedValueOnce(null)

      const result = await scanner.runScan()

      expect(result.failed).toBe(1)
      expect(result.finalized).toBe(0)
    })
  })
})

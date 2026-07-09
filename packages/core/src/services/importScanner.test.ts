import { IMPORT_STALE_CLAIM_MS } from '../config'
import type { FinalizeResult } from '../db/operations/files'
import type { ImportFileRow, ImportRow } from '../db/operations/imports'
import { ImportScanner, type ResolveSourceResult } from './importScanner'

function impRow(over: Partial<ImportRow> & { id: string }): ImportRow {
  return {
    source: 'library-scan',
    directoryId: null,
    pendingTags: null,
    expectedCount: 0,
    dedupByHash: 1,
    dirSourceRef: null,
    sealed: 1,
    startedAt: 1,
    updatedAt: 1,
    ...over,
  }
}

function fileRow(over: Partial<ImportFileRow> & { id: string; importId: string }): ImportFileRow {
  return {
    state: 'pending',
    reason: null,
    name: 'photo.jpg',
    type: 'image/jpeg',
    size: 0,
    hash: null,
    createdAt: 1,
    updatedAt: 1,
    addedAt: 1,
    directoryId: null,
    mediaAssetId: null,
    sourceKind: 'media',
    sourceUri: null,
    sourceRef: null,
    copyBytes: 0,
    attempts: 0,
    nextAttemptAt: 0,
    claimedAt: null,
    claimToken: null,
    ...over,
  }
}

type Mocks = {
  app: any
  imports: {
    resetStale: jest.Mock
    pendingFiles: jest.Mock
    get: jest.Mock
    claim: jest.Mock
    markProgress: jest.Mock
    recordHash: jest.Mock
    finalize: jest.Mock
    markUnavailable: jest.Mock
    markFailure: jest.Mock
  }
  fs: {
    readMeta: jest.Mock
    importCopy: jest.Mock
    removeFile: jest.Mock
    uri: jest.Mock
    getDeviceSpace: jest.Mock
  }
  files: {
    getUnuploadedBytes: jest.Mock
  }
}

const AMPLE_FREE = Number.MAX_SAFE_INTEGER

function createMocks(opts?: {
  candidates?: ImportFileRow[]
  imports?: ImportRow[]
  claim?: boolean | ((id: string) => boolean)
  finalize?: FinalizeResult
  readMeta?: (
    fileId: string,
  ) => { fileId: string; size: number; addedAt: number; usedAt: number } | null
  /** Device free space the paced throttle reads (default ample, so no deferral). */
  deviceFreeBytes?: number
  /** getDeviceSpace throws (an unavailable signal falls back to ample space). */
  deviceSpaceThrows?: boolean
  /** Unuploaded pending-local bytes the paced throttle reads. */
  unuploadedBytes?: number
}): Mocks {
  const importsById = new Map<string, ImportRow>()
  for (const i of opts?.imports ?? [impRow({ id: 'imp1' })]) importsById.set(i.id, i)

  const imports = {
    resetStale: jest.fn(async () => {}),
    pendingFiles: jest.fn(async () => opts?.candidates ?? []),
    get: jest.fn(async (id: string) => importsById.get(id) ?? null),
    claim: jest.fn(async (id: string) =>
      typeof opts?.claim === 'function' ? opts.claim(id) : (opts?.claim ?? true),
    ),
    markProgress: jest.fn(async () => {}),
    recordHash: jest.fn(async () => {}),
    finalize: jest.fn(async () => opts?.finalize ?? ({ outcome: 'added' } as FinalizeResult)),
    markUnavailable: jest.fn(async () => {}),
    markFailure: jest.fn(async () => {}),
  }

  const fs = {
    readMeta: jest.fn(async (fileId: string) => opts?.readMeta?.(fileId) ?? null),
    importCopy: jest.fn(async (file: any) => ({ uri: `/local/${file.id}`, size: 9 })),
    removeFile: jest.fn(async () => {}),
    uri: jest.fn((file: any) => `/local/${file.id}`),
    getDeviceSpace: jest.fn(async () => {
      if (opts?.deviceSpaceThrows) throw new Error('device space unavailable')
      const freeBytes = opts?.deviceFreeBytes ?? AMPLE_FREE
      return { freeBytes, totalBytes: AMPLE_FREE }
    }),
  }

  const files = {
    getUnuploadedBytes: jest.fn(async () => opts?.unuploadedBytes ?? 0),
  }

  const app: any = { imports, fs, files }
  return { app, imports, fs, files }
}

const HASH = 'h'.repeat(64)

function scanner(
  m: Mocks,
  opts?: {
    resolve?:
      | ResolveSourceResult
      | ((row: ImportFileRow, resolveOpts?: { verify?: boolean }) => ResolveSourceResult)
    hash?: string | null
  },
): ImportScanner {
  const s = new ImportScanner()
  const resolveSource = async (
    row: ImportFileRow,
    _imp: ImportRow,
    _token: string,
    resolveOpts?: { verify?: boolean },
  ): Promise<ResolveSourceResult> => {
    const r = opts?.resolve ?? ({ status: 'resolved', uri: `/src/${row.id}` } as const)
    return typeof r === 'function' ? r(row, resolveOpts) : r
  }
  s.initialize(
    m.app,
    async () => (opts?.hash === undefined ? HASH : opts.hash),
    async () => 'image/jpeg',
    resolveSource,
  )
  return s
}

describe('ImportScanner claim-loop', () => {
  it('calls resetStale at the top of every runScan to recover stale claims', async () => {
    const m = createMocks({ candidates: [] })
    const s = scanner(m)
    await s.runScan()
    expect(m.imports.resetStale).toHaveBeenCalledTimes(1)
    // No candidates, so no claim/copy/finalize.
    expect(m.imports.claim).not.toHaveBeenCalled()
  })

  it('skips a row whose claim was already won elsewhere (no copy/finalize)', async () => {
    const m = createMocks({
      candidates: [fileRow({ id: 'a', importId: 'imp1' })],
      claim: false,
    })
    const s = scanner(m)
    const result = await s.runScan()
    expect(m.imports.claim).toHaveBeenCalledWith('a', expect.any(Number), expect.any(String))
    expect(m.fs.importCopy).not.toHaveBeenCalled()
    expect(m.imports.finalize).not.toHaveBeenCalled()
    expect(result).toMatchObject({ finalized: 0, failed: 0, lost: 0, duplicate: 0, skipped: 0 })
  })

  it('copies a resolved row under its claim token, hashes, records, then finalizes as added', async () => {
    const m = createMocks({
      candidates: [fileRow({ id: 'a', importId: 'imp1', size: 0 })],
      finalize: { outcome: 'added' },
    })
    const s = scanner(m)
    const result = await s.runScan()

    expect(m.fs.importCopy).toHaveBeenCalledTimes(1)
    const copyOpts = m.fs.importCopy.mock.calls[0][2]
    expect(copyOpts).toMatchObject({ usedAt: 0 })
    expect(typeof copyOpts.claimToken).toBe('string')
    // The same token threads through claim, copy, recordHash, and finalize.
    const token = m.imports.claim.mock.calls[0][2]
    expect(copyOpts.claimToken).toBe(token)
    expect(m.imports.recordHash).toHaveBeenCalledWith('a', token, {
      hash: HASH,
      size: expect.any(Number),
      type: 'image/jpeg',
    })
    expect(m.imports.finalize).toHaveBeenCalledWith('a', token)
    expect(result.finalized).toBe(1)
  })

  it('persists hash/size/type via recordHash BEFORE finalize', async () => {
    const m = createMocks({
      candidates: [fileRow({ id: 'a', importId: 'imp1' })],
      finalize: { outcome: 'added' },
    })
    const order: string[] = []
    m.imports.recordHash.mockImplementation(async () => {
      order.push('recordHash')
    })
    m.imports.finalize.mockImplementation(async () => {
      order.push('finalize')
      return { outcome: 'added' } as FinalizeResult
    })
    const s = scanner(m)
    await s.runScan()
    expect(order).toEqual(['recordHash', 'finalize'])
  })

  it('a duplicate finalize removes the copied bytes and counts a duplicate', async () => {
    const m = createMocks({
      candidates: [fileRow({ id: 'a', importId: 'imp1' })],
      finalize: { outcome: 'duplicate' },
    })
    const s = scanner(m)
    const result = await s.runScan()
    expect(m.fs.removeFile).toHaveBeenCalledWith({ id: 'a', type: 'image/jpeg' })
    expect(result.duplicate).toBe(1)
    expect(result.finalized).toBe(0)
  })

  it('a noop finalize counts as skipped with no fs side effect', async () => {
    const m = createMocks({
      candidates: [fileRow({ id: 'a', importId: 'imp1' })],
      finalize: { outcome: 'noop' },
    })
    const s = scanner(m)
    const result = await s.runScan()
    expect(m.fs.removeFile).not.toHaveBeenCalled()
    expect(result.skipped).toBe(1)
    expect(result.finalized).toBe(0)
  })

  it('runs resolved.release exactly once after a successful copy', async () => {
    const release = jest.fn(async () => {})
    const m = createMocks({
      candidates: [fileRow({ id: 'a', importId: 'imp1' })],
      finalize: { outcome: 'added' },
    })
    const s = scanner(m, { resolve: { status: 'resolved', uri: '/src/a', release } })
    await s.runScan()
    expect(release).toHaveBeenCalledTimes(1)
    expect(m.imports.finalize).toHaveBeenCalled()
  })

  it('runs resolved.release even when the copy throws', async () => {
    const release = jest.fn(async () => {})
    const m = createMocks({ candidates: [fileRow({ id: 'a', importId: 'imp1' })] })
    m.fs.importCopy.mockRejectedValueOnce(new Error('copy boom'))
    const s = scanner(m, { resolve: { status: 'resolved', uri: '/src/a', release } })
    const result = await s.runScan()
    expect(release).toHaveBeenCalledTimes(1)
    expect(m.imports.markFailure).toHaveBeenCalled()
    expect(result.failed).toBe(1)
  })

  it('releaseSourceGrant runs once at a success terminal, not on a non-success', async () => {
    const releaseGrant = jest.fn(async (_row: ImportFileRow) => {})
    const added = createMocks({
      candidates: [
        fileRow({ id: 'a', importId: 'imp1', sourceKind: 'bookmark', sourceRef: 'android-uri:a' }),
      ],
      finalize: { outcome: 'added' },
    })
    const s1 = new ImportScanner()
    s1.initialize(
      added.app,
      async () => HASH,
      async () => 'image/jpeg',
      async () => ({ status: 'resolved', uri: '/src/a' }),
      releaseGrant,
    )
    await s1.runScan()
    expect(releaseGrant).toHaveBeenCalledTimes(1)
    expect(releaseGrant.mock.calls[0][0]).toMatchObject({ id: 'a' })

    // A row that never reaches a success terminal must NOT have its grant released.
    releaseGrant.mockClear()
    const lost = createMocks({ candidates: [fileRow({ id: 'b', importId: 'imp1' })] })
    const s2 = new ImportScanner()
    s2.initialize(
      lost.app,
      async () => HASH,
      async () => 'image/jpeg',
      async () => ({ status: 'deleted' }),
      releaseGrant,
    )
    await s2.runScan()
    expect(releaseGrant).not.toHaveBeenCalled()
  })

  it('bytes already at the id slot finalize WITHOUT touching the source', async () => {
    // A moved staged origin no longer exists; an interrupted-after-copy retry
    // must hash the local bytes instead of resolving (and misclassifying) the
    // source.
    const resolve = jest.fn((row: ImportFileRow) => ({
      status: 'resolved' as const,
      uri: `/src/${row.id}`,
    }))
    const m = createMocks({
      candidates: [fileRow({ id: 'a', importId: 'imp1', sourceKind: 'staged' })],
      readMeta: () => ({ fileId: 'a', size: 9, addedAt: 1, usedAt: 0 }),
      finalize: { outcome: 'added' },
    })
    const s = scanner(m, { resolve })
    const result = await s.runScan()
    expect(resolve).not.toHaveBeenCalled()
    expect(m.fs.importCopy).not.toHaveBeenCalled()
    expect(m.imports.finalize).toHaveBeenCalled()
    expect(result.finalized).toBe(1)
  })

  it('a staged source is MOVED (consumed), every other kind strictly copied', async () => {
    const m = createMocks({
      candidates: [
        fileRow({ id: 'a', importId: 'imp1', sourceKind: 'staged' }),
        fileRow({ id: 'b', importId: 'imp1', sourceKind: 'media' }),
      ],
    })
    const s = scanner(m)
    await s.runScan()
    const optsByFile = new Map(m.fs.importCopy.mock.calls.map((c: any[]) => [c[0].id, c[2]]))
    expect(optsByFile.get('a')?.move).toBe(true)
    expect(optsByFile.get('b')?.move).toBe(false)
  })

  it('ephemeral rows drain before durable kinds within a tick', async () => {
    const m = createMocks({
      candidates: [
        fileRow({ id: 'durable', importId: 'imp1', sourceKind: 'media' }),
        fileRow({ id: 'session', importId: 'imp1', sourceKind: 'ephemeral', sourceUri: '/tmp/x' }),
      ],
    })
    const s = scanner(m)
    await s.runScan()
    const order = m.imports.claim.mock.calls.map((c: any[]) => c[0])
    expect(order).toEqual(['session', 'durable'])
  })

  it('a deleted source is marked unavailable immediately with the deleted reason code', async () => {
    const m = createMocks({ candidates: [fileRow({ id: 'a', importId: 'imp1' })] })
    const s = scanner(m, { resolve: { status: 'deleted' } })
    const result = await s.runScan()
    expect(m.imports.markUnavailable).toHaveBeenCalledWith('a', expect.any(String), 'deleted')
    expect(m.fs.importCopy).not.toHaveBeenCalled()
    expect(m.imports.finalize).not.toHaveBeenCalled()
    expect(result.lost).toBe(1)
  })

  it("a resolver's own code (session-expired) rides the deleted terminal", async () => {
    const m = createMocks({ candidates: [fileRow({ id: 'a', importId: 'imp1' })] })
    const s = scanner(m, { resolve: { status: 'deleted', code: 'session-expired' } })
    await s.runScan()
    expect(m.imports.markUnavailable).toHaveBeenCalledWith(
      'a',
      expect.any(String),
      'session-expired',
    )
  })

  it('an unavailable source backs off under its reason code toward the unavailable terminal', async () => {
    const m = createMocks({ candidates: [fileRow({ id: 'a', importId: 'imp1' })] })
    const s = scanner(m, { resolve: { status: 'unavailable', code: 'cloud-pending' } })
    const result = await s.runScan()
    // Registry rule for cloud-pending: full schedule, exhausts to `unavailable`.
    expect(m.imports.markFailure).toHaveBeenCalledWith(
      'a',
      expect.any(String),
      'cloud-pending',
      expect.any(Number),
      'unavailable',
      8,
    )
    expect(m.fs.importCopy).not.toHaveBeenCalled()
    expect(result.failed).toBe(1)
  })

  it('a deterministic failure code caps its retries early (export-failed caps at 2)', async () => {
    const m = createMocks({ candidates: [fileRow({ id: 'a', importId: 'imp1' })] })
    const s = scanner(m, { resolve: { status: 'unavailable', code: 'export-failed' } })
    await s.runScan()
    expect(m.imports.markFailure).toHaveBeenCalledWith(
      'a',
      expect.any(String),
      'export-failed',
      expect.any(Number),
      'unavailable',
      2,
    )
  })

  it('a hash failure backs off toward the failed terminal without finalizing', async () => {
    const m = createMocks({ candidates: [fileRow({ id: 'a', importId: 'imp1' })] })
    const s = scanner(m, { hash: null })
    const result = await s.runScan()
    expect(m.imports.markFailure).toHaveBeenCalledWith(
      'a',
      expect.any(String),
      'hash-failed',
      expect.any(Number),
      'failed',
      8,
    )
    expect(m.imports.finalize).not.toHaveBeenCalled()
    expect(result.failed).toBe(1)
  })

  it('aborted before the loop body leaves the row untouched (resetStale recovers)', async () => {
    const m = createMocks({ candidates: [fileRow({ id: 'a', importId: 'imp1' })] })
    const s = scanner(m)
    const controller = new AbortController()
    controller.abort()
    const result = await s.runScan(controller.signal)
    // The loop breaks at the boundary check before any claim; the row stays pending.
    expect(m.imports.claim).not.toHaveBeenCalled()
    expect(m.imports.finalize).not.toHaveBeenCalled()
    expect(m.imports.markFailure).not.toHaveBeenCalled()
    expect(result.finalized).toBe(0)
  })

  it('abort mid-copy breaks the loop, leaving the row active with no terminal write', async () => {
    const controller = new AbortController()
    const m = createMocks({ candidates: [fileRow({ id: 'a', importId: 'imp1' })] })
    // importCopy races the signal: an abort during the copy makes raceWithAbort return not-ok.
    m.fs.importCopy.mockImplementation(async () => {
      controller.abort()
      return new Promise<string>(() => {}) // never resolves; the abort wins the race
    })
    const s = scanner(m)
    const result = await s.runScan(controller.signal)
    expect(m.imports.claim).toHaveBeenCalledTimes(1)
    // No terminal write; the active row is left for resetStale to recover next tick.
    expect(m.imports.finalize).not.toHaveBeenCalled()
    expect(m.imports.markFailure).not.toHaveBeenCalled()
    expect(m.imports.markUnavailable).not.toHaveBeenCalled()
    expect(result.finalized).toBe(0)
  })

  it('fast path: existing fs meta skips the copy but still hashes and finalizes', async () => {
    const m = createMocks({
      candidates: [fileRow({ id: 'a', importId: 'imp1' })],
      finalize: { outcome: 'added' },
      readMeta: () => ({ fileId: 'a', size: 999, addedAt: 1, usedAt: 0 }),
    })
    const s = scanner(m)
    const result = await s.runScan()
    expect(m.fs.importCopy).not.toHaveBeenCalled()
    expect(m.imports.recordHash).toHaveBeenCalledWith('a', expect.any(String), {
      hash: HASH,
      size: 999,
      type: 'image/jpeg',
    })
    expect(m.imports.finalize).toHaveBeenCalled()
    expect(result.finalized).toBe(1)
  })

  it('batch-loads each distinct import once across many candidate rows', async () => {
    const m = createMocks({
      candidates: [fileRow({ id: 'a', importId: 'imp1' }), fileRow({ id: 'b', importId: 'imp1' })],
      imports: [impRow({ id: 'imp1' })],
      finalize: { outcome: 'added' },
    })
    const s = scanner(m)
    await s.runScan()
    // One get() for the single distinct importId, not one per row.
    expect(m.imports.get).toHaveBeenCalledTimes(1)
  })

  it('an unrecognized processing error backs off as io-error toward failed', async () => {
    const m = createMocks({ candidates: [fileRow({ id: 'a', importId: 'imp1' })] })
    m.fs.importCopy.mockRejectedValue(new Error('boom'))
    const s = scanner(m)
    const result = await s.runScan()
    expect(m.imports.markFailure).toHaveBeenCalledWith(
      'a',
      expect.any(String),
      'io-error',
      expect.any(Number),
      'failed',
      8,
    )
    expect(result.failed).toBe(1)
  })

  it('a copy ENOENT on an app-owned source is marked unavailable immediately as deleted', async () => {
    const m = createMocks({
      candidates: [fileRow({ id: 'a', importId: 'imp1', sourceKind: 'ephemeral' })],
    })
    m.fs.importCopy.mockRejectedValue(new Error('ENOENT: no such file or directory'))
    const s = scanner(m)
    const result = await s.runScan()
    expect(m.imports.markUnavailable).toHaveBeenCalledWith('a', expect.any(String), 'deleted')
    expect(result.lost).toBe(1)
  })

  it('a copy ENOENT on a media row re-verifies the source before going terminal', async () => {
    // The asset still exists (resolver resolves again): a stale byte path is
    // source-missing backoff, never a deleted terminal.
    const m = createMocks({
      candidates: [fileRow({ id: 'a', importId: 'imp1', sourceKind: 'media' })],
    })
    m.fs.importCopy.mockRejectedValue(new Error('ENOENT: no such file or directory'))
    const s = scanner(m)
    const result = await s.runScan()
    expect(m.imports.markFailure).toHaveBeenCalledWith(
      'a',
      expect.any(String),
      'source-missing',
      expect.any(Number),
      'unavailable',
      8,
    )
    expect(result.failed).toBe(1)
  })

  it('a permission error on an ephemeral row is the expired session, not a permission problem', async () => {
    const m = createMocks({
      candidates: [fileRow({ id: 'a', importId: 'imp1', sourceKind: 'ephemeral' })],
    })
    m.fs.importCopy.mockRejectedValue(new Error('EACCES: permission denied'))
    const s = scanner(m)
    const result = await s.runScan()
    expect(m.imports.markUnavailable).toHaveBeenCalledWith(
      'a',
      expect.any(String),
      'session-expired',
    )
    expect(result.lost).toBe(1)
  })

  it('a disk-full copy failure backs off as not-enough-space (user-fixable)', async () => {
    const m = createMocks({ candidates: [fileRow({ id: 'a', importId: 'imp1' })] })
    m.fs.importCopy.mockRejectedValue(new Error('ENOSPC: No space left on device'))
    const s = scanner(m)
    await s.runScan()
    expect(m.imports.markFailure).toHaveBeenCalledWith(
      'a',
      expect.any(String),
      'not-enough-space',
      expect.any(Number),
      'unavailable',
      8,
    )
  })

  it('a coded native error maps through the registry verbatim', async () => {
    const m = createMocks({ candidates: [fileRow({ id: 'a', importId: 'imp1' })] })
    const err = new Error('cloud pull failed') as Error & { code: string }
    err.code = 'cloud-download-failed'
    m.fs.importCopy.mockRejectedValue(err)
    const s = scanner(m)
    await s.runScan()
    expect(m.imports.markFailure).toHaveBeenCalledWith(
      'a',
      expect.any(String),
      'cloud-download-failed',
      expect.any(Number),
      'unavailable',
      8,
    )
  })

  it('an unknown future native code falls back to io-error instead of crashing', async () => {
    const m = createMocks({ candidates: [fileRow({ id: 'a', importId: 'imp1' })] })
    const err = new Error('mystery') as Error & { code: string }
    err.code = 'some-future-code'
    m.fs.importCopy.mockRejectedValue(err)
    const s = scanner(m)
    await s.runScan()
    expect(m.imports.markFailure).toHaveBeenCalledWith(
      'a',
      expect.any(String),
      'io-error',
      expect.any(Number),
      'failed',
      8,
    )
  })
})

describe('ImportScanner stall watchdog', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('aborts a copy with no progress and records a transient io-error, freeing the tick', async () => {
    jest.useFakeTimers()
    const m = createMocks({
      candidates: [fileRow({ id: 'a', importId: 'imp1' })],
      imports: [impRow({ id: 'imp1', source: 'picker' })],
    })
    // Mimics the native cancel contract: never settles until aborted, then
    // rejects with the coded cancellation.
    m.fs.importCopy.mockImplementation(
      (_file: any, _uri: string, opts: any) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => {
            const e = new Error('copy cancelled') as Error & { code: string }
            e.code = 'cancelled'
            reject(e)
          })
        }),
    )

    const run = scanner(m).runScan()
    await jest.advanceTimersByTimeAsync(121_000)
    const result = await run

    expect(result.failed).toBe(1)
    expect(m.imports.markFailure).toHaveBeenCalledWith(
      'a',
      expect.any(String),
      'io-error',
      expect.any(Number),
      expect.anything(),
      expect.anything(),
    )
  })

  it('a slow copy that keeps reporting progress is never cut off', async () => {
    jest.useFakeTimers()
    const m = createMocks({
      candidates: [fileRow({ id: 'a', importId: 'imp1', size: 1000 })],
      imports: [impRow({ id: 'imp1', source: 'picker' })],
      finalize: { outcome: 'added' },
    })
    m.fs.importCopy.mockImplementation(async (_file: any, _uri: string, opts: any) => {
      // 5 minutes of copy, a progress event every 60s: each re-arms the watchdog.
      for (let i = 1; i <= 5; i++) {
        await new Promise((r) => setTimeout(r, 60_000))
        opts.onProgress(i * 200)
      }
      return { uri: '/local/a', size: 1000 }
    })

    const run = scanner(m).runScan()
    await jest.advanceTimersByTimeAsync(301_000)
    const result = await run

    expect(result.finalized).toBe(1)
    expect(m.imports.markFailure).not.toHaveBeenCalled()
  })

  it('a resolver that never settles backs the row off instead of wedging the tick', async () => {
    jest.useFakeTimers()
    const m = createMocks({
      candidates: [fileRow({ id: 'a', importId: 'imp1' })],
      imports: [impRow({ id: 'imp1', source: 'picker' })],
    })
    const hang = (() => new Promise(() => {})) as unknown as ResolveSourceResult
    const run = scanner(m, { resolve: hang }).runScan()
    await jest.advanceTimersByTimeAsync(31_000)
    const result = await run

    expect(result.failed).toBe(1)
    expect(m.imports.markFailure).toHaveBeenCalledWith(
      'a',
      expect.any(String),
      'resolver-error',
      expect.any(Number),
      expect.anything(),
      expect.anything(),
    )
  })
})

describe('ImportScanner copy progress writes', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('throttles row writes to one per second unless 5% of the file moved, then records the final size', async () => {
    let wall = 10_000
    jest.spyOn(Date, 'now').mockImplementation(() => wall)
    const m = createMocks({
      candidates: [fileRow({ id: 'a', importId: 'imp1', size: 1000 })],
      imports: [impRow({ id: 'imp1', source: 'picker' })],
      finalize: { outcome: 'added' },
    })
    m.fs.importCopy.mockImplementation(async (_file: any, _uri: string, opts: any) => {
      opts.onProgress(10) // first event: writes (no prior write this copy)
      wall += 200
      opts.onProgress(20) // 1% moved, 200ms elapsed: gated
      wall += 200
      opts.onProgress(30) // still under both gates
      wall += 200
      opts.onProgress(100) // 7% since the last write: the delta gate trips
      return { uri: '/local/a', size: 1000 }
    })

    const result = await scanner(m).runScan()
    expect(result.finalized).toBe(1)
    // Two throttled writes plus the unconditional final-size write.
    expect(m.imports.markProgress.mock.calls.map((c: any[]) => c[1])).toEqual([10, 100, 1000])
  })

  it('a rejecting throttled write does not fail the row', async () => {
    let wall = 10_000
    jest.spyOn(Date, 'now').mockImplementation(() => wall)
    const m = createMocks({
      candidates: [fileRow({ id: 'a', importId: 'imp1', size: 1000 })],
      imports: [impRow({ id: 'imp1', source: 'picker' })],
      finalize: { outcome: 'added' },
    })
    m.imports.markProgress.mockImplementation(async (_id: string, bytes: number) => {
      // The final-size write is awaited; only the throttled one may reject.
      if (bytes !== 1000) throw new Error('teardown race')
    })
    m.fs.importCopy.mockImplementation(async (_file: any, _uri: string, opts: any) => {
      opts.onProgress(10)
      return { uri: '/local/a', size: 1000 }
    })

    const result = await scanner(m).runScan()
    expect(result.finalized).toBe(1)
    expect(m.imports.markFailure).not.toHaveBeenCalled()
  })

  it('a native cancelled rejection suspends the row with no terminal write', async () => {
    const m = createMocks({
      candidates: [fileRow({ id: 'a', importId: 'imp1' })],
      imports: [impRow({ id: 'imp1', source: 'picker' })],
    })
    m.fs.importCopy.mockImplementation(async () => {
      const e = new Error('copy cancelled') as Error & { code: string }
      e.code = 'cancelled'
      throw e
    })

    const result = await scanner(m).runScan()
    expect(result.finalized).toBe(0)
    expect(result.failed).toBe(0)
    expect(m.imports.markFailure).not.toHaveBeenCalled()
    expect(m.imports.markUnavailable).not.toHaveBeenCalled()
    expect(m.imports.finalize).not.toHaveBeenCalled()
  })
})

describe('ImportScanner critical free-space floor', () => {
  // Under IMPORT_CRITICAL_FREE_BYTES (500 MB). These tests assert the floor's
  // behavior on sources the paced gate deliberately lets through.
  const BELOW_FLOOR = 100 * 1024 ** 2 // 100 MB

  it('holds an interactive durable row that the paced gate would let through', async () => {
    const m = createMocks({
      candidates: [fileRow({ id: 'a', importId: 'imp1', sourceKind: 'bookmark' })],
      imports: [impRow({ id: 'imp1', source: 'picker' })],
      deviceFreeBytes: BELOW_FLOOR,
    })
    const result = await scanner(m).runScan()
    expect(m.imports.claim).not.toHaveBeenCalled()
    expect(m.fs.importCopy).not.toHaveBeenCalled()
    // Held, not failed: the bookmark re-resolves once space frees.
    expect(m.imports.markFailure).not.toHaveBeenCalled()
    expect(result.deferred).toBe(1)
  })

  it('finalizes a row whose bytes already sit at the id slot, even below the floor', async () => {
    // A crash between copy and finalize leaves the bytes on disk; finishing the
    // row allocates nothing, so the floor must not strand it.
    const m = createMocks({
      candidates: [fileRow({ id: 'a', importId: 'imp1', sourceKind: 'ephemeral' })],
      imports: [impRow({ id: 'imp1', source: 'picker' })],
      finalize: { outcome: 'added' },
      readMeta: () => ({ fileId: 'a', size: 42, addedAt: 1, usedAt: 0 }),
      deviceFreeBytes: BELOW_FLOOR,
    })
    const result = await scanner(m).runScan()
    expect(m.imports.markFailure).not.toHaveBeenCalled()
    expect(m.fs.importCopy).not.toHaveBeenCalled()
    expect(result.finalized).toBe(1)
  })

  it('fails an ephemeral row as not-enough-space, since its uri dies with the session', async () => {
    const m = createMocks({
      candidates: [fileRow({ id: 'a', importId: 'imp1', sourceKind: 'ephemeral' })],
      imports: [impRow({ id: 'imp1', source: 'picker' })],
      deviceFreeBytes: BELOW_FLOOR,
    })
    const result = await scanner(m).runScan()
    expect(m.fs.importCopy).not.toHaveBeenCalled()
    expect(m.imports.markFailure).toHaveBeenCalledWith(
      'a',
      expect.any(String),
      'not-enough-space',
      expect.any(Number),
      expect.anything(),
      expect.anything(),
    )
    expect(result.failed).toBe(1)
  })
})

describe('ImportScanner paced throttle', () => {
  // 2 GB headroom (IMPORT_PACED_STORAGE_HEADROOM_BYTES); a free value under it
  // (with zero pending-local bytes) trips the storage-headroom deferral.
  const LOW_FREE = 1 * 1024 ** 3 // 1 GB is under the 2 GB headroom, so under pressure

  it('defers a paceable row under low device space (not claimed or copied)', async () => {
    const m = createMocks({
      candidates: [fileRow({ id: 'a', importId: 'imp1' })],
      imports: [impRow({ id: 'imp1', source: 'library-scan' })],
      deviceFreeBytes: LOW_FREE,
    })
    const s = scanner(m)
    const result = await s.runScan()
    expect(m.imports.claim).not.toHaveBeenCalled()
    expect(m.fs.importCopy).not.toHaveBeenCalled()
    expect(m.imports.finalize).not.toHaveBeenCalled()
    // Not marked failed; left pending for next tick.
    expect(m.imports.markUnavailable).not.toHaveBeenCalled()
    expect(m.imports.markFailure).not.toHaveBeenCalled()
    expect(result.deferred).toBe(1)
    expect(result.finalized).toBe(0)
  })

  it('claims, copies, and finalizes a paceable row when space is ample and the backlog is low', async () => {
    const m = createMocks({
      candidates: [fileRow({ id: 'a', importId: 'imp1' })],
      imports: [impRow({ id: 'imp1', source: 'library-scan' })],
      finalize: { outcome: 'added' },
    })
    const s = scanner(m)
    const result = await s.runScan()
    expect(m.imports.claim).toHaveBeenCalledTimes(1)
    expect(m.fs.importCopy).toHaveBeenCalledTimes(1)
    expect(m.imports.finalize).toHaveBeenCalled()
    expect(result.deferred).toBe(0)
    expect(result.finalized).toBe(1)
  })

  it('still copies an ephemeral row of a background source under low device space', async () => {
    // The sourceKind half of the gate: an ephemeral row has no durable source
    // to re-resolve, so even a library-scan import must copy it this session.
    const m = createMocks({
      candidates: [fileRow({ id: 'a', importId: 'imp1', sourceKind: 'ephemeral' })],
      imports: [impRow({ id: 'imp1', source: 'library-scan' })],
      finalize: { outcome: 'added' },
      deviceFreeBytes: LOW_FREE,
    })
    const result = await scanner(m).runScan()
    expect(m.imports.claim).toHaveBeenCalledTimes(1)
    expect(m.fs.importCopy).toHaveBeenCalledTimes(1)
    expect(result.deferred).toBe(0)
    expect(result.finalized).toBe(1)
  })

  it('still claims and copies an interactive-source row under low device space (interactive sources never defer)', async () => {
    const m = createMocks({
      candidates: [fileRow({ id: 'a', importId: 'imp1' })],
      imports: [impRow({ id: 'imp1', source: 'picker' })],
      finalize: { outcome: 'added' },
      deviceFreeBytes: LOW_FREE,
    })
    const s = scanner(m)
    const result = await s.runScan()
    expect(m.imports.claim).toHaveBeenCalledTimes(1)
    expect(m.fs.importCopy).toHaveBeenCalledTimes(1)
    expect(result.deferred).toBe(0)
    expect(result.finalized).toBe(1)
    // Free space is read every tick for the critical floor, which binds every
    // source; the backlog is not, since only the paced gate consults it.
    expect(m.files.getUnuploadedBytes).not.toHaveBeenCalled()
  })

  it('defers a paceable row under a high upload backlog even with ample space', async () => {
    const m = createMocks({
      candidates: [fileRow({ id: 'a', importId: 'imp1' })],
      imports: [impRow({ id: 'imp1', source: 'library-scan' })],
      // Bytes over IMPORT_PACED_BACKLOG_BYTES (512 MB); free space still ample.
      unuploadedBytes: 600 * 1024 ** 2,
    })
    const s = scanner(m)
    const result = await s.runScan()
    expect(m.imports.claim).not.toHaveBeenCalled()
    expect(m.fs.importCopy).not.toHaveBeenCalled()
    expect(result.deferred).toBe(1)
  })

  it('does not defer a paceable row when getDeviceSpace throws (ample-space fallback)', async () => {
    const m = createMocks({
      candidates: [fileRow({ id: 'a', importId: 'imp1' })],
      imports: [impRow({ id: 'imp1', source: 'library-scan' })],
      finalize: { outcome: 'added' },
      deviceSpaceThrows: true,
    })
    const s = scanner(m)
    const result = await s.runScan()
    expect(m.imports.claim).toHaveBeenCalledTimes(1)
    expect(m.fs.importCopy).toHaveBeenCalledTimes(1)
    expect(result.deferred).toBe(0)
    expect(result.finalized).toBe(1)
  })

  it('reads device-space + backlog at most ONCE per tick across many paceable candidates', async () => {
    const m = createMocks({
      candidates: [
        fileRow({ id: 'a', importId: 'imp1' }),
        fileRow({ id: 'b', importId: 'imp1' }),
        fileRow({ id: 'c', importId: 'imp1' }),
      ],
      imports: [impRow({ id: 'imp1', source: 'library-scan' })],
      deviceFreeBytes: LOW_FREE,
    })
    const s = scanner(m)
    const result = await s.runScan()
    // One read each, not one per candidate row.
    expect(m.fs.getDeviceSpace).toHaveBeenCalledTimes(1)
    expect(m.files.getUnuploadedBytes).toHaveBeenCalledTimes(1)
    // All three paced rows deferred.
    expect(result.deferred).toBe(3)
    expect(m.imports.claim).not.toHaveBeenCalled()
  })
})

describe('ImportScanner coded-deleted classification', () => {
  const codedDeleted = () => Object.assign(new Error('gone'), { code: 'deleted' })

  it('a non-media row is marked unavailable immediately', async () => {
    const m = createMocks({
      candidates: [fileRow({ id: 'e1', importId: 'imp1', sourceKind: 'ephemeral' })],
    })
    m.fs.importCopy.mockRejectedValueOnce(codedDeleted())
    const result = await scanner(m).runScan()
    expect(m.imports.markUnavailable).toHaveBeenCalledWith('e1', expect.any(String), 'deleted')
    expect(result.lost).toBe(1)
  })

  it('a media row re-verifies with verify:true; a still-alive asset backs off as source-missing', async () => {
    const m = createMocks({
      candidates: [fileRow({ id: 'm1', importId: 'imp1', sourceKind: 'media' })],
    })
    m.fs.importCopy.mockRejectedValueOnce(codedDeleted())
    const verifies: Array<boolean | undefined> = []
    const result = await scanner(m, {
      resolve: (_row, resolveOpts) => {
        verifies.push(resolveOpts?.verify)
        return { status: 'resolved', uri: 'ph://m1' }
      },
    }).runScan()
    // First call resolves for the copy; the recheck passes verify so a real
    // probe runs instead of a fabricated shortcut uri.
    expect(verifies).toEqual([undefined, true])
    expect(m.imports.markFailure).toHaveBeenCalledWith(
      'm1',
      expect.any(String),
      'source-missing',
      expect.any(Number),
      expect.any(String),
      expect.any(Number),
    )
    expect(result.failed).toBe(1)
  })

  it('a media row whose re-verify confirms deletion is marked unavailable as deleted', async () => {
    const m = createMocks({
      candidates: [fileRow({ id: 'm2', importId: 'imp1', sourceKind: 'media' })],
    })
    m.fs.importCopy.mockRejectedValueOnce(codedDeleted())
    const result = await scanner(m, {
      resolve: (_row, resolveOpts) =>
        resolveOpts?.verify ? { status: 'deleted' } : { status: 'resolved', uri: 'ph://m2' },
    }).runScan()
    expect(m.imports.markUnavailable).toHaveBeenCalledWith('m2', expect.any(String), 'deleted')
    expect(result.lost).toBe(1)
  })
})

describe('ImportScanner cold-start recovery', () => {
  it('first tick reclaims ALL orphaned claims; later ticks use the stale window', async () => {
    const m = createMocks({ candidates: [] })
    const s = scanner(m)
    await s.runScan()
    expect(m.imports.resetStale).toHaveBeenNthCalledWith(
      1,
      0,
      IMPORT_STALE_CLAIM_MS,
      expect.any(Number),
    )
    await s.runScan()
    expect(m.imports.resetStale).toHaveBeenNthCalledWith(
      2,
      IMPORT_STALE_CLAIM_MS,
      IMPORT_STALE_CLAIM_MS,
      expect.any(Number),
    )
  })
})

describe('ImportScanner copy concurrency (weighted pool)', () => {
  function gatedCopy(m: Mocks) {
    const started: string[] = []
    const gates = new Map<string, () => void>()
    m.fs.importCopy.mockImplementation(
      (file: { id: string }) =>
        new Promise((resolve) => {
          started.push(file.id)
          gates.set(file.id, () => resolve({ uri: `/local/${file.id}`, size: 9 }))
        }),
    )
    return { started, finish: (id: string) => gates.get(id)!() }
  }

  it('small files copy concurrently; releasing one admits the next', async () => {
    // Sizes are tiny so only the slot cap (4) binds: four admit at once and
    // the fifth admits when a slot frees.
    const rows = ['a', 'b', 'c', 'd', 'e'].map((id) => fileRow({ id, importId: 'imp1', size: 1 }))
    const m = createMocks({ candidates: rows })
    const { started, finish } = gatedCopy(m)
    const s = scanner(m)
    const run = s.runScan()

    await new Promise((r) => setTimeout(r, 0))
    expect(started).toEqual(['a', 'b', 'c', 'd']) // slot cap = 4
    finish('a')
    await new Promise((r) => setTimeout(r, 0))
    expect(started).toEqual(['a', 'b', 'c', 'd', 'e'])
    for (const id of ['b', 'c', 'd', 'e']) finish(id)
    const result = await run
    expect(result.finalized).toBe(5)
  })

  it('a budget-sized file runs alone; smaller rows wait for its budget', async () => {
    const rows = [
      fileRow({ id: 'big', importId: 'imp1', size: 256 * 1024 ** 2 }),
      fileRow({ id: 'small', importId: 'imp1', size: 1 }),
    ]
    const m = createMocks({ candidates: rows })
    const { started, finish } = gatedCopy(m)
    const s = scanner(m)
    const run = s.runScan()

    await new Promise((r) => setTimeout(r, 0))
    expect(started).toEqual(['big']) // big fills the budget; small waits
    finish('big')
    await new Promise((r) => setTimeout(r, 0))
    expect(started).toEqual(['big', 'small'])
    finish('small')
    const result = await run
    expect(result.finalized).toBe(2)
  })
})

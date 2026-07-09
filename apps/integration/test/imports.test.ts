import { createHash } from 'crypto'
import * as nodeFs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { IMPORT_MAX_ATTEMPTS } from '@siastorage/core/config'
import type { ImportFileRow, ImportRow, ImportSource } from '@siastorage/core/db/operations'
import {
  type CalculateContentHash,
  type GetMimeType,
  ImportScanner,
  type ResolveSource,
  type ResolveSourceResult,
} from '@siastorage/core/services/importScanner'
import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import { createTestApp, type TestApp } from './app'

/**
 * Integration coverage for the imports subsystem: the real `ImportScanner`
 * driven over a real `AppService` + better-sqlite3 + a real fs adapter.
 * Sources resolve to real temp files written with known bytes, so the
 * scanner's `app.fs.importCopy` copies real bytes into the id slot and the
 * hash is a real sha256 of those bytes. Nothing bypasses finalize.
 */

let idCounter = 0
function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${idCounter}-${Date.now()}`
}

describe('Imports lifecycle (integration)', () => {
  let app: TestApp
  let scanner: ImportScanner
  let sourceDir: string
  /** Maps an import_file id to its resolved temp source URI (or a non-resolved status). */
  let sources: Map<string, ResolveSourceResult>

  beforeEach(async () => {
    idCounter = 0
    app = createTestApp(createEmptyIndexerStorage())
    await app.start()
    // The test drives the scanner directly instead of on an interval, so
    // every finalize completes inside an awaited drainScanner call. Pausing
    // the harness scheduler keeps sync/thumb intervals from mutating files
    // mid-assertion.
    app.pause()

    sourceDir = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'import-src-'))
    sources = new Map()

    const resolveSource: ResolveSource = async (row) => {
      const resolved = sources.get(row.id)
      if (!resolved) throw new Error(`no source registered for import file ${row.id}`)
      return resolved
    }
    const calculateContentHash: CalculateContentHash = async (uri) => {
      const filePath = uri.replace(/^file:\/\//, '')
      if (!nodeFs.existsSync(filePath)) return null
      const bytes = nodeFs.readFileSync(filePath)
      return createHash('sha256').update(bytes).digest('hex')
    }
    const getMimeType: GetMimeType = async () => 'image/jpeg'

    scanner = new ImportScanner()
    scanner.initialize(app.app, calculateContentHash, getMimeType, resolveSource)
  })

  afterEach(async () => {
    scanner.reset()
    try {
      nodeFs.rmSync(sourceDir, { recursive: true })
    } catch {
      // ignore cleanup errors
    }
    await app.shutdown()
  })

  /** Writes `bytes` to a fresh temp file and returns its `file://` URI. */
  function writeSource(bytes: Buffer | string): string {
    const p = path.join(sourceDir, nextId('src'))
    nodeFs.writeFileSync(p, bytes)
    return `file://${p}`
  }

  function sha256(bytes: Buffer | string): string {
    return createHash('sha256').update(bytes).digest('hex')
  }

  function importRow(over: Partial<ImportRow> & { id: string; source: ImportSource }): ImportRow {
    return {
      directoryId: null,
      pendingTags: null,
      expectedCount: 0,
      dedupByHash: over.source === 'picker' ? 0 : 1,
      dirSourceRef: null,
      sealed: 1,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      ...over,
    }
  }

  function importFileRow(
    over: Partial<ImportFileRow> & { id: string; importId: string },
  ): ImportFileRow {
    const now = Date.now()
    return {
      state: 'pending',
      reason: null,
      name: 'photo.jpg',
      type: 'image/jpeg',
      size: 0,
      hash: null,
      createdAt: now,
      updatedAt: now,
      addedAt: now,
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

  /**
   * Drains the scanner: runs ticks until no pending candidate remains (or the
   * cap is hit). Each tick is the real claim-loop; this mirrors the scheduler
   * calling runScan repeatedly without coupling to real timers.
   */
  async function drainScanner(maxTicks = 20): Promise<void> {
    for (let i = 0; i < maxTicks; i++) {
      const result = await scanner.runScan()
      // A tick that touched nothing and has no ready candidate left means the
      // import is drained (every remaining row is terminal or parked).
      const ready = await app.app.imports.pendingFiles(100, Date.now())
      const touched =
        result.finalized + result.duplicate + result.failed + result.lost + result.skipped
      if (ready.length === 0 && touched === 0) return
    }
    // Failing here names the real problem; returning would let the caller's
    // next assertion fail on whatever half-drained state was left behind.
    throw new Error(`import did not drain within ${maxTicks} ticks`)
  }

  /** Look up one of an import's files by id; throws if the row is missing. */
  async function importFileById(importId: string, id: string): Promise<ImportFileRow> {
    const rows = await app.app.imports.files(importId)
    const row = rows.find((r) => r.id === id)
    if (!row) throw new Error(`import file ${id} not found in import ${importId}`)
    return row
  }

  it('finalizes a picker import file end-to-end from pending to added', async () => {
    const dir = await app.createDirectory('Trip')
    const bytes = Buffer.from('full-lifecycle bytes')
    const expectedHash = sha256(bytes)
    const fileId = nextId('if')
    const importId = nextId('imp')

    sources.set(fileId, { status: 'resolved', uri: writeSource(bytes) })

    await app.app.imports.create(
      importRow({ id: importId, source: 'picker', directoryId: dir.id }),
      [
        importFileRow({
          id: fileId,
          importId,
          name: 'sunset.jpg',
          directoryId: dir.id,
          mediaAssetId: 'asset-sunset',
        }),
      ],
    )

    await drainScanner()

    const row = await importFileById(importId, fileId)
    expect(row.state).toBe('added')
    expect(row.hash).toBe(expectedHash)

    // A real finalized files row exists, id reused verbatim, hash + mediaAssetId carried.
    const file = await app.getFileById(fileId)
    expect(file).not.toBeNull()
    expect(file!.id).toBe(fileId)
    expect(file!.hash).toBe(expectedHash)
    expect(file!.name).toBe('sunset.jpg')
    expect(file!.kind).toBe('file')
    expect(file!.mediaAssetId).toBe('asset-sunset')
    expect(file!.size).toBe(bytes.byteLength)

    const dirPath = await app.readDirectoryPathForFile(fileId)
    expect(dirPath).toBe(dir.path)

    // The id-slot bytes exist on disk (id reused; no move at finalize).
    const meta = await app.app.fs.readMeta(fileId)
    expect(meta?.size).toBe(bytes.byteLength)

    // Import summary derived as `done` (sealed + no in-flight child).
    const [summary] = await app.app.imports.summary([importId])
    expect(summary.status).toBe('done')
    expect(summary.added).toBe(1)
    expect(summary.inFlight).toBe(0)
  }, 30_000)

  it('marks a same-hash same-dir file `duplicate` and fs-cleans its bytes (dedupByHash=1)', async () => {
    const dir = await app.createDirectory('Photos')
    const bytes = Buffer.from('identical content for dedup')
    const expectedHash = sha256(bytes)

    // First import finalizes the file (goes through the SAME hash path).
    const firstFileId = nextId('if')
    const firstImportId = nextId('imp')
    sources.set(firstFileId, { status: 'resolved', uri: writeSource(bytes) })
    await app.app.imports.create(
      importRow({ id: firstImportId, source: 'library-scan', directoryId: dir.id, dedupByHash: 1 }),
      [
        importFileRow({
          id: firstFileId,
          importId: firstImportId,
          directoryId: dir.id,
          mediaAssetId: 'asset-orig',
        }),
      ],
    )
    await drainScanner()
    expect((await importFileById(firstImportId, firstFileId)).state).toBe('added')
    const original = await app.getFileById(firstFileId)
    expect(original!.hash).toBe(expectedHash)

    // Second import: identical bytes into the same dir with dedupByHash=1, a duplicate.
    const dupFileId = nextId('if')
    const dupImportId = nextId('imp')
    sources.set(dupFileId, { status: 'resolved', uri: writeSource(bytes) })
    await app.app.imports.create(
      importRow({ id: dupImportId, source: 'new-photos', directoryId: dir.id, dedupByHash: 1 }),
      [
        importFileRow({
          id: dupFileId,
          importId: dupImportId,
          directoryId: dir.id,
          mediaAssetId: 'asset-dup',
        }),
      ],
    )
    await drainScanner()

    const dupRow = await importFileById(dupImportId, dupFileId)
    expect(dupRow.state).toBe('duplicate')

    expect(await app.getFileById(dupFileId)).toBeNull()

    // The duplicate's id-slot bytes were fs-cleaned; the original's are untouched.
    expect(await app.app.fs.readMeta(dupFileId)).toBeNull()
    expect((await app.app.fs.readMeta(firstFileId))?.size).toBe(bytes.byteLength)

    const all = await app.getFiles()
    expect(all.filter((f) => f.hash === expectedHash && f.kind === 'file')).toHaveLength(1)
  }, 30_000)

  it('suppresses a same-mediaAssetId import in the same dir, but not in a different dir', async () => {
    const dirA = await app.createDirectory('DirA')
    const dirB = await app.createDirectory('DirB')

    // Seed: finalize an asset into dirA so files.mediaAssetId anchors it there.
    const seedId = nextId('if')
    const seedImportId = nextId('imp')
    sources.set(seedId, { status: 'resolved', uri: writeSource(Buffer.from('seed bytes')) })
    await app.app.imports.create(
      importRow({ id: seedImportId, source: 'library-scan', directoryId: dirA.id }),
      [
        importFileRow({
          id: seedId,
          importId: seedImportId,
          directoryId: dirA.id,
          mediaAssetId: 'asset-shared',
        }),
      ],
    )
    await drainScanner()
    expect((await importFileById(seedImportId, seedId)).state).toBe('added')

    // Import sources check identity first: the same mediaAssetId in dirA is suppressed...
    const suppressedInA = await app.app.imports.getByMediaAssetIds(['asset-shared'], dirA.id)
    expect(suppressedInA.has('asset-shared')).toBe(true)

    // ...but the same mediaAssetId targeting dirB is not suppressed (dir-scoped).
    const suppressedInB = await app.app.imports.getByMediaAssetIds(['asset-shared'], dirB.id)
    expect(suppressedInB.has('asset-shared')).toBe(false)

    // Drive the un-suppressed dirB import through the scanner: it finalizes a
    // second file (same asset, different dir) and both coexist.
    const bId = nextId('if')
    const bImportId = nextId('imp')
    sources.set(bId, { status: 'resolved', uri: writeSource(Buffer.from('dirB bytes')) })
    await app.app.imports.create(
      importRow({ id: bImportId, source: 'library-scan', directoryId: dirB.id }),
      [
        importFileRow({
          id: bId,
          importId: bImportId,
          directoryId: dirB.id,
          mediaAssetId: 'asset-shared',
        }),
      ],
    )
    await drainScanner()
    expect((await importFileById(bImportId, bId)).state).toBe('added')

    expect(await app.readDirectoryPathForFile(seedId)).toBe(dirA.path)
    expect(await app.readDirectoryPathForFile(bId)).toBe(dirB.path)
  }, 30_000)

  it('fails in-flight import files when their destination directory is deleted', async () => {
    const dir = await app.createDirectory('Doomed')

    // One file whose bytes are already copied (the scanner never runs in this
    // test) and one with no bytes yet; both rows in-flight when the dir dies.
    const copiedId = nextId('if')
    const pendingId = nextId('imp-file-pending')
    const importId = nextId('imp')
    const copiedBytes = Buffer.from('bytes copied before dir delete')

    await app.app.imports.create(
      importRow({ id: importId, source: 'picker', directoryId: dir.id }),
      [
        importFileRow({
          id: copiedId,
          importId,
          name: 'copied.jpg',
          directoryId: dir.id,
        }),
        importFileRow({
          id: pendingId,
          importId,
          name: 'pending.jpg',
          directoryId: dir.id,
        }),
      ],
    )

    // Copy real bytes into the `copiedId` slot without finalizing, so we can
    // assert its bytes are fs-cleaned on dir delete. (claimToken-less direct
    // copy via the facade, into the same id slot the scanner would write.)
    await app.app.fs.copyFile({ id: copiedId, type: 'image/jpeg' }, writeSource(copiedBytes), {
      usedAt: 0,
    })
    expect((await app.app.fs.readMeta(copiedId))?.size).toBe(copiedBytes.byteLength)

    expect((await importFileById(importId, copiedId)).state).toBe('pending')
    expect((await importFileById(importId, pendingId)).state).toBe('pending')

    // Delete the directory and trash its files; in-flight imports fail first.
    await app.app.directories.deleteAndTrashFiles(dir.id)

    expect(await app.app.directories.getById(dir.id)).toBeNull()

    const copiedRow = await importFileById(importId, copiedId)
    const pendingRow = await importFileById(importId, pendingId)
    expect(copiedRow.state).toBe('failed')
    expect(copiedRow.reason).toBe('destination-deleted')
    expect(pendingRow.state).toBe('failed')
    expect(pendingRow.reason).toBe('destination-deleted')

    // The copied id-slot bytes were fs-cleaned.
    expect(await app.app.fs.readMeta(copiedId)).toBeNull()

    // Neither reached `added`, so no files row was ever created for either.
    expect(await app.getFileById(copiedId)).toBeNull()
    expect(await app.getFileById(pendingId)).toBeNull()
  }, 30_000)

  it('marks a deleted source unavailable', async () => {
    const dir = await app.createDirectory('Gone')
    const fileId = nextId('if')
    const importId = nextId('imp')
    sources.set(fileId, { status: 'deleted' })

    await app.app.imports.create(
      importRow({ id: importId, source: 'picker', directoryId: dir.id }),
      [importFileRow({ id: fileId, importId, directoryId: dir.id })],
    )

    await drainScanner()

    const row = await importFileById(importId, fileId)
    expect(row.state).toBe('unavailable')
    expect(row.reason).toBe('deleted')
    expect(await app.getFileById(fileId)).toBeNull()

    // Summary derives `done` (sealed, only a terminal child) with an unavailable count.
    const [summary] = await app.app.imports.summary([importId])
    expect(summary.status).toBe('done')
    expect(summary.unavailable).toBe(1)
    expect(summary.added).toBe(0)
  }, 30_000)

  it('backs off a transiently-unavailable source and marks it unavailable after max attempts', async () => {
    const dir = await app.createDirectory('Cloud')
    const fileId = nextId('if')
    const importId = nextId('imp')
    sources.set(fileId, { status: 'unavailable' }) // transient: iCloud-not-downloaded style

    await app.app.imports.create(
      importRow({ id: importId, source: 'picker', directoryId: dir.id }),
      [importFileRow({ id: fileId, importId, directoryId: dir.id })],
    )

    // First tick: one transient failure backs off to pending with attempts=1.
    await scanner.runScan()
    let row = await importFileById(importId, fileId)
    expect(row.state).toBe('pending')
    expect(row.attempts).toBe(1)
    expect(row.nextAttemptAt).toBeGreaterThan(Date.now()) // persisted backoff

    // Exponential backoff parks the row in the future. Drive the full retry
    // cycle deterministically (no real timers): clear the backoff via `retry`
    // before each tick so the scanner re-claims it, until the attempt cap
    // lands it at terminal `unavailable`.
    for (let i = 0; i < IMPORT_MAX_ATTEMPTS + 4; i++) {
      const cur = await importFileById(importId, fileId)
      if (cur.state !== 'pending') break
      await app.app.imports.retry() // clears nextAttemptAt for backed-off rows
      await scanner.runScan()
    }

    row = await importFileById(importId, fileId)
    expect(row.state).toBe('unavailable')
    expect(row.attempts).toBeGreaterThanOrEqual(IMPORT_MAX_ATTEMPTS)
    expect(await app.getFileById(fileId)).toBeNull()
  }, 30_000)

  it('never writes an empty-hash files row across mixed outcomes', async () => {
    const dir = await app.createDirectory('Mixed')
    const addedId = nextId('if')
    const goneId = nextId('if')
    const importId = nextId('imp')
    sources.set(addedId, { status: 'resolved', uri: writeSource(Buffer.from('real')) })
    sources.set(goneId, { status: 'deleted' })

    await app.app.imports.create(
      importRow({ id: importId, source: 'picker', directoryId: dir.id }),
      [
        importFileRow({ id: addedId, importId, name: 'a.jpg', directoryId: dir.id }),
        importFileRow({ id: goneId, importId, name: 'b.jpg', directoryId: dir.id }),
      ],
    )
    await drainScanner()

    const files = await app.getFiles()
    expect(files.every((f) => f.kind !== 'file' || (f.hash && f.hash.length > 0))).toBe(true)
    expect(await app.getFileById(goneId)).toBeNull()
    expect(await app.getFileById(addedId)).not.toBeNull()
  }, 30_000)

  it('does not double-finalize when two ticks race the same row', async () => {
    const dir = await app.createDirectory('Concurrent')
    const fileId = nextId('if')
    const importId = nextId('imp')
    sources.set(fileId, { status: 'resolved', uri: writeSource(Buffer.from('concurrent')) })

    await app.app.imports.create(
      importRow({ id: importId, source: 'picker', directoryId: dir.id }),
      [importFileRow({ id: fileId, importId, directoryId: dir.id })],
    )

    // Two ticks race the same single pending row; the claim write only lands
    // for one of them.
    const [a, b] = await Promise.all([scanner.runScan(), scanner.runScan()])
    expect(a.finalized + b.finalized).toBe(1)
    await drainScanner()

    const row = await importFileById(importId, fileId)
    expect(row.state).toBe('added')
    const file = await app.getFileById(fileId)
    expect(file).not.toBeNull()
  }, 30_000)

  it('does not re-import an asset after its import is deleted', async () => {
    const dir = await app.createDirectory('Durable')
    const fileId = nextId('if')
    const importId = nextId('imp')
    sources.set(fileId, { status: 'resolved', uri: writeSource(Buffer.from('durable')) })

    await app.app.imports.create(
      importRow({ id: importId, source: 'library-scan', directoryId: dir.id }),
      [
        importFileRow({
          id: fileId,
          importId,
          directoryId: dir.id,
          mediaAssetId: 'asset-durable',
        }),
      ],
    )
    await drainScanner()
    expect((await importFileById(importId, fileId)).state).toBe('added')

    // Delete the import (CASCADE drops its import_files rows).
    await app.app.imports.delete(importId)
    expect(await app.app.imports.get(importId)).toBeNull()

    // The finalized files row + its mediaAssetId anchor survive.
    expect(await app.getFileById(fileId)).not.toBeNull()

    // Identity dedup still suppresses the asset (durable anchor is files.mediaAssetId).
    const suppressed = await app.app.imports.getByMediaAssetIds(['asset-durable'], dir.id)
    expect(suppressed.has('asset-durable')).toBe(true)
  }, 30_000)

  it('a staged source is consumed by the import and an interrupted retry finalizes from the id slot', async () => {
    const importId = nextId('imp')
    const stagedId = nextId('if')
    const stagedBytes = Buffer.from('staged move bytes')
    const stagedPath = path.join(sourceDir, 'staged-origin.jpg')
    nodeFs.writeFileSync(stagedPath, stagedBytes)

    await app.app.imports.create(importRow({ id: importId, source: 'share' }), [
      importFileRow({
        id: stagedId,
        importId,
        sourceKind: 'staged',
        sourceUri: `file://${stagedPath}`,
      }),
    ])
    sources.set(stagedId, { status: 'resolved', uri: `file://${stagedPath}` })

    await drainScanner()

    const row = await importFileById(importId, stagedId)
    expect(row.state).toBe('added')
    // The origin was moved, not copied: one byte-write, origin gone.
    expect(nodeFs.existsSync(stagedPath)).toBe(false)

    // Interrupted-after-copy shape: bytes at the id slot, row back to
    // pending, the (moved-away) source gone. The fast path must finalize
    // without resolving the source; resolving would misclassify a
    // recoverable row as deleted.
    const retryId = nextId('if')
    const retryImportId = nextId('imp')
    await app.app.imports.create(importRow({ id: retryImportId, source: 'share' }), [
      importFileRow({
        id: retryId,
        importId: retryImportId,
        sourceKind: 'staged',
        sourceUri: `file://${path.join(sourceDir, 'never-existed.jpg')}`,
      }),
    ])
    // Materialize the id-slot bytes directly (the interrupted copy's result).
    await app.app.fs.copyFile(
      { id: retryId, type: 'image/jpeg' },
      writeSource(Buffer.from('already copied bytes')),
      { usedAt: 0 },
    )
    // No resolver registration: resolveSource would throw for this row,
    // proving the fast path never asks for the source.
    await drainScanner()
    const retryRow = await importFileById(retryImportId, retryId)
    expect(retryRow.state).toBe('added')
  }, 30_000)
})

import { FS_ORPHAN_FREQUENCY } from '@siastorage/core/config'
import type { ImportFileRow, ImportRow } from '@siastorage/core/db/operations'
import { initializeDB, resetDb } from '../db'
import { app } from '../stores/appService'
import { cancelFsOrphanScanner, runFsOrphanScanner } from './fsOrphanScanner'

let listFilesSpy: jest.SpyInstance
let removeFileSpy: jest.SpyInstance
let removeByPathSpy: jest.SpyInstance

const now = 1_000_000_000

function importRow(over: Partial<ImportRow> & { id: string }): ImportRow {
  return {
    source: 'new-photos',
    directoryId: null,
    pendingTags: null,
    expectedCount: 0,
    dedupByHash: 1,
    dirSourceRef: null,
    sealed: 0,
    startedAt: now,
    updatedAt: now,
    ...over,
  }
}

function importFileRow(
  over: Partial<ImportFileRow> & { id: string; importId: string },
): ImportFileRow {
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

describe('fsOrphanScanner', () => {
  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(now)
    listFilesSpy = jest.spyOn(app().fs, 'listFiles').mockResolvedValue([])
    removeFileSpy = jest.spyOn(app().fs, 'removeFile').mockResolvedValue(undefined)
    removeByPathSpy = jest.spyOn(app().fs, 'removeFileByPath').mockResolvedValue(undefined)
    await initializeDB()
    await app().storage.setItem('fsOrphanLastRun', '0')
  })

  afterEach(async () => {
    jest.spyOn(Date, 'now').mockRestore()
    listFilesSpy.mockRestore()
    removeFileSpy.mockRestore()
    removeByPathSpy.mockRestore()
    await resetDb()
  })

  it('skips run when last run was recent', async () => {
    await app().storage.setItem('fsOrphanLastRun', String(now - FS_ORPHAN_FREQUENCY / 2))

    const result = await runFsOrphanScanner()

    expect(listFilesSpy).not.toHaveBeenCalled()
    expect(Number(await app().storage.getItem('fsOrphanLastRun'))).toBe(
      now - FS_ORPHAN_FREQUENCY / 2,
    )
    expect(result).toBeUndefined()
  })

  it('force bypasses the throttle check', async () => {
    await app().storage.setItem('fsOrphanLastRun', String(now - FS_ORPHAN_FREQUENCY / 2))

    await runFsOrphanScanner({ force: true })

    expect(listFilesSpy).toHaveBeenCalled()
    expect(Number(await app().storage.getItem('fsOrphanLastRun'))).toBe(now)
  })

  it('records timestamp even when there are no files', async () => {
    const result = await runFsOrphanScanner()

    expect(Number(await app().storage.getItem('fsOrphanLastRun'))).toBe(now)
    expect(result).toBeUndefined()
  })

  it('removes files that have no metadata entry', async () => {
    listFilesSpy.mockResolvedValue(['file-1.jpg'])

    const result = await runFsOrphanScanner()

    expect(removeFileSpy).toHaveBeenCalledTimes(1)
    expect(await app().fs.readMeta('file-1')).toBeNull()
    expect(Number(await app().storage.getItem('fsOrphanLastRun'))).toBe(now)
    expect(result).toEqual({ removed: 1 })
  })

  it('keeps files that still have metadata', async () => {
    listFilesSpy.mockResolvedValue(['file-2.jpg'])
    await app().files.create({
      id: 'file-2',
      name: 'file-2.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-file-2',
      createdAt: now,
      updatedAt: now,
      addedAt: now,
      mediaAssetId: null,
      trashedAt: null,
      deletedAt: null,
    })
    await app().fs.upsertMeta({
      fileId: 'file-2',
      size: 100,
      addedAt: now,
      usedAt: now,
    })

    const result = await runFsOrphanScanner()

    expect(removeFileSpy).not.toHaveBeenCalled()
    expect((await app().fs.readMeta('file-2'))?.fileId).toBe('file-2')
    expect(Number(await app().storage.getItem('fsOrphanLastRun'))).toBe(now)
    expect(result).toEqual({ removed: 0 })
  })

  it('deletes files that have no associated files table row', async () => {
    listFilesSpy.mockResolvedValue(['file-1.jpg'])
    await app().fs.upsertMeta({
      fileId: 'file-1',
      size: 100,
      addedAt: now,
      usedAt: now,
    })

    const result = await runFsOrphanScanner()

    expect(removeFileSpy).toHaveBeenCalledTimes(1)
    expect(await app().fs.readMeta('file-1')).toBeNull()
    expect(result).toEqual({ removed: 1 })
  })

  it('calls onProgress with correct removed/total counts', async () => {
    listFilesSpy.mockResolvedValue(['a.jpg', 'b.jpg', 'c.jpg'])
    await app().files.create({
      id: 'b',
      name: 'b.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-b',
      createdAt: now,
      updatedAt: now,
      addedAt: now,
      mediaAssetId: null,
      trashedAt: null,
      deletedAt: null,
    })
    await app().fs.upsertMeta({
      fileId: 'b',
      size: 100,
      addedAt: now,
      usedAt: now,
    })

    const onProgress = jest.fn()
    await runFsOrphanScanner({ onProgress })

    expect(onProgress).toHaveBeenCalledWith(2, 3)
  })

  it('correctly identifies orphaned and non-orphaned files in batch', async () => {
    await app().files.create({
      id: 'keep-1',
      name: 'keep-1.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-keep-1',
      createdAt: now,
      updatedAt: now,
      addedAt: now,
      mediaAssetId: null,
      trashedAt: null,
      deletedAt: null,
    })
    await app().fs.upsertMeta({
      fileId: 'keep-1',
      size: 100,
      addedAt: now,
      usedAt: now,
    })

    const orphaned = await app().fs.findOrphanedFileIds(['keep-1', 'orphan-1', 'orphan-2'])

    expect(orphaned.has('keep-1')).toBe(false)
    expect(orphaned.has('orphan-1')).toBe(true)
    expect(orphaned.has('orphan-2')).toBe(true)
    expect(orphaned.size).toBe(2)
  })

  it('treats tombstoned files as orphaned', async () => {
    listFilesSpy.mockResolvedValue(['file-tomb.jpg'])
    await app().files.create({
      id: 'file-tomb',
      name: 'file-tomb.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-tomb',
      createdAt: now,
      updatedAt: now,
      addedAt: now,
      mediaAssetId: null,
      trashedAt: now,
      deletedAt: now,
    })
    await app().fs.upsertMeta({
      fileId: 'file-tomb',
      size: 100,
      addedAt: now,
      usedAt: now,
    })

    const result = await runFsOrphanScanner()

    expect(removeFileSpy).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ removed: 1 })
  })

  it('processes large file lists across multiple batches', async () => {
    const uris = Array.from({ length: 60 }, (_, i) => `file-${i}.jpg`)
    listFilesSpy.mockResolvedValue(uris)

    const result = await runFsOrphanScanner()

    expect(result).toEqual({ removed: 60 })
  })

  it('does not advance lastRun when aborted mid-scan', async () => {
    listFilesSpy.mockResolvedValue(['orphan-1.jpg'])
    const findSpy = jest.spyOn(app().fs, 'findOrphanedFileIds').mockImplementationOnce(async () => {
      cancelFsOrphanScanner()
      return new Set<string>()
    })

    try {
      const result = await runFsOrphanScanner()
      expect(result).toEqual({ removed: 0 })
      expect(Number(await app().storage.getItem('fsOrphanLastRun'))).toBe(0)
    } finally {
      findSpy.mockRestore()
    }
  })

  it('does NOT sweep a claim temp whose base id still has a non-terminal import_files row', async () => {
    // A live in-progress copy: `<id>.<token>.tmp`. Its base id ('live') has a
    // non-terminal (active) import_files row, so findOrphanedFileIds exempts it.
    // (The mtime gate that withholds recent temps lives in the fsIO adapter's
    // list(); here listFiles is mocked, so the non-terminal exemption is what
    // protects it.)
    listFilesSpy.mockResolvedValue(['live.tok123.tmp'])
    await app().imports.create(importRow({ id: 'imp1' }), [
      importFileRow({ id: 'live', importId: 'imp1', state: 'active', claimToken: 'tok123' }),
    ])

    const result = await runFsOrphanScanner()

    expect(removeByPathSpy).not.toHaveBeenCalled()
    expect(removeFileSpy).not.toHaveBeenCalled()
    expect(result).toEqual({ removed: 0 })
  })

  it('sweeps a stale orphan claim temp whose base id has no non-terminal row, by literal path', async () => {
    // An abandoned temp: its base id ('gone') has no non-terminal import_files
    // row (the row finalized under a different claim and is now `added`). It's
    // swept by its literal `.tmp` path (removeFileByPath), not by id+type.
    listFilesSpy.mockResolvedValue(['gone.stale456.tmp'])
    await app().imports.create(importRow({ id: 'imp2' }), [
      importFileRow({ id: 'gone', importId: 'imp2', state: 'added' }),
    ])

    const result = await runFsOrphanScanner()

    expect(removeByPathSpy).toHaveBeenCalledWith('gone.stale456.tmp')
    expect(removeFileSpy).not.toHaveBeenCalled()
    expect(result).toEqual({ removed: 1 })
  })

  it('handles absolute paths from the adapter: exempts a live temp, sweeps an orphan by full path', async () => {
    // The mobile adapter's listFiles returns absolute paths, not basenames. The id
    // extraction must strip the directory or the live-copy exemption never matches
    // and a copy in progress would be deleted mid-import.
    listFilesSpy.mockResolvedValue([
      '/data/app/files/live.tok123.tmp',
      '/data/app/files/gone.stale456.tmp',
    ])
    await app().imports.create(importRow({ id: 'imp3' }), [
      importFileRow({ id: 'live', importId: 'imp3', state: 'active', claimToken: 'tok123' }),
      importFileRow({ id: 'gone', importId: 'imp3', state: 'added' }),
    ])

    const result = await runFsOrphanScanner()

    expect(removeByPathSpy).toHaveBeenCalledWith('/data/app/files/gone.stale456.tmp')
    expect(removeByPathSpy).toHaveBeenCalledTimes(1)
    expect(removeFileSpy).not.toHaveBeenCalled()
    expect(result).toEqual({ removed: 1 })
  })

  it('sweeps a stale claim temp even after its base id finalized into a files row', async () => {
    // A copy that lost its claim leaves `<id>.<oldToken>.tmp`; a retry under a
    // fresh claim then finalizes the id into a real files row. The temp must be
    // judged by in-flight import rows alone, or the files row protects the
    // leftover temp forever.
    listFilesSpy.mockResolvedValue(['/data/app/files/leak.oldtok.tmp'])
    await app().imports.create(importRow({ id: 'imp4' }), [
      importFileRow({ id: 'leak', importId: 'imp4', state: 'added' }),
    ])
    await app().files.create({
      id: 'leak',
      name: 'leak.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 4,
      hash: 'abc',
      createdAt: now,
      updatedAt: now,
      addedAt: now,
      mediaAssetId: null,
      trashedAt: null,
      deletedAt: null,
    })

    const result = await runFsOrphanScanner()

    expect(removeByPathSpy).toHaveBeenCalledWith('/data/app/files/leak.oldtok.tmp')
    expect(result).toEqual({ removed: 1 })
  })

  it('coalesces concurrent calls into a single scan', async () => {
    let resolveList!: (value: string[]) => void
    listFilesSpy.mockReturnValue(
      new Promise<string[]>((r) => {
        resolveList = r
      }),
    )

    const call1 = runFsOrphanScanner()
    const call2 = runFsOrphanScanner()

    resolveList(['orphan.jpg'])

    const [result1, result2] = await Promise.all([call1, call2])

    expect(listFilesSpy).toHaveBeenCalledTimes(1)
    expect(result1).toEqual({ removed: 1 })
    expect(result2).toEqual({ removed: 1 })
  })
})

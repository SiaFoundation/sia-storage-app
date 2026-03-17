import { FS_ORPHAN_FREQUENCY } from '@siastorage/core/config'
import { initializeDB, resetDb } from '../db'
import { app } from '../stores/appService'
import { runFsOrphanScanner } from './fsOrphanScanner'

let listFilesSpy: jest.SpyInstance
let removeFileSpy: jest.SpyInstance

const now = 1_000_000_000

describe('fsOrphanScanner', () => {
  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(now)
    listFilesSpy = jest.spyOn(app().fs, 'listFiles').mockResolvedValue([])
    removeFileSpy = jest
      .spyOn(app().fs, 'removeFile')
      .mockResolvedValue(undefined)
    await initializeDB()
    await app().storage.setItem('fsOrphanLastRun', '0')
  })

  afterEach(async () => {
    jest.spyOn(Date, 'now').mockRestore()
    listFilesSpy.mockRestore()
    removeFileSpy.mockRestore()
    await resetDb()
  })

  it('skips run when last run was recent', async () => {
    await app().storage.setItem(
      'fsOrphanLastRun',
      String(now - FS_ORPHAN_FREQUENCY / 2),
    )

    const result = await runFsOrphanScanner()

    expect(listFilesSpy).not.toHaveBeenCalled()
    expect(Number(await app().storage.getItem('fsOrphanLastRun'))).toBe(
      now - FS_ORPHAN_FREQUENCY / 2,
    )
    expect(result).toBeUndefined()
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
      localId: null,
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
      localId: null,
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
      localId: null,
      trashedAt: null,
      deletedAt: null,
    })
    await app().fs.upsertMeta({
      fileId: 'keep-1',
      size: 100,
      addedAt: now,
      usedAt: now,
    })

    const orphaned = await app().fs.findOrphanedFileIds([
      'keep-1',
      'orphan-1',
      'orphan-2',
    ])

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
      localId: null,
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
})

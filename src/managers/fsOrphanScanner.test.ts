import type { File } from 'expo-file-system'
import { FS_ORPHAN_FREQUENCY } from '../config'
import { initializeDB, resetDb } from '../db'
import {
  getAsyncStorageNumber,
  setAsyncStorageNumber,
} from '../stores/asyncStore'
import { createFileRecord } from '../stores/files'
import {
  listFilesInFsStorageDirectory,
  readFsFileMetadata,
  upsertFsFileMetadata,
} from '../stores/fs'
import { findOrphanedFileIds, runFsOrphanScanner } from './fsOrphanScanner'

const listFilesInFsStorageDirectoryMock = jest.mocked(
  listFilesInFsStorageDirectory,
)

function makeFile(name: string): jest.Mocked<File> {
  return {
    name,
    uri: `file://${name}`,
    delete: jest.fn(),
  } as unknown as jest.Mocked<File>
}

const now = 1_000_000_000

describe('fsOrphanScanner', () => {
  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(now)
    listFilesInFsStorageDirectoryMock.mockImplementation(() => [])
    await initializeDB()
    await setAsyncStorageNumber('fsOrphanLastRun', 0)
  })

  afterEach(async () => {
    jest.spyOn(Date, 'now').mockRestore()
    listFilesInFsStorageDirectoryMock.mockRestore()
    await resetDb()
  })

  it('skips run when last run was recent', async () => {
    await setAsyncStorageNumber(
      'fsOrphanLastRun',
      now - FS_ORPHAN_FREQUENCY / 2,
    )

    const result = await runFsOrphanScanner()

    expect(listFilesInFsStorageDirectoryMock).not.toHaveBeenCalled()
    expect(await getAsyncStorageNumber('fsOrphanLastRun', 0)).toBe(
      now - FS_ORPHAN_FREQUENCY / 2,
    )
    expect(result).toBeUndefined()
  })

  it('records timestamp even when there are no files', async () => {
    const result = await runFsOrphanScanner()

    expect(await getAsyncStorageNumber('fsOrphanLastRun', 0)).toBe(now)
    expect(result).toBeUndefined()
  })

  it('removes files that have no metadata entry', async () => {
    const file = makeFile('file-1.jpg')
    listFilesInFsStorageDirectoryMock.mockImplementation(() => [file])

    const result = await runFsOrphanScanner()

    expect(file.delete).toHaveBeenCalledTimes(1)
    expect(await readFsFileMetadata('file-1')).toBeNull()
    expect(await getAsyncStorageNumber('fsOrphanLastRun', 0)).toBe(now)
    expect(result).toEqual({ removed: 1 })
  })

  it('keeps files that still have metadata', async () => {
    const file = makeFile('file-2.jpg')
    listFilesInFsStorageDirectoryMock.mockImplementation(() => [file])
    await createFileRecord({
      id: 'file-2',
      name: 'file-2.jpg',
      type: 'image/jpeg',
      size: 100,
      hash: 'hash-file-2',
      createdAt: now,
      updatedAt: now,
      addedAt: now,
      localId: null,
    })
    await upsertFsFileMetadata({
      fileId: 'file-2',
      size: 100,
      addedAt: now,
      usedAt: now,
    })

    const result = await runFsOrphanScanner()

    expect(file.delete).not.toHaveBeenCalled()
    expect((await readFsFileMetadata('file-2'))?.fileId).toBe('file-2')
    expect(await getAsyncStorageNumber('fsOrphanLastRun', 0)).toBe(now)
    expect(result).toEqual({ removed: 0 })
  })

  it('deletes files that have no associated files table row', async () => {
    const file = makeFile('file-1.jpg')
    listFilesInFsStorageDirectoryMock.mockImplementation(() => [file])
    await upsertFsFileMetadata({
      fileId: 'file-1',
      size: 100,
      addedAt: now,
      usedAt: now,
    })

    const result = await runFsOrphanScanner()

    expect(file.delete).toHaveBeenCalledTimes(1)
    expect(await readFsFileMetadata('file-1')).toBeNull()
    expect(result).toEqual({ removed: 1 })
  })

  it('calls onProgress with correct removed/total counts', async () => {
    const files = [makeFile('a.jpg'), makeFile('b.jpg'), makeFile('c.jpg')]
    listFilesInFsStorageDirectoryMock.mockImplementation(() => files)
    await createFileRecord({
      id: 'b',
      name: 'b.jpg',
      type: 'image/jpeg',
      size: 100,
      hash: 'hash-b',
      createdAt: now,
      updatedAt: now,
      addedAt: now,
      localId: null,
    })
    await upsertFsFileMetadata({
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
    await createFileRecord({
      id: 'keep-1',
      name: 'keep-1.jpg',
      type: 'image/jpeg',
      size: 100,
      hash: 'hash-keep-1',
      createdAt: now,
      updatedAt: now,
      addedAt: now,
      localId: null,
    })
    await upsertFsFileMetadata({
      fileId: 'keep-1',
      size: 100,
      addedAt: now,
      usedAt: now,
    })

    const orphaned = await findOrphanedFileIds([
      'keep-1',
      'orphan-1',
      'orphan-2',
    ])

    expect(orphaned.has('keep-1')).toBe(false)
    expect(orphaned.has('orphan-1')).toBe(true)
    expect(orphaned.has('orphan-2')).toBe(true)
    expect(orphaned.size).toBe(2)
  })

  it('yields between batches via setTimeout', async () => {
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout')
    const files = Array.from({ length: 60 }, (_, i) =>
      makeFile(`file-${i}.jpg`),
    )
    listFilesInFsStorageDirectoryMock.mockImplementation(() => files)

    const result = await runFsOrphanScanner()

    // 60 files / 50 per batch = 2 batches, each yields via setTimeout
    const yieldCalls = setTimeoutSpy.mock.calls.filter(([, ms]) => ms === 0)
    expect(yieldCalls.length).toBe(2)
    expect(result).toEqual({ removed: 60 })
    setTimeoutSpy.mockRestore()
  })
})

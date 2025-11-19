import { FS_ORPHAN_FREQUENCY } from '../config'
import { runFsOrphanScanner } from './fsOrphanScanner'
import { initializeDB, resetDb } from '../db'
import {
  readFsFileMetadata,
  upsertFsFileMetadata,
  listFilesInFsStorageDirectory,
} from '../stores/fs'
import { createFileRecord } from '../stores/files'
import {
  getSecureStoreNumber,
  setSecureStoreNumber,
} from '../stores/secureStore'
import { File } from 'expo-file-system'

const listFilesInFsStorageDirectoryMock = jest.mocked(
  listFilesInFsStorageDirectory
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
    await setSecureStoreNumber('fsOrphanLastRun', 0)
  })

  afterEach(async () => {
    jest.spyOn(Date, 'now').mockRestore()
    listFilesInFsStorageDirectoryMock.mockRestore()
    await resetDb()
  })

  it('skips run when last run was recent', async () => {
    await setSecureStoreNumber('fsOrphanLastRun', now - FS_ORPHAN_FREQUENCY / 2)

    const result = await runFsOrphanScanner()

    expect(listFilesInFsStorageDirectoryMock).not.toHaveBeenCalled()
    expect(await getSecureStoreNumber('fsOrphanLastRun', 0)).toBe(
      now - FS_ORPHAN_FREQUENCY / 2
    )
    expect(result).toBeUndefined()
  })

  it('records timestamp even when there are no files', async () => {
    const result = await runFsOrphanScanner()

    expect(await getSecureStoreNumber('fsOrphanLastRun', 0)).toBe(now)
    expect(result).toBeUndefined()
  })

  it('removes files that have no metadata entry', async () => {
    const file = makeFile('file-1.jpg')
    listFilesInFsStorageDirectoryMock.mockImplementation(() => [file])

    const result = await runFsOrphanScanner()

    expect(file.delete).toHaveBeenCalledTimes(1)
    expect(await readFsFileMetadata('file-1')).toBeNull()
    expect(await getSecureStoreNumber('fsOrphanLastRun', 0)).toBe(now)
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
    expect(await getSecureStoreNumber('fsOrphanLastRun', 0)).toBe(now)
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
})

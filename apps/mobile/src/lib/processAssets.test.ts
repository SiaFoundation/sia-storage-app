import { db, initializeDB, resetDb } from '../db'
import { readAllDirectoriesWithCounts } from '../stores/directories'
import {
  createFileRecord,
  readAllFileRecords,
  readFileRecord,
} from '../stores/files'
import { copyFileToFs, readFsFileMetadata } from '../stores/fs'
import { setPhotoImportDirectory } from '../stores/settings'
import { calculateContentHash } from './contentHash'
import { getMimeType } from './fileTypes'
import { getMediaLibraryUri } from './mediaLibrary'
import { processAssets } from './processAssets'

jest.mock('./deleteFile', () => ({
  permanentlyDeleteFiles: jest.fn(),
}))
jest.mock('./mediaLibrary', () => ({
  getMediaLibraryUri: jest.fn(),
}))
jest.mock('./contentHash', () => ({
  calculateContentHash: jest.fn(async (uri) => `sha256:hash:${uri}`),
}))
jest.mock('../managers/thumbnailer', () => ({
  generateThumbnails: jest.fn(),
}))
jest.mock('./fileTypes', () => {
  const actual = jest.requireActual('./fileTypes')
  return { ...actual, getMimeType: jest.fn(actual.getMimeType) }
})

beforeEach(async () => {
  await initializeDB()
  jest.spyOn(require('../stores/files'), 'createFileRecord')
  jest.spyOn(require('../stores/fs'), 'upsertFsFileMetadata')
  jest.spyOn(require('../stores/fs'), 'copyFileToFs')
  jest.clearAllMocks()
})

afterEach(async () => {
  await resetDb()
  jest.restoreAllMocks()
  jest.clearAllMocks()
})

describe('processAssets', () => {
  it('creates a new record when no duplicates exist', async () => {
    const assets = [
      {
        id: '1',
        name: 'a.jpg',
        sourceUri: 'file://1',
        type: 'image/jpeg',
        timestamp: '2021-01-01',
      },
    ]

    const fileId = 'uid-1'

    const { files } = await processAssets(assets)
    expect(files).toHaveLength(1)
    const rows = await readAllFileRecords({ order: 'ASC' })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: fileId,
      name: 'a.jpg',
    })
    const meta = await readFsFileMetadata(fileId)
    expect(meta).toMatchObject({
      fileId,
    })
  })
  it('updates existing by localId and does not create new records', async () => {
    await createFileRecord(
      {
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
      },
      false,
    )

    jest.mocked(getMediaLibraryUri).mockImplementation(async (localId) => {
      if (localId === '1') return 'file://1'
      return null
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
    const { files, updatedFiles } = await processAssets(assets)

    expect(updatedFiles).toHaveLength(1)
    expect(files).toHaveLength(0)
    // Should not hash when localId duplicate is detected.
    expect(calculateContentHash).not.toHaveBeenCalled()
    const updated = await readFileRecord('existing-1')
    expect(updated).toMatchObject({
      id: 'existing-1',
      name: 'new.jpg',
      size: 5,
    })
    expect(copyFileToFs).toHaveBeenCalledTimes(0)
  })
  it('skipExistingUpdates does not update existing records', async () => {
    await createFileRecord(
      {
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
      },
      false,
    )

    jest.mocked(getMediaLibraryUri).mockImplementation(async (localId) => {
      if (localId === '1') return 'file://1'
      return null
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
    const { files, updatedFiles } = await processAssets(assets, 'file', {
      skipExistingUpdates: true,
    })

    expect(updatedFiles).toHaveLength(1)
    expect(files).toHaveLength(0)
    const record = await readFileRecord('existing-1')
    expect(record).toMatchObject({
      id: 'existing-1',
      name: 'old.jpg',
      updatedAt: 1,
    })
  })
  it('allowDuplicates bypasses localId dedup', async () => {
    await createFileRecord(
      {
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
      },
      false,
    )

    jest.mocked(getMediaLibraryUri).mockImplementation(async (localId) => {
      if (localId === '1') return 'file://1'
      return null
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
    const { files } = await processAssets(assets, 'file', {
      allowDuplicates: true,
    })

    expect(files).toHaveLength(1)
  })
  it('blocks content hash duplicates during auto-sync', async () => {
    await createFileRecord(
      {
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
      },
      false,
    )

    jest
      .mocked(calculateContentHash)
      .mockImplementation(async () => 'sha256:existing-hash')
    const assets = [
      {
        id: 'same-hash',
        name: 'same-hash.jpg',
        sourceUri: 'file://same-hash.jpg',
        type: 'image/jpeg',
        timestamp: '2021-01-01',
      },
    ]
    const { files, updatedFiles } = await processAssets(assets)

    expect(files).toHaveLength(0)
    expect(updatedFiles).toHaveLength(1)
    expect(updatedFiles[0]).toMatchObject({ id: 'existing' })
  })
  it('allowDuplicates bypasses content hash dedup', async () => {
    await createFileRecord(
      {
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
      },
      false,
    )

    jest
      .mocked(calculateContentHash)
      .mockImplementation(async () => 'sha256:existing-hash')
    const assets = [
      {
        id: undefined,
        name: 'same-hash.jpg',
        sourceUri: 'file://same-hash.jpg',
        type: 'image/jpeg',
        timestamp: '2021-01-01',
      },
    ]
    const { files, warnings } = await processAssets(assets, 'file', {
      allowDuplicates: true,
    })

    expect(files).toHaveLength(1)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/already exist/)
  })
  it('allows importing multiple files with same hash', async () => {
    jest.mocked(getMediaLibraryUri).mockImplementation(async () => {
      return null
    })
    jest
      .mocked(calculateContentHash)
      .mockImplementation(async () => 'sha256:same-for-all')
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

    const { files } = await processAssets(assets)
    expect(files).toHaveLength(2)
  })
  it('grabs the highest quality file when localId is valid', async () => {
    jest.mocked(getMediaLibraryUri).mockImplementation(async () => {
      return 'file:///full-quality.jpg'
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

    const { files } = await processAssets(assets)

    expect(files).toHaveLength(1)
    expect(getMediaLibraryUri).toHaveBeenCalledTimes(1)
    expect(getMediaLibraryUri).toHaveBeenCalledWith('valid')

    expect(copyFileToFs).toHaveBeenCalledTimes(1)
    expect(copyFileToFs).toHaveBeenCalledWith(
      expect.objectContaining({ id: files[0].id, type: 'image/jpeg' }),
      expect.objectContaining({ uri: 'file:///full-quality.jpg' }),
    )
  })
  it('uses sourceUri when localId is not valid', async () => {
    jest.mocked(getMediaLibraryUri).mockImplementation(async () => {
      return null
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

    const { files } = await processAssets(assets)

    expect(files).toHaveLength(1)
    expect(getMediaLibraryUri).toHaveBeenCalledTimes(1)
    expect(getMediaLibraryUri).toHaveBeenCalledWith('invalid')
    expect(copyFileToFs).toHaveBeenCalledTimes(1)
    const file = await readFileRecord(files[0].id)
    expect(file).toMatchObject({
      id: files[0].id,
    })
    const meta = await readFsFileMetadata(files[0].id)
    expect(meta).toMatchObject({
      fileId: files[0].id,
    })
  })
  it('does not auto-move files by default', async () => {
    await setPhotoImportDirectory('Camera Roll')
    const assets = [
      {
        id: undefined,
        name: 'photo.jpg',
        sourceUri: 'file:///photo.jpg',
        type: 'image/jpeg',
        timestamp: '2021-01-01',
      },
    ]
    const { files } = await processAssets(assets)
    expect(files).toHaveLength(1)
    const row = await db().getFirstAsync<{ directoryId: string | null }>(
      'SELECT directoryId FROM files WHERE id = ?',
      files[0].id,
    )
    expect(row?.directoryId).toBeNull()
    const dirs = await readAllDirectoriesWithCounts()
    expect(dirs).toHaveLength(0)
  })
  it('addToImportDirectory moves media files to photo import directory', async () => {
    await setPhotoImportDirectory('Camera Roll')
    const assets = [
      {
        id: undefined,
        name: 'photo.jpg',
        sourceUri: 'file:///photo.jpg',
        type: 'image/jpeg',
        timestamp: '2021-01-01',
      },
    ]
    const { files } = await processAssets(assets, 'file', {
      addToImportDirectory: true,
    })
    expect(files).toHaveLength(1)
    const row = await db().getFirstAsync<{ directoryId: string | null }>(
      'SELECT directoryId FROM files WHERE id = ?',
      files[0].id,
    )
    expect(row?.directoryId).toBeTruthy()
    const dirs = await readAllDirectoriesWithCounts()
    expect(dirs).toHaveLength(1)
    expect(dirs[0].name).toBe('Camera Roll')
  })
  it('re-detects MIME type from local file when initial detection returns octet-stream', async () => {
    jest.mocked(getMediaLibraryUri).mockImplementation(async () => {
      return 'file:///local/photo'
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

    const { files } = await processAssets(assets)
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
  it('adds file size to new files', async () => {
    const { rnfsStat } = (
      global as unknown as { __rnfs: { rnfsStat: jest.Mock } }
    ).__rnfs
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
    const { files } = await processAssets(assets)
    expect(files).toHaveLength(1)
    expect(files[0].size).toBe(333)
  })
})

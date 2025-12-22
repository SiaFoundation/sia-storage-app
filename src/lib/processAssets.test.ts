import { processAssets } from './processAssets'
import { calculateContentHash } from './contentHash'
import {
  createFileRecord,
  readAllFileRecords,
  readFileRecord,
} from '../stores/files'
import { initializeDB, resetDb } from '../db'
import {
  copyFileToFs,
  readFsFileMetadata,
  upsertFsFileMetadata,
} from '../stores/fs'
import { getMediaLibraryUri } from './mediaLibrary'
import { setExpoFileSystemMockMethods } from '../../mocks/expo-file-system'

jest.mock('./mediaLibrary', () => ({
  getMediaLibraryUri: jest.fn(),
}))
jest.mock('./contentHash', () => ({
  calculateContentHash: jest.fn(async (uri: string) => `sha256:hash:${uri}`),
}))
jest.mock('../managers/thumbnailer', () => ({
  generateThumbnails: jest.fn(),
}))

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
        localId: '1',
        hash: '',
        addedAt: 1,
      },
      false
    )

    jest
      .mocked(getMediaLibraryUri)
      .mockImplementation(async (localId: string | null) => {
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
  it('updates and copies existing by hash but does not create a new record', async () => {
    await createFileRecord(
      {
        id: 'existing',
        name: 'existing.jpg',
        size: 10,
        createdAt: 1,
        updatedAt: 1,
        type: 'image/jpeg',
        hash: 'sha256:existing-hash',
        localId: null,
        addedAt: 1,
      },
      false
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
    const updated = await readFileRecord('existing')
    expect(updated).toMatchObject({
      id: 'existing',
      name: 'same-hash.jpg',
    })
    expect(copyFileToFs).toHaveBeenCalledTimes(1)
    expect(copyFileToFs).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'existing' }),
      expect.objectContaining({ uri: 'file://same-hash.jpg' })
    )
  })
  it('dedupes on hash within new files', async () => {
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
    expect(files).toHaveLength(1)
    const file = await readFileRecord(files[0].id)
    expect(file).toMatchObject({
      type: 'image/jpeg',
    })
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
      expect.objectContaining({ uri: 'file:///full-quality.jpg' })
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
  it('adds file size to new files', async () => {
    setExpoFileSystemMockMethods({
      File: {
        info: jest.fn((uri: string) => ({ exists: true, size: 333, uri })),
      },
    })
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

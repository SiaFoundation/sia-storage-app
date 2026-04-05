import { db, initializeDB, resetDb } from '../db'
import { app } from '../stores/appService'
import { copyFileToFs } from '../stores/fs'
import { calculateContentHash } from './contentHash'
import { getMimeType } from './fileTypes'
import { getMediaLibraryUri } from './mediaLibrary'
import { catalogAssets, importFiles, syncAssets } from './processAssets'

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
jest.mock('../managers/importScanner', () => ({
  triggerImportScanner: jest.fn(),
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

describe('importFiles — user-initiated manual import', () => {
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

      const placeholders = await importFiles(assets)

      expect(placeholders).toHaveLength(1)
      expect(placeholders[0]).toMatchObject({
        name: 'large.zip',
        hash: '',
        size: 100_000_000,
        kind: 'file',
      })

      const row = await app().files.getById(placeholders[0].id)
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

      const placeholders = await importFiles(assets)

      expect(placeholders).toHaveLength(1)
      const row = await app().files.getById(placeholders[0].id)
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

      const placeholders = await importFiles(assets)
      expect(placeholders).toHaveLength(3)

      expect(placeholders[2].localId).toBe('local-id-3')

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

      const placeholders = await importFiles(assets)
      expect(placeholders).toHaveLength(0)
      expect(copyFileToFs).not.toHaveBeenCalled()
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

      const placeholders = await importFiles(assets)

      await new Promise((r) => setTimeout(r, 0))

      expect(copyFileToFs).toHaveBeenCalledTimes(1)
      expect(copyFileToFs).toHaveBeenCalledWith(
        expect.objectContaining({ id: placeholders[0].id }),
        'file:///tmp/doc.pdf',
      )
    })
  })

  describe('scanner integration', () => {
    it('triggers the import scanner so hashing starts promptly', async () => {
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

      await importFiles(assets)
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
        return null
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
})

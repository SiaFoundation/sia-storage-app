import { processAssets } from './processAssets'
import { calculateContentHash } from './contentHash'
import {
  createFileRecord,
  readAllFileRecords,
  readFileRecord,
  type FileRecord,
} from '../stores/files'
import { initializeDB, resetDb } from '../db'
import { copyFileToCache } from '../stores/fileCache'

// Deterministic ids.
jest.mock('./uniqueId', () => {
  let c = 0
  return { uniqueId: () => `uid-${++c}` }
})

jest.mock('./contentHash', () => ({
  calculateContentHash: jest.fn(
    async (uri: string) => `sha256|BYTESv1|hash:${uri}`
  ),
}))
jest.mock('../stores/fileCache', () => ({
  getLocalUri: jest.fn(async (localId: string | null) =>
    localId ? `file://${localId}` : null
  ),
  copyFileToCache: jest.fn(async () => 'file://cache/mock'),
}))
jest.mock('expo-file-system', () => ({
  File: jest.fn((uri: string) => ({ uri })),
}))

beforeAll(async () => {
  await initializeDB()
})
beforeEach(() => {
  jest.clearAllMocks()
})
afterEach(async () => {
  await resetDb()
})

describe('processAssets', () => {
  it('creates a new record when no duplicates exist', async () => {
    const assets = [
      {
        id: '1',
        fileName: 'a.jpg',
        fileSize: 100,
        sourceUri: 'file://1',
        fileType: 'image/jpeg',
        timestamp: '2021-01-01',
      },
    ]

    const { files } = await processAssets(assets)

    expect(files).toHaveLength(1)
    const rows = await readAllFileRecords({ order: 'ASC' })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'uid-1',
      fileName: 'a.jpg',
      fileSize: 100,
    })
    expect(copyFileToCache).not.toHaveBeenCalled()
  })

  it('updates existing by localId and does not create new records', async () => {
    await createFileRecord(
      {
        id: 'existing-1',
        fileName: 'old.jpg',
        fileSize: 5,
        createdAt: 1,
        updatedAt: 1,
        fileType: 'image/jpeg',
        localId: '1',
        contentHash: null,
      } as FileRecord,
      false
    )

    const assets = [
      {
        id: '1',
        fileName: 'new.jpg',
        fileSize: 200,
        sourceUri: 'file://1',
        fileType: 'image/jpeg',
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
      fileName: 'new.jpg',
      fileSize: 200,
    })
    expect(copyFileToCache).not.toHaveBeenCalled()
  })

  it('updates existing by contentHash and does not create new records', async () => {
    await createFileRecord(
      {
        id: 'existing-hash',
        fileName: 'old-h.jpg',
        fileSize: 10,
        createdAt: 1,
        updatedAt: 1,
        fileType: 'image/jpeg',
        localId: null,
        contentHash: 'sha256|BYTESv1|hash:file://2',
      } as FileRecord,
      false
    )

    const assets = [
      {
        id: '2',
        fileName: 'new-h.jpg',
        fileSize: 300,
        sourceUri: 'file://2',
        fileType: 'image/jpeg',
        timestamp: '2021-01-01',
      },
    ]
    const { files, updatedFiles } = await processAssets(assets)

    expect(updatedFiles).toHaveLength(1)
    expect(files).toHaveLength(0)
    const updated = await readFileRecord('existing-hash')
    expect(updated).toMatchObject({
      id: 'existing-hash',
      fileName: 'new-h.jpg',
      fileSize: 300,
    })
    expect(copyFileToCache).not.toHaveBeenCalled()
  })

  it('copies sourceUri to cache when asset lacks id', async () => {
    const copyFileToCacheMock = jest.mocked(copyFileToCache)

    const assets = [
      {
        id: undefined,
        fileName: 'no-id.jpg',
        fileSize: 123,
        sourceUri: 'file:///tmp/no-id.jpg',
        fileType: 'image/jpeg',
        timestamp: '2021-01-01',
      },
    ]

    const { files } = await processAssets(assets)

    expect(files).toHaveLength(1)
    expect(copyFileToCache).toHaveBeenCalledTimes(1)
    const call = copyFileToCacheMock.mock.calls[0]
    expect(call[0]).toMatchObject({ id: files[0].id, fileType: 'image/jpeg' })
    expect(call[1]).toBeDefined()
    expect(call[1].uri).toBe('file:///tmp/no-id.jpg')

    const rows = await readAllFileRecords({ order: 'ASC' })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ fileName: 'no-id.jpg', fileSize: 123 })
  })
})

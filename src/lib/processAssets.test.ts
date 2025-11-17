import { processAssets } from './processAssets'
import { calculateContentHash } from './contentHash'
import {
  createFileRecord,
  FileRecord,
  readAllFileRecords,
  readFileRecord,
} from '../stores/files'
import { initializeDB, resetDb } from '../db'
import { copyFileToCache, getLocalUri } from '../stores/fileCache'
import { Platform } from 'react-native'

jest.mock('./uniqueId', () => {
  let c = 0
  return { uniqueId: () => `uid-${++c}` }
})
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}))
jest.mock('./contentHash', () => ({
  calculateContentHash: jest.fn(async (uri: string) => `sha256|hash:${uri}`),
}))
jest.mock('../stores/fileCache', () => {
  const cachedIds = new Set<string>()
  return {
    getFileUri: jest.fn(async (file: FileRecord) => {
      if (file.localId) return `file://${file.localId}`
      return cachedIds.has(file.id) ? `file://${file.id}` : null
    }),
    getLocalUri: jest.fn(),
    copyFileToCache: jest.fn(
      async (file: { id: string }, sourceFile: { uri: string }) => {
        cachedIds.add(file.id)
        return sourceFile.uri
      }
    ),
    clearCache: jest.fn(() => {
      cachedIds.clear()
    }),
  }
})
jest.mock('expo-file-system', () => ({
  File: jest.fn((uri: string) => ({
    uri,
    info: jest.fn(() => ({ exists: true, size: 333, uri })),
  })),
}))

jest.mock('../managers/thumbnailer', () => ({
  generateThumbnails: jest.fn(),
}))

beforeEach(async () => {
  await initializeDB()
  jest.clearAllMocks()
  require('../stores/fileCache').clearCache()
})
afterEach(async () => {
  await resetDb()
})

describe('processAssets', () => {
  it('creates a new record when no duplicates exist', async () => {
    jest
      .mocked(getLocalUri)
      .mockImplementation(async (localId: string | null) => {
        if (localId === '1') return 'file://1'
        return null
      })
    const assets = [
      {
        id: '1',
        name: 'a.jpg',
        size: 100,
        sourceUri: 'file://1',
        type: 'image/jpeg',
        timestamp: '2021-01-01',
      },
    ]

    const { files } = await processAssets(assets)
    expect(files).toHaveLength(1)
    const rows = await readAllFileRecords({ order: 'ASC' })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'uid-1',
      name: 'a.jpg',
      size: 100,
    })
    expect(copyFileToCache).toHaveBeenCalledTimes(1)
    expect(copyFileToCache).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'uid-1',
        type: 'image/jpeg',
      }),
      expect.objectContaining({ uri: 'file://1' })
    )
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
      .mocked(getLocalUri)
      .mockImplementation(async (localId: string | null) => {
        if (localId === '1') return 'file://1'
        return null
      })
    const assets = [
      {
        id: '1',
        name: 'new.jpg',
        size: 200,
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
      size: 200,
    })
    expect(copyFileToCache).toHaveBeenCalledTimes(0)
  })
  it('updates existing by hash and does not create new records', async () => {
    await createFileRecord(
      {
        id: 'existing-hash',
        name: 'old-h.jpg',
        size: 10,
        createdAt: 1,
        updatedAt: 1,
        type: 'image/jpeg',
        hash: 'sha256|hash:file://2',
        localId: null,
        addedAt: 1,
      },
      false
    )

    jest
      .mocked(getLocalUri)
      .mockImplementation(async (localId: string | null) => {
        if (localId === '2') return 'file://2'
        return null
      })
    const assets = [
      {
        id: '2',
        name: 'new-h.jpg',
        size: 300,
        sourceUri: 'file://2',
        type: 'image/jpeg',
        timestamp: '2021-01-01',
      },
    ]
    const { files, updatedFiles } = await processAssets(assets)

    expect(updatedFiles).toHaveLength(1)
    expect(files).toHaveLength(0)
    const updated = await readFileRecord('existing-hash')
    expect(updated).toMatchObject({
      id: 'existing-hash',
      name: 'new-h.jpg',
      size: 300,
    })
    expect(copyFileToCache).toHaveBeenCalledTimes(1)
    expect(copyFileToCache).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'existing-hash' }),
      expect.objectContaining({ uri: 'file://2' })
    )
  })
  it('dedupes on hash within new files', async () => {
    jest.mocked(getLocalUri).mockImplementation(async () => {
      return null
    })
    const assets = [
      {
        id: undefined,
        name: '1.jpg',
        size: 123,
        sourceUri: 'file:///tmp/no-id.jpg',
        type: 'image/jpeg',
        timestamp: '2021-01-01',
      },
      {
        id: undefined,
        name: '2.jpg',
        size: 123,
        sourceUri: 'file:///tmp/no-id.jpg',
        type: 'image/jpeg',
        timestamp: '2021-01-01',
      },
    ]

    const { files } = await processAssets(assets)
    expect(files).toHaveLength(1)
  })
  it('grabs the highest quality file when localId is valid', async () => {
    jest.mocked(getLocalUri).mockImplementation(async () => {
      return 'file:///tmp/valid.jpg'
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
    expect(getLocalUri).toHaveBeenCalledTimes(1)
    expect(getLocalUri).toHaveBeenCalledWith('valid')

    expect(copyFileToCache).toHaveBeenCalledTimes(1)
    expect(copyFileToCache).toHaveBeenCalledWith(
      expect.objectContaining({ id: files[0].id, type: 'image/jpeg' }),
      expect.objectContaining({ uri: 'file:///tmp/valid.jpg' })
    )
  })
  it('adds file size to new files', async () => {
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

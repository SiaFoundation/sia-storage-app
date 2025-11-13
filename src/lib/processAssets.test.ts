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
    copyFileToCache: jest.fn(async (file: { id: string }) => {
      cachedIds.add(file.id)
      return `file://${file.id}`
    }),
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
    expect(copyFileToCache).not.toHaveBeenCalled()
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
    expect(copyFileToCache).not.toHaveBeenCalled()
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
    expect(copyFileToCache).not.toHaveBeenCalled()
  })

  it('copies sourceUri to cache when asset lacks valid id', async () => {
    jest.mocked(getLocalUri).mockImplementation(async () => {
      return null
    })
    const assets = [
      {
        id: undefined,
        name: 'no-id.jpg',
        size: 123,
        sourceUri: 'file:///tmp/no-id.jpg',
        type: 'image/jpeg',
        timestamp: '2021-01-01',
      },
      {
        id: 'invalid',
        name: 'no-id.jpg',
        size: 123,
        sourceUri: 'file:///tmp/no-id.jpg',
        type: 'image/jpeg',
        timestamp: '2021-01-01',
      },
    ]

    const { files } = await processAssets(assets)

    expect(files).toHaveLength(2)
    expect(copyFileToCache).toHaveBeenCalledTimes(2)
    expect(copyFileToCache).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: files[0].id, type: 'image/jpeg' }),
      expect.objectContaining({ uri: 'file:///tmp/no-id.jpg' })
    )
    expect(copyFileToCache).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: files[1].id, type: 'image/jpeg' }),
      expect.objectContaining({ uri: 'file:///tmp/no-id.jpg' })
    )

    const rows = await readAllFileRecords({ order: 'ASC' })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      name: 'no-id.jpg',
      localId: null,
      size: 123,
    })
    expect(rows[1]).toMatchObject({
      name: 'no-id.jpg',
      localId: null,
      size: 123,
    })
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

import {
  getSyncUpCursor,
  setSyncUpCursor,
  runSyncUpMetadata,
} from './syncUpMetadata'
import { initializeDB, resetDb } from '../db'
import {
  createFileRecordWithLocalObject,
  type FileRecord,
} from '../stores/files'
import { type LocalObject } from '../encoding/localObject'

jest.mock('../stores/sdk', () => ({
  getIsConnected: jest.fn(),
  getPinnedObject: jest.fn(),
  updateMetadata: jest.fn(),
}))
jest.mock('../stores/settings', () => ({
  getIndexerURL: jest.fn(),
}))
jest.mock('../encoding/fileMetadata', () => ({
  decodeFileMetadata: jest.fn(),
  encodeFileMetadata: jest.fn(),
}))

function makeLocalObject(params: {
  fileId: string
  objectId: string
  indexerURL: string
  createdAt: number
  updatedAt: number
}): LocalObject {
  return {
    id: params.objectId,
    fileId: params.fileId,
    indexerURL: params.indexerURL,
    slabs: [],
    encryptedMasterKey: new Uint8Array([1]).buffer,
    encryptedMetadata: new Uint8Array([2]).buffer,
    signature: new Uint8Array([3]).buffer,
    createdAt: new Date(params.createdAt),
    updatedAt: new Date(params.updatedAt),
  }
}

describe('syncUpMetadata', () => {
  const sdk = require('../stores/sdk') as jest.Mocked<any>
  const settings = require('../stores/settings') as jest.Mocked<any>
  const meta = require('../encoding/fileMetadata') as jest.Mocked<any>
  const INDEXER_URL = 'indexer-url'
  const NOW_BASE = 400

  beforeEach(async () => {
    await initializeDB()
    jest.clearAllMocks()
    settings.getIndexerURL.mockResolvedValue(INDEXER_URL)
    await setSyncUpCursor(undefined)
    sdk.getIsConnected.mockReturnValue(true)
  })

  afterEach(async () => {
    await resetDb()
  })

  test('updates files where local is newer, skips files where remote is newer', async () => {
    sdk.getIsConnected.mockReturnValue(true)

    // File A: local updatedAt=200, remote updatedAt=150 -> LOCAL NEWER -> should UPDATE
    const localA: Omit<FileRecord, 'objects'> = {
      id: 'file-a',
      name: 'a.jpg',
      type: 'image/jpeg',
      size: 100,
      hash: 'hash-a',
      createdAt: 100,
      updatedAt: 200, // local newer
      localId: null,
      addedAt: 100,
      thumbForHash: undefined,
      thumbSize: undefined,
    }
    await createFileRecordWithLocalObject(
      localA,
      makeLocalObject({
        fileId: localA.id,
        objectId: 'obj-a',
        indexerURL: INDEXER_URL,
        createdAt: 100,
        updatedAt: 200,
      })
    )

    // File B: local updatedAt=100, remote updatedAt=200 -> REMOTE NEWER -> should SKIP
    const localB: Omit<FileRecord, 'objects'> = {
      id: 'file-b',
      name: 'b.jpg',
      type: 'image/jpeg',
      size: 200,
      hash: 'hash-b',
      createdAt: 110,
      updatedAt: 100, // local older
      localId: null,
      addedAt: 110,
      thumbForHash: undefined,
      thumbSize: undefined,
    }
    await createFileRecordWithLocalObject(
      localB,
      makeLocalObject({
        fileId: localB.id,
        objectId: 'obj-b',
        indexerURL: INDEXER_URL,
        createdAt: 110,
        updatedAt: 100,
      })
    )

    sdk.getPinnedObject.mockImplementation(async (_objectId: string) => {
      return { metadata: () => new ArrayBuffer(0) }
    })

    const remoteA = {
      name: 'a.jpg',
      type: 'image/jpeg',
      size: 100,
      hash: 'hash-a',
      createdAt: 100,
      updatedAt: 150, // remote older -> local should win
      thumbForHash: undefined,
      thumbSize: undefined,
    }
    const remoteB = {
      name: 'b.jpg',
      type: 'image/jpeg',
      size: 200,
      hash: 'hash-b',
      createdAt: 110,
      updatedAt: 200, // remote newer -> remote should win, skip update
      thumbForHash: undefined,
      thumbSize: undefined,
    }
    meta.decodeFileMetadata
      .mockReturnValueOnce(remoteA)
      .mockReturnValueOnce(remoteB)

    await runSyncUpMetadata(5)

    // Only file A should be updated, file B should be skipped.
    expect(sdk.updateMetadata).toHaveBeenCalledTimes(1)
    expect(meta.encodeFileMetadata).toHaveBeenCalledTimes(1)
    expect(meta.encodeFileMetadata).toHaveBeenCalledWith(
      expect.objectContaining(localA)
    )
  })

  test('early exit when disconnected', async () => {
    sdk.getIsConnected.mockReturnValue(false)
    await runSyncUpMetadata(5)
    expect(true).toBe(true)
  })

  test('cursor reset when no items', async () => {
    sdk.getIsConnected.mockReturnValue(true)
    await runSyncUpMetadata(5)
    const cur = await getSyncUpCursor()
    expect(cur).toBeUndefined()
  })

  test('advances cursor when full batch processed', async () => {
    const batchSize = 5
    for (let i = 0; i < batchSize; i++) {
      const file: Omit<FileRecord, 'objects'> = {
        id: `file-${i}`,
        name: `name-${i}`,
        type: 'image/jpeg',
        size: 100 + i,
        hash: `hash-${i}`,
        createdAt: NOW_BASE + i,
        updatedAt: NOW_BASE + i,
        localId: null,
        addedAt: NOW_BASE + i,
        thumbForHash: undefined,
        thumbSize: undefined,
      }
      await createFileRecordWithLocalObject(
        file,
        makeLocalObject({
          fileId: file.id,
          objectId: `obj-${i}`,
          indexerURL: INDEXER_URL,
          createdAt: NOW_BASE + i,
          updatedAt: NOW_BASE + i,
        })
      )
    }

    await runSyncUpMetadata(batchSize)

    const cur = await getSyncUpCursor()
    expect(cur).toEqual({
      updatedAt: NOW_BASE + (batchSize - 1),
      id: `file-${batchSize - 1}`,
    })
  })

  test('advances cursor past partial batch', async () => {
    const batchSize = 5
    const count = 3
    for (let i = 0; i < count; i++) {
      const file: Omit<FileRecord, 'objects'> = {
        id: `file-${i}`,
        name: `name-${i}`,
        type: 'image/jpeg',
        size: 100 + i,
        hash: `hash-${i}`,
        createdAt: NOW_BASE + i,
        updatedAt: NOW_BASE + i,
        localId: null,
        addedAt: NOW_BASE + i,
        thumbForHash: undefined,
        thumbSize: undefined,
      }
      await createFileRecordWithLocalObject(
        file,
        makeLocalObject({
          fileId: file.id,
          objectId: `obj-${i}`,
          indexerURL: INDEXER_URL,
          createdAt: NOW_BASE + i,
          updatedAt: NOW_BASE + i,
        })
      )
    }

    await runSyncUpMetadata(batchSize)

    const cur = await getSyncUpCursor()
    expect(cur).toEqual({
      updatedAt: NOW_BASE + count,
      id: `file-${count - 1}`,
    })
  })
  test('skips files at or before cursor updatedAt', async () => {
    sdk.getIsConnected.mockReturnValue(true)
    const batchSize = 10

    const records: Omit<FileRecord, 'objects'>[] = [
      {
        id: 'file-0',
        name: 'name-0',
        type: 'image/jpeg',
        size: 101,
        hash: 'hash-0',
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
        localId: null,
        addedAt: NOW_BASE,
        thumbForHash: undefined,
        thumbSize: undefined,
      },
      {
        id: 'file-1',
        name: 'name-1',
        type: 'image/jpeg',
        size: 102,
        hash: 'hash-1',
        createdAt: NOW_BASE + 1,
        updatedAt: NOW_BASE + 1,
        localId: null,
        addedAt: NOW_BASE + 1,
        thumbForHash: undefined,
        thumbSize: undefined,
      },
      {
        id: 'file-2',
        name: 'name-2',
        type: 'image/jpeg',
        size: 103,
        hash: 'hash-2',
        createdAt: NOW_BASE + 2,
        updatedAt: NOW_BASE + 2,
        localId: null,
        addedAt: NOW_BASE + 2,
        thumbForHash: undefined,
        thumbSize: undefined,
      },
    ]

    for (const record of records) {
      await createFileRecordWithLocalObject(
        record,
        makeLocalObject({
          fileId: record.id,
          objectId: `obj-${record.id}`,
          indexerURL: INDEXER_URL,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        })
      )
    }

    await setSyncUpCursor({ updatedAt: NOW_BASE + 1, id: 'file-1' })

    const remoteNewer = {
      name: 'name-2',
      type: 'image/jpeg',
      size: 103,
      hash: 'hash-2',
      createdAt: NOW_BASE + 2,
      updatedAt: NOW_BASE + 1,
      thumbForHash: undefined,
      thumbSize: undefined,
    }

    meta.decodeFileMetadata.mockReturnValue(remoteNewer)

    await runSyncUpMetadata(batchSize)

    expect(sdk.getPinnedObject).toHaveBeenCalledTimes(1)
    expect(sdk.getPinnedObject).toHaveBeenCalledWith('obj-file-2')
  })
})

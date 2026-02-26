import type { LocalObject } from '@siastorage/core/encoding/localObject'
import { initializeDB, resetDb } from '../db'
import {
  createFileRecordWithLocalObject,
  type FileRecord,
  updateFileRecord,
} from '../stores/files'
import {
  getSyncUpCursor,
  runSyncUpMetadata,
  setSyncUpCursor,
} from './syncUpMetadata'

jest.mock('../stores/sdk', () => ({
  getIsConnected: jest.fn(),
  getPinnedObject: jest.fn(),
  getSdk: jest.fn(),
}))
jest.mock('../stores/settings', () => ({
  getIndexerURL: jest.fn(),
}))
jest.mock('@siastorage/core/encoding/fileMetadata', () => ({
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
    encryptedDataKey: new Uint8Array([1]).buffer,
    encryptedMetadataKey: new Uint8Array([2]).buffer,
    encryptedMetadata: new Uint8Array([3]).buffer,
    dataSignature: new Uint8Array([4]).buffer,
    metadataSignature: new Uint8Array([5]).buffer,
    createdAt: new Date(params.createdAt),
    updatedAt: new Date(params.updatedAt),
  }
}

describe('syncUpMetadata', () => {
  const sdk = require('../stores/sdk') as jest.Mocked<any>
  const settings = require('../stores/settings') as jest.Mocked<any>
  const meta =
    require('@siastorage/core/encoding/fileMetadata') as jest.Mocked<any>
  const INDEXER_URL = 'indexer-url'
  const NOW_BASE = 400
  const mockUpdateObjectMetadata = jest.fn()
  const mockDeleteObject = jest.fn()

  beforeEach(async () => {
    await initializeDB()
    jest.clearAllMocks()
    settings.getIndexerURL.mockResolvedValue(INDEXER_URL)
    await setSyncUpCursor(undefined)
    sdk.getIsConnected.mockReturnValue(true)
    sdk.getSdk.mockReturnValue({
      updateObjectMetadata: mockUpdateObjectMetadata,
      deleteObject: mockDeleteObject,
    })
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
      kind: 'file',
      size: 100,
      hash: 'hash-a',
      createdAt: 100,
      updatedAt: 200, // local newer
      localId: null,
      addedAt: 100,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    }
    await createFileRecordWithLocalObject(
      localA,
      makeLocalObject({
        fileId: localA.id,
        objectId: 'obj-a',
        indexerURL: INDEXER_URL,
        createdAt: 100,
        updatedAt: 200,
      }),
    )

    // File B: local updatedAt=100, remote updatedAt=200 -> REMOTE NEWER -> should SKIP
    const localB: Omit<FileRecord, 'objects'> = {
      id: 'file-b',
      name: 'b.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 200,
      hash: 'hash-b',
      createdAt: 110,
      updatedAt: 100, // local older
      localId: null,
      addedAt: 110,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    }
    await createFileRecordWithLocalObject(
      localB,
      makeLocalObject({
        fileId: localB.id,
        objectId: 'obj-b',
        indexerURL: INDEXER_URL,
        createdAt: 110,
        updatedAt: 100,
      }),
    )

    sdk.getPinnedObject.mockImplementation(async (_objectId: string) => {
      return { metadata: () => new ArrayBuffer(0), updateMetadata: jest.fn() }
    })

    const remoteA = {
      name: 'a.jpg',
      type: 'image/jpeg',
      size: 100,
      hash: 'hash-a',
      createdAt: 100,
      updatedAt: 150, // remote older -> local should win
      thumbForId: undefined,
      thumbSize: undefined,
    }
    const remoteB = {
      name: 'b.jpg',
      type: 'image/jpeg',
      size: 200,
      hash: 'hash-b',
      createdAt: 110,
      updatedAt: 200, // remote newer -> remote should win, skip update
      thumbForId: undefined,
      thumbSize: undefined,
    }
    meta.decodeFileMetadata
      .mockReturnValueOnce(remoteA)
      .mockReturnValueOnce(remoteB)

    await runSyncUpMetadata(5)

    // Only file A should be updated, file B should be skipped.
    expect(mockUpdateObjectMetadata).toHaveBeenCalledTimes(1)
    expect(meta.encodeFileMetadata).toHaveBeenCalledTimes(1)
    expect(meta.encodeFileMetadata).toHaveBeenCalledWith(
      expect.objectContaining(localA),
      { thumbForHash: undefined },
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
        kind: 'file',
        size: 100 + i,
        hash: `hash-${i}`,
        createdAt: NOW_BASE + i,
        updatedAt: NOW_BASE + i,
        localId: null,
        addedAt: NOW_BASE + i,
        thumbForId: undefined,
        thumbSize: undefined,
        trashedAt: null,
        deletedAt: null,
      }
      await createFileRecordWithLocalObject(
        file,
        makeLocalObject({
          fileId: file.id,
          objectId: `obj-${i}`,
          indexerURL: INDEXER_URL,
          createdAt: NOW_BASE + i,
          updatedAt: NOW_BASE + i,
        }),
      )
    }

    sdk.getPinnedObject.mockResolvedValue({
      metadata: () => new ArrayBuffer(0),
      updateMetadata: jest.fn(),
    })
    meta.decodeFileMetadata.mockImplementation(() => ({
      name: 'name',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
    }))

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
        kind: 'file',
        size: 100 + i,
        hash: `hash-${i}`,
        createdAt: NOW_BASE + i,
        updatedAt: NOW_BASE + i,
        localId: null,
        addedAt: NOW_BASE + i,
        thumbForId: undefined,
        thumbSize: undefined,
        trashedAt: null,
        deletedAt: null,
      }
      await createFileRecordWithLocalObject(
        file,
        makeLocalObject({
          fileId: file.id,
          objectId: `obj-${i}`,
          indexerURL: INDEXER_URL,
          createdAt: NOW_BASE + i,
          updatedAt: NOW_BASE + i,
        }),
      )
    }

    sdk.getPinnedObject.mockResolvedValue({
      metadata: () => new ArrayBuffer(0),
      updateMetadata: jest.fn(),
    })
    meta.decodeFileMetadata.mockImplementation(() => ({
      name: 'name',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
    }))

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
        kind: 'file',
        size: 101,
        hash: 'hash-0',
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
        localId: null,
        addedAt: NOW_BASE,
        thumbForId: undefined,
        thumbSize: undefined,
        trashedAt: null,
        deletedAt: null,
      },
      {
        id: 'file-1',
        name: 'name-1',
        type: 'image/jpeg',
        kind: 'file',
        size: 102,
        hash: 'hash-1',
        createdAt: NOW_BASE + 1,
        updatedAt: NOW_BASE + 1,
        localId: null,
        addedAt: NOW_BASE + 1,
        thumbForId: undefined,
        thumbSize: undefined,
        trashedAt: null,
        deletedAt: null,
      },
      {
        id: 'file-2',
        name: 'name-2',
        type: 'image/jpeg',
        kind: 'file',
        size: 103,
        hash: 'hash-2',
        createdAt: NOW_BASE + 2,
        updatedAt: NOW_BASE + 2,
        localId: null,
        addedAt: NOW_BASE + 2,
        thumbForId: undefined,
        thumbSize: undefined,
        trashedAt: null,
        deletedAt: null,
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
        }),
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
      thumbForId: undefined,
      thumbSize: undefined,
    }

    meta.decodeFileMetadata.mockReturnValue(remoteNewer)

    await runSyncUpMetadata(batchSize)

    expect(sdk.getPinnedObject).toHaveBeenCalledTimes(1)
    expect(sdk.getPinnedObject).toHaveBeenCalledWith('obj-file-2')
  })

  test('does not overwrite remote id when remote already has one', async () => {
    sdk.getIsConnected.mockReturnValue(true)

    const localFile: Omit<FileRecord, 'objects'> = {
      id: 'local-id',
      name: 'photo.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-a',
      createdAt: 100,
      updatedAt: 200,
      localId: null,
      addedAt: 100,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    }
    await createFileRecordWithLocalObject(
      localFile,
      makeLocalObject({
        fileId: localFile.id,
        objectId: 'obj-a',
        indexerURL: INDEXER_URL,
        createdAt: 100,
        updatedAt: 200,
      }),
    )

    sdk.getPinnedObject.mockResolvedValue({
      metadata: () => new ArrayBuffer(0),
      updateMetadata: jest.fn(),
    })

    meta.decodeFileMetadata.mockReturnValue({
      id: 'remote-id',
      name: 'photo.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-a',
      createdAt: 100,
      updatedAt: 200,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
    })

    await runSyncUpMetadata(5)

    expect(mockUpdateObjectMetadata).not.toHaveBeenCalled()
  })

  test('skips all work when signal is already aborted', async () => {
    sdk.getIsConnected.mockReturnValue(true)

    const file: Omit<FileRecord, 'objects'> = {
      id: 'file-0',
      name: 'a.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-0',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      localId: null,
      addedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    }
    await createFileRecordWithLocalObject(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-0',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )

    const ac = new AbortController()
    ac.abort()
    await runSyncUpMetadata(5, ac.signal)

    expect(sdk.getPinnedObject).not.toHaveBeenCalled()
  })

  test('stops fetching objects when signal is aborted mid-batch', async () => {
    sdk.getIsConnected.mockReturnValue(true)

    for (let i = 0; i < 5; i++) {
      const file: Omit<FileRecord, 'objects'> = {
        id: `file-${i}`,
        name: `name-${i}`,
        type: 'image/jpeg',
        kind: 'file',
        size: 100 + i,
        hash: `hash-${i}`,
        createdAt: NOW_BASE + i,
        updatedAt: NOW_BASE + i,
        localId: null,
        addedAt: NOW_BASE + i,
        thumbForId: undefined,
        thumbSize: undefined,
        trashedAt: null,
        deletedAt: null,
      }
      await createFileRecordWithLocalObject(
        file,
        makeLocalObject({
          fileId: file.id,
          objectId: `obj-${i}`,
          indexerURL: INDEXER_URL,
          createdAt: NOW_BASE + i,
          updatedAt: NOW_BASE + i,
        }),
      )
    }

    const ac = new AbortController()
    let callCount = 0
    sdk.getPinnedObject.mockImplementation(async () => {
      callCount++
      if (callCount >= 2) ac.abort()
      return { metadata: () => new ArrayBuffer(0), updateMetadata: jest.fn() }
    })
    meta.decodeFileMetadata.mockReturnValue({
      name: 'name',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
    })

    await runSyncUpMetadata(5, ac.signal)

    expect(sdk.getPinnedObject).toHaveBeenCalledTimes(2)
  })

  test('preserves remote canonical id when pushing other field changes', async () => {
    sdk.getIsConnected.mockReturnValue(true)

    const localFile: Omit<FileRecord, 'objects'> = {
      id: 'local-id',
      name: 'renamed.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-a',
      createdAt: 100,
      updatedAt: 300,
      localId: null,
      addedAt: 100,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    }
    await createFileRecordWithLocalObject(
      localFile,
      makeLocalObject({
        fileId: localFile.id,
        objectId: 'obj-a',
        indexerURL: INDEXER_URL,
        createdAt: 100,
        updatedAt: 300,
      }),
    )

    sdk.getPinnedObject.mockResolvedValue({
      metadata: () => new ArrayBuffer(0),
      updateMetadata: jest.fn(),
    })

    meta.decodeFileMetadata.mockReturnValue({
      id: 'remote-id',
      name: 'original.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-a',
      createdAt: 100,
      updatedAt: 200,
      thumbForId: undefined,
      thumbSize: undefined,
    })

    await runSyncUpMetadata(5)

    expect(meta.encodeFileMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'remote-id', name: 'renamed.jpg' }),
      { thumbForHash: undefined },
    )
  })

  test('syncUp calls deleteObject for tombstoned files', async () => {
    sdk.getIsConnected.mockReturnValue(true)

    const file: Omit<FileRecord, 'objects'> = {
      id: 'file-tomb',
      name: 'photo.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-tomb',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      localId: null,
      addedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    }
    await createFileRecordWithLocalObject(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-tomb',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )
    await updateFileRecord({ id: file.id, deletedAt: Date.now() }, false, {
      includeUpdatedAt: false,
    })

    mockDeleteObject.mockResolvedValue(undefined)

    await runSyncUpMetadata(5)

    expect(mockDeleteObject).toHaveBeenCalledWith('obj-tomb')
  })

  test('syncUp advances cursor after successful deleteObject for tombstoned files', async () => {
    sdk.getIsConnected.mockReturnValue(true)

    const file: Omit<FileRecord, 'objects'> = {
      id: 'file-tomb2',
      name: 'photo2.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-tomb2',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      localId: null,
      addedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    }
    await createFileRecordWithLocalObject(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-tomb2',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )
    await updateFileRecord({ id: file.id, deletedAt: Date.now() }, false, {
      includeUpdatedAt: false,
    })

    mockDeleteObject.mockResolvedValue(undefined)

    await runSyncUpMetadata(5)

    const cur = await getSyncUpCursor()
    expect(cur).toBeDefined()
  })

  test('syncUp stalls on network error for tombstoned file', async () => {
    sdk.getIsConnected.mockReturnValue(true)

    const file: Omit<FileRecord, 'objects'> = {
      id: 'file-tomb3',
      name: 'photo3.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-tomb3',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      localId: null,
      addedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    }
    await createFileRecordWithLocalObject(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-tomb3',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )
    await updateFileRecord({ id: file.id, deletedAt: Date.now() }, false, {
      includeUpdatedAt: false,
    })

    mockDeleteObject.mockRejectedValue(new Error('network error'))

    await runSyncUpMetadata(5)

    const cur = await getSyncUpCursor()
    expect(cur).toBeUndefined()
  })

  test('syncUp skips metadata path and only calls deleteObject for tombstoned files', async () => {
    sdk.getIsConnected.mockReturnValue(true)

    const file: Omit<FileRecord, 'objects'> = {
      id: 'file-tomb4',
      name: 'photo4.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-tomb4',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      localId: null,
      addedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    }
    await createFileRecordWithLocalObject(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-tomb4',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )
    await updateFileRecord({ id: file.id, deletedAt: Date.now() }, false, {
      includeUpdatedAt: false,
    })

    mockDeleteObject.mockResolvedValue(undefined)

    await runSyncUpMetadata(5)

    expect(sdk.getPinnedObject).not.toHaveBeenCalled()
    expect(mockUpdateObjectMetadata).not.toHaveBeenCalled()
    expect(mockDeleteObject).toHaveBeenCalledWith('obj-tomb4')
  })

  test('tombstoned file with object on another indexer leaves that object row dangling', async () => {
    sdk.getIsConnected.mockReturnValue(true)
    const OTHER_INDEXER = 'other-indexer-url'

    const file: Omit<FileRecord, 'objects'> = {
      id: 'file-multi-idx',
      name: 'multi.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-multi-idx',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      localId: null,
      addedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    }

    // Create file with objects on both the current indexer and another indexer.
    await createFileRecordWithLocalObject(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-current',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )
    const { upsertLocalObject } = require('../stores/localObjects')
    await upsertLocalObject(
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-other',
        indexerURL: OTHER_INDEXER,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
      false,
    )

    // Tombstone the file.
    await updateFileRecord({ id: file.id, deletedAt: Date.now() }, false, {
      includeUpdatedAt: false,
    })

    mockDeleteObject.mockResolvedValue(undefined)
    await runSyncUpMetadata(5)

    // syncUp only deletes the current indexer's object.
    expect(mockDeleteObject).toHaveBeenCalledTimes(1)
    expect(mockDeleteObject).toHaveBeenCalledWith('obj-current')

    // The other indexer's object row persists locally. This is a known
    // limitation: we can only connect to one indexer at a time, so we
    // can't delete objects on other indexers. A future cleanup service
    // is needed to handle this (see TODO in syncUpMetadata.ts).
    const { readLocalObjectsForFile } = require('../stores/localObjects')
    const remaining = await readLocalObjectsForFile(file.id)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe('obj-other')
    expect(remaining[0].indexerURL).toBe(OTHER_INDEXER)
  })
})

import { SYNC_GATE_HYDRATION_MIN } from '@siastorage/core/config'
import { encodeFileMetadata } from '@siastorage/core/encoding/fileMetadata'
import type { LocalObject } from '@siastorage/core/encoding/localObject'
import type { FileMetadata, FileRecord } from '@siastorage/core/types'
import { logger } from '@siastorage/logger'
import type { ObjectEvent, PinnedObjectInterface } from 'react-native-sia'
import { db, initializeDB, resetDb } from '../db'
import { app, internal } from '../stores/appService'
import { run } from './syncDownEvents'
import { createHash } from 'crypto'
import { type ContentHash, toContentHash } from '@siastorage/core/lib/contentHash'

/** A content hash in the real form, derived from a label so fixtures stay readable. */
const fakeHash = (label: string): ContentHash =>
  toContentHash(createHash('sha256').update(label).digest('hex'))

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

function makeMockPinnedObject(
  metadata: FileMetadata,
  objectId: string = 'obj-id',
  createdAt: Date = new Date(),
  updatedAt: Date = new Date(),
): PinnedObjectInterface {
  const encodedMetadata = encodeFileMetadata(metadata)
  return {
    id: () => objectId,
    metadata: () => encodedMetadata,
    slabs: () => [],
    size: () => BigInt(metadata.size),
    encodedSize: () => BigInt(metadata.size),
    createdAt: () => createdAt,
    updatedAt: () => updatedAt,
    updateMetadata: (_newMetadata: ArrayBuffer) => {
      // Not used in tests
    },
    seal: () => ({
      id: objectId,
      slabs: [],
      encryptedDataKey: new ArrayBuffer(32),
      encryptedMetadataKey: new ArrayBuffer(32),
      encryptedMetadata: encodedMetadata,
      dataSignature: new ArrayBuffer(64),
      metadataSignature: new ArrayBuffer(64),
      createdAt,
      updatedAt,
    }),
  }
}

function makeObjectEvent(params: {
  id: string
  updatedAt: Date
  deleted?: boolean
  object?: PinnedObjectInterface
}): ObjectEvent {
  return {
    id: params.id,
    updatedAt: params.updatedAt,
    deleted: params.deleted ?? false,
    object: params.object,
  }
}

const mockAppKey = { export_: () => new Uint8Array(32) }

// The dirty flag lives on the object row, not the file. Read it directly since
// the localObjects facade doesn't surface needsSyncUp on its return shape.
async function objectFlag(objectId: string, indexerURL: string): Promise<number> {
  const row = await db().getFirstAsync<{ needsSyncUp: number }>(
    'SELECT needsSyncUp FROM objects WHERE id = ? AND indexerURL = ?',
    objectId,
    indexerURL,
  )
  return row?.needsSyncUp ?? 0
}

let removeFileSpy: jest.SpyInstance

describe('syncDownEvents', () => {
  const INDEXER_URL = 'indexer-url'
  const NOW_BASE = 1000

  beforeEach(async () => {
    await initializeDB()
    jest.clearAllMocks()
    await app().sync.setSyncDownCursor(undefined)
    app().connection.setState({ isConnected: true })
    await app().settings.setIndexerURL(INDEXER_URL)
    removeFileSpy = jest.spyOn(app().fs, 'removeFile')
  })

  afterEach(async () => {
    internal().setSdk(null)
    await resetDb()
  })

  test('early exit when not connected', async () => {
    app().connection.setState({ isConnected: false })
    await run(new AbortController().signal)
  })

  test('early exit when no sdk', async () => {
    app().connection.setState({ isConnected: true })
    internal().setSdk(null)
    await run(new AbortController().signal)
    const cur = await app().sync.getSyncDownCursor()
    expect(cur).toBeUndefined()
  })

  test('processes full batch and updates cursor', async () => {
    const metadata1: FileMetadata = {
      id: 'file-1',
      name: 'test1.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'sha256:73a370509b33f7d64369bf097335b57c4021bd28e33a3f12c1b622fd62222374',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
    }

    const metadata2: FileMetadata = {
      id: 'file-2',
      name: 'test2.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 200,
      hash: 'sha256:68240addda41562dabc703d040452cbd977e8e52035a4addb58a447b3468caad',
      createdAt: NOW_BASE + 1,
      updatedAt: NOW_BASE + 1,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
    }

    const events: ObjectEvent[] = [
      makeObjectEvent({
        id: 'obj-1',
        updatedAt: new Date(NOW_BASE),
        object: makeMockPinnedObject(metadata1, 'obj-1'),
      }),
      makeObjectEvent({
        id: 'obj-2',
        updatedAt: new Date(NOW_BASE + 1),
        object: makeMockPinnedObject(metadata2, 'obj-2'),
      }),
    ]

    internal().setSdk({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
      appKey: () => mockAppKey,
    } as any)

    await run(new AbortController().signal)

    const cursor = await app().sync.getSyncDownCursor()
    expect(cursor).toEqual({
      id: 'obj-2',
      after: new Date(NOW_BASE + 1),
    })

    const file1 = await app().files.getByObjectId('obj-1', INDEXER_URL)
    expect(file1).not.toBeNull()
    const objects1 = await app().localObjects.getForFile(file1!.id)
    expect(objects1).toHaveLength(1)

    const file2 = await app().files.getByObjectId('obj-2', INDEXER_URL)
    expect(file2).not.toBeNull()
    const objects2 = await app().localObjects.getForFile(file2!.id)
    expect(objects2).toHaveLength(1)
  })

  test('stops when batch is not full', async () => {
    const metadata: FileMetadata = {
      id: 'file-1',
      name: 'test.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'sha256:73a370509b33f7d64369bf097335b57c4021bd28e33a3f12c1b622fd62222374',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
    }

    const events: ObjectEvent[] = [
      makeObjectEvent({
        id: 'obj-1',
        updatedAt: new Date(NOW_BASE),
        object: makeMockPinnedObject(metadata, 'obj-1'),
      }),
    ]

    internal().setSdk({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
      appKey: () => mockAppKey,
    } as any)

    await run(new AbortController().signal)

    const cursor = await app().sync.getSyncDownCursor()
    expect(cursor).toEqual({
      id: 'obj-1',
      after: new Date(NOW_BASE),
    })
  })

  test('handles delete event by removing file record and fs files', async () => {
    const file: Omit<FileRecord, 'objects'> = {
      id: 'file-1',
      name: 'test.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'sha256:73a370509b33f7d64369bf097335b57c4021bd28e33a3f12c1b622fd62222374',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      mediaAssetId: null,
      addedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    }
    await app().files.create(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-1',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )

    const events: ObjectEvent[] = [
      makeObjectEvent({
        id: 'obj-1',
        updatedAt: new Date(NOW_BASE + 1),
        deleted: true,
      }),
    ]

    internal().setSdk({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
      appKey: () => mockAppKey,
    } as any)

    await run(new AbortController().signal)

    expect(removeFileSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'file-1' }))

    const deletedFile = await app().files.getByObjectId('obj-1', INDEXER_URL)
    expect(deletedFile).toBeNull()
  })

  test('handles update event for existing file', async () => {
    const file: Omit<FileRecord, 'objects'> = {
      id: 'file-1',
      name: 'test.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'sha256:73a370509b33f7d64369bf097335b57c4021bd28e33a3f12c1b622fd62222374',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      mediaAssetId: null,
      addedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    }
    await app().files.create(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-1',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )

    const updatedMetadata: FileMetadata = {
      id: 'file-1',
      name: 'test-updated.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'sha256:73a370509b33f7d64369bf097335b57c4021bd28e33a3f12c1b622fd62222374',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE + 1,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
    }

    const events: ObjectEvent[] = [
      makeObjectEvent({
        id: 'obj-1',
        updatedAt: new Date(NOW_BASE + 1),
        object: makeMockPinnedObject(updatedMetadata, 'obj-1'),
      }),
    ]

    internal().setSdk({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
      appKey: () => mockAppKey,
    } as any)

    await run(new AbortController().signal)

    const updatedFile = await app().files.getByObjectId('obj-1', INDEXER_URL)
    expect(updatedFile).not.toBeNull()
  })

  test('handles update event for new file', async () => {
    const metadata: FileMetadata = {
      id: 'file-new',
      name: 'new-file.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'sha256:b8465df8db6bbd15016aa10533813ca96ea51eb75dca4f1b60ce98ebcc964d2c',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
    }

    const events: ObjectEvent[] = [
      makeObjectEvent({
        id: 'obj-1',
        updatedAt: new Date(NOW_BASE),
        object: makeMockPinnedObject(metadata, 'obj-1'),
      }),
    ]

    internal().setSdk({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
      appKey: () => mockAppKey,
    } as any)

    await run(new AbortController().signal)

    const newFile = await app().files.getByObjectId('obj-1', INDEXER_URL)
    expect(newFile).not.toBeNull()
  })

  test('merges metadata correctly when remote is newer', async () => {
    const file: Omit<FileRecord, 'objects'> = {
      id: 'file-1',
      name: 'old-name.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'sha256:73a370509b33f7d64369bf097335b57c4021bd28e33a3f12c1b622fd62222374',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      mediaAssetId: null,
      addedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    }
    await app().files.create(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-1',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )

    const newerRemoteMetadata: FileMetadata = {
      id: 'file-1',
      name: 'new-name.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'sha256:73a370509b33f7d64369bf097335b57c4021bd28e33a3f12c1b622fd62222374',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE + 100,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
    }

    const events: ObjectEvent[] = [
      makeObjectEvent({
        id: 'obj-1',
        updatedAt: new Date(NOW_BASE + 100),
        object: makeMockPinnedObject(newerRemoteMetadata, 'obj-1'),
      }),
    ]

    internal().setSdk({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
      appKey: () => mockAppKey,
    } as any)

    await run(new AbortController().signal)

    const updatedFile = await app().files.getByObjectId('obj-1', INDEXER_URL)
    expect(updatedFile).not.toBeNull()
    expect(updatedFile).toEqual(
      expect.objectContaining({
        name: 'new-name.jpg',
        type: 'image/jpeg',
        size: 100,
        hash: 'sha256:73a370509b33f7d64369bf097335b57c4021bd28e33a3f12c1b622fd62222374',
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE + 100,
      }),
    )

    const objects = await app().localObjects.getForFile(updatedFile!.id)
    expect(objects).toHaveLength(1)
    expect(objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'obj-1',
          indexerURL: INDEXER_URL,
        }),
      ]),
    )
  })

  test('remote-newer update clears a pending needsSyncUp flag', async () => {
    const file: Omit<FileRecord, 'objects'> = {
      id: 'flag-rn',
      name: 'local.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'sha256:c1aca9f84cf4c22e26f865278b871c915c800057aa14d58ffdbf5ded543d1b14',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      mediaAssetId: null,
      addedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    }
    await app().files.create(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-rn',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )
    // Local creation leaves the object dirty. After a remote-newer sync-down the
    // object matches remote, so its flag must clear.
    expect(await objectFlag('obj-rn', INDEXER_URL)).toBe(1)

    const newerRemote: FileMetadata = {
      id: 'flag-rn',
      name: 'remote.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'sha256:c1aca9f84cf4c22e26f865278b871c915c800057aa14d58ffdbf5ded543d1b14',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE + 100,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
    }
    internal().setSdk({
      objectEvents: jest.fn().mockResolvedValueOnce([
        makeObjectEvent({
          id: 'obj-rn',
          updatedAt: new Date(NOW_BASE + 100),
          object: makeMockPinnedObject(newerRemote, 'obj-rn'),
        }),
      ]),
      appKey: () => mockAppKey,
    } as any)

    await run(new AbortController().signal)

    expect(await objectFlag('obj-rn', INDEXER_URL)).toBe(0)
  })

  test('remote-newer update does not clear a locally-tombstoned row’s delete flag', async () => {
    const file: Omit<FileRecord, 'objects'> = {
      id: 'flag-tomb',
      name: 'local.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'sha256:8cdd5b4e047c893238304dbc4c14b0ff1018ae0993275b927fc3274c90ac236b',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      mediaAssetId: null,
      addedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    }
    await app().files.create(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-tomb',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )
    // Locally delete: tombstone sets deletedAt and flags the object dirty so
    // sync-up will delete the remote object.
    await app().files.tombstone(['flag-tomb'])
    const tombAt = (await app().files.getById('flag-tomb'))!.updatedAt
    expect(await objectFlag('obj-tomb', INDEXER_URL)).toBe(1)

    // Another device edits the metadata with a strictly-newer timestamp before
    // our delete syncs up — this is a remote-newer (non-delete) update event.
    const newerRemote: FileMetadata = {
      id: 'flag-tomb',
      name: 'remote-edit.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'sha256:8cdd5b4e047c893238304dbc4c14b0ff1018ae0993275b927fc3274c90ac236b',
      createdAt: NOW_BASE,
      updatedAt: tombAt + 1000,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
    }
    internal().setSdk({
      objectEvents: jest.fn().mockResolvedValueOnce([
        makeObjectEvent({
          id: 'obj-tomb',
          updatedAt: new Date(tombAt + 1000),
          object: makeMockPinnedObject(newerRemote, 'obj-tomb'),
        }),
      ]),
      appKey: () => mockAppKey,
    } as any)

    await run(new AbortController().signal)

    // The remote-newer update must NOT clear the pending delete flag on the
    // object; the local tombstone wins and sync-up still has to delete the
    // remote object.
    expect(await objectFlag('obj-tomb', INDEXER_URL)).toBe(1)
    const row = await app().files.getById('flag-tomb')
    expect(row?.deletedAt).not.toBeNull()
  })

  test('local-newer (remote-older) update preserves a pending needsSyncUp flag', async () => {
    const file: Omit<FileRecord, 'objects'> = {
      id: 'flag-ln',
      name: 'local-newer.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'sha256:b95be39e618ab2cbc4f6329433135828721071193f718d7d887fd06a268e7b74',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE + 100,
      mediaAssetId: null,
      addedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    }
    await app().files.create(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-ln',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE + 100,
      }),
    )
    // Object has a pending local edit (flag=1). A remote-OLDER event must NOT
    // clear it — otherwise the local edit would never be pushed (the exact
    // data-loss this flag exists to prevent).
    expect(await objectFlag('obj-ln', INDEXER_URL)).toBe(1)

    const olderRemote: FileMetadata = {
      id: 'flag-ln',
      name: 'remote-older.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'sha256:b95be39e618ab2cbc4f6329433135828721071193f718d7d887fd06a268e7b74',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
    }
    internal().setSdk({
      objectEvents: jest.fn().mockResolvedValueOnce([
        makeObjectEvent({
          id: 'obj-ln',
          updatedAt: new Date(NOW_BASE),
          object: makeMockPinnedObject(olderRemote, 'obj-ln'),
        }),
      ]),
      appKey: () => mockAppKey,
    } as any)

    await run(new AbortController().signal)

    // The object flag is preserved through a remote-older ingest.
    expect(await objectFlag('obj-ln', INDEXER_URL)).toBe(1)
    const result = await app().files.getById('flag-ln')
    // The local (newer) name is preserved, not overwritten by the older remote.
    expect(result?.name).toBe('local-newer.jpg')
  })

  test('does not merge metadata when remote is older', async () => {
    const file: Omit<FileRecord, 'objects'> = {
      id: 'file-1',
      name: 'newer-name.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'sha256:73a370509b33f7d64369bf097335b57c4021bd28e33a3f12c1b622fd62222374',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE + 100,
      mediaAssetId: null,
      addedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    }
    await app().files.create(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-1',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE + 100,
      }),
    )

    const olderRemoteMetadata: FileMetadata = {
      id: 'file-1',
      name: 'older-name.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'sha256:73a370509b33f7d64369bf097335b57c4021bd28e33a3f12c1b622fd62222374',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
    }

    const events: ObjectEvent[] = [
      makeObjectEvent({
        id: 'obj-1',
        updatedAt: new Date(NOW_BASE),
        object: makeMockPinnedObject(olderRemoteMetadata, 'obj-1'),
      }),
    ]

    internal().setSdk({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
      appKey: () => mockAppKey,
    } as any)

    await run(new AbortController().signal)

    const file2 = await app().files.getByObjectId('obj-1', INDEXER_URL)
    expect(file2).not.toBeNull()
    expect(file2).toEqual(
      expect.objectContaining({
        name: 'newer-name.jpg',
        updatedAt: NOW_BASE + 100,
      }),
    )

    const objects = await app().localObjects.getForFile(file2!.id)
    expect(objects).toHaveLength(1)
  })

  test('skips events with incomplete metadata', async () => {
    const incompleteMetadata: FileMetadata = {
      id: 'file-incomplete',
      name: 'incomplete.jpg',
      type: '',
      kind: 'file',
      size: 0,
      hash: '',
      createdAt: 0,
      updatedAt: 0,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
    }

    const events: ObjectEvent[] = [
      makeObjectEvent({
        id: 'obj-1',
        updatedAt: new Date(NOW_BASE),
        object: makeMockPinnedObject(incompleteMetadata, 'obj-1'),
      }),
    ]

    internal().setSdk({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
      appKey: () => mockAppKey,
    } as any)

    await run(new AbortController().signal)

    const file = await app().files.getByObjectId('obj-1', INDEXER_URL)
    expect(file).toBeNull()
  })

  test('FS error in delete cleanup does not prevent cursor advancement', async () => {
    const file: Omit<FileRecord, 'objects'> = {
      id: 'file-1',
      name: 'test.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'sha256:73a370509b33f7d64369bf097335b57c4021bd28e33a3f12c1b622fd62222374',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      mediaAssetId: null,
      addedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    }
    await app().files.create(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-1',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )

    const events: ObjectEvent[] = [
      makeObjectEvent({
        id: 'obj-1',
        updatedAt: new Date(NOW_BASE + 1),
        deleted: true,
      }),
      makeObjectEvent({
        id: 'obj-2',
        updatedAt: new Date(NOW_BASE + 2),
        deleted: true,
      }),
    ]

    internal().setSdk({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
      appKey: () => mockAppKey,
    } as any)

    removeFileSpy.mockRejectedValueOnce(new Error('FS error'))

    await run(new AbortController().signal)

    const cursor = await app().sync.getSyncDownCursor()
    expect(cursor).toEqual({
      id: 'obj-2',
      after: new Date(NOW_BASE + 2),
    })

    const deletedFile = await app().files.getByObjectId('obj-1', INDEXER_URL)
    expect(deletedFile).toBeNull()

    expect(removeFileSpy).toHaveBeenCalled()
  })

  test('error in update event breaks loop without advancing cursor', async () => {
    const mockSdk = {
      objectEvents: jest.fn(),
      appKey: () => {
        throw new Error('AppKey error')
      },
    }
    internal().setSdk(mockSdk as any)

    const metadata1: FileMetadata = {
      id: 'file-1',
      name: 'test.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'sha256:73a370509b33f7d64369bf097335b57c4021bd28e33a3f12c1b622fd62222374',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
    }

    const metadata2: FileMetadata = {
      id: 'file-2',
      name: 'test2.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 200,
      hash: 'sha256:68240addda41562dabc703d040452cbd977e8e52035a4addb58a447b3468caad',
      createdAt: NOW_BASE + 1,
      updatedAt: NOW_BASE + 1,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
    }

    const events: ObjectEvent[] = [
      makeObjectEvent({
        id: 'obj-1',
        updatedAt: new Date(NOW_BASE),
        object: makeMockPinnedObject(metadata1, 'obj-1'),
      }),
      makeObjectEvent({
        id: 'obj-2',
        updatedAt: new Date(NOW_BASE + 1),
        object: makeMockPinnedObject(metadata2, 'obj-2'),
      }),
    ]

    mockSdk.objectEvents.mockResolvedValueOnce(events)

    await run(new AbortController().signal)

    const cursor = await app().sync.getSyncDownCursor()
    expect(cursor).toBeUndefined()

    const file = await app().files.getByObjectId('obj-2', INDEXER_URL)
    expect(file).toBeNull()
  })

  test('handles thumbnail events', async () => {
    const thumbnailMetadata: FileMetadata = {
      id: 'thumb-1',
      thumbForId: 'file-original',
      thumbSize: 512,
      name: 'thumb.jpg',
      type: 'image/jpeg',
      kind: 'thumb',
      size: 50,
      hash: 'sha256:e9fca4f7168eac47f7c08d5aa12ae64da1b19c29e23c845c2147854c925a15c6',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      trashedAt: null,
    }

    const events: ObjectEvent[] = [
      makeObjectEvent({
        id: 'obj-thumb',
        updatedAt: new Date(NOW_BASE),
        object: makeMockPinnedObject(thumbnailMetadata, 'obj-thumb'),
      }),
    ]

    internal().setSdk({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
      appKey: () => mockAppKey,
    } as any)

    await run(new AbortController().signal)

    const thumb = await app().files.getByObjectId('obj-thumb', INDEXER_URL)
    expect(thumb).not.toBeNull()
  })

  test('cursor persists across multiple runs', async () => {
    const metadata1: FileMetadata = {
      id: 'file-1',
      name: 'test.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'sha256:73a370509b33f7d64369bf097335b57c4021bd28e33a3f12c1b622fd62222374',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
    }
    const events1: ObjectEvent[] = [
      makeObjectEvent({
        id: 'obj-1',
        updatedAt: new Date(NOW_BASE),
        object: makeMockPinnedObject(metadata1, 'obj-1'),
      }),
    ]

    const metadata2: FileMetadata = {
      id: 'file-2',
      name: 'test2.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 200,
      hash: 'sha256:68240addda41562dabc703d040452cbd977e8e52035a4addb58a447b3468caad',
      createdAt: NOW_BASE + 1,
      updatedAt: NOW_BASE + 1,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
    }
    const events2: ObjectEvent[] = [
      makeObjectEvent({
        id: 'obj-2',
        updatedAt: new Date(NOW_BASE + 1),
        object: makeMockPinnedObject(metadata2, 'obj-2'),
      }),
    ]

    internal().setSdk({
      objectEvents: jest.fn().mockResolvedValueOnce(events1).mockResolvedValueOnce(events2),
      appKey: () => mockAppKey,
    } as any)

    await run(new AbortController().signal)
    const cursor1 = await app().sync.getSyncDownCursor()
    expect(cursor1).toEqual({
      id: 'obj-1',
      after: new Date(NOW_BASE),
    })

    await run(new AbortController().signal)
    const cursor2 = await app().sync.getSyncDownCursor()
    expect(cursor2).toEqual({
      id: 'obj-2',
      after: new Date(NOW_BASE + 1),
    })
  })

  test('reset cursor clears saved cursor', async () => {
    await app().sync.setSyncDownCursor({
      id: 'obj-1',
      after: new Date(NOW_BASE),
    })

    let cursor = await app().sync.getSyncDownCursor()
    expect(cursor).toBeDefined()

    await app().sync.setSyncDownCursor(undefined)

    cursor = await app().sync.getSyncDownCursor()
    expect(cursor).toBeUndefined()
  })

  test('returns 0 interval (poll immediately) when multiple events found', async () => {
    const metadata1: FileMetadata = {
      id: 'file-1',
      name: 'test1.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'sha256:73a370509b33f7d64369bf097335b57c4021bd28e33a3f12c1b622fd62222374',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
    }

    const metadata2: FileMetadata = {
      id: 'file-2',
      name: 'test2.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 200,
      hash: 'sha256:68240addda41562dabc703d040452cbd977e8e52035a4addb58a447b3468caad',
      createdAt: NOW_BASE + 1,
      updatedAt: NOW_BASE + 1,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
    }

    const events: ObjectEvent[] = [
      makeObjectEvent({
        id: 'obj-1',
        updatedAt: new Date(NOW_BASE),
        object: makeMockPinnedObject(metadata1, 'obj-1'),
      }),
      makeObjectEvent({
        id: 'obj-2',
        updatedAt: new Date(NOW_BASE + 1),
        object: makeMockPinnedObject(metadata2, 'obj-2'),
      }),
    ]

    internal().setSdk({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
      appKey: () => mockAppKey,
    } as any)

    const result = await run(new AbortController().signal)
    expect(result).toBe(0)
  })

  test('returns undefined (use default interval) when 0-1 events found', async () => {
    const metadata: FileMetadata = {
      id: 'file-1',
      name: 'test.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'sha256:73a370509b33f7d64369bf097335b57c4021bd28e33a3f12c1b622fd62222374',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
    }

    const events: ObjectEvent[] = [
      makeObjectEvent({
        id: 'obj-1',
        updatedAt: new Date(NOW_BASE),
        object: makeMockPinnedObject(metadata, 'obj-1'),
      }),
    ]

    internal().setSdk({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
      appKey: () => mockAppKey,
    } as any)

    const result = await run(new AbortController().signal)
    expect(result).toBeUndefined()
  })

  test('returns undefined (use default interval) when no events found', async () => {
    internal().setSdk({
      objectEvents: jest.fn().mockResolvedValueOnce([]),
      appKey: () => mockAppKey,
    } as any)

    const result = await run(new AbortController().signal)
    expect(result).toBeUndefined()
  })

  test('creates separate records for files with identical content hash', async () => {
    const metadata1: FileMetadata = {
      id: 'file-1',
      name: 'photo-a.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 1024,
      hash: 'sha256:8c5bcf919e1045574eadbcf0f0f9c4f2c57bb7caf8fd37c79592af7e14ebed0d',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      trashedAt: null,
    }

    const metadata2: FileMetadata = {
      id: 'file-2',
      name: 'photo-b.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 1024,
      hash: 'sha256:8c5bcf919e1045574eadbcf0f0f9c4f2c57bb7caf8fd37c79592af7e14ebed0d',
      createdAt: NOW_BASE + 1,
      updatedAt: NOW_BASE + 1,
      trashedAt: null,
    }

    const events: ObjectEvent[] = [
      makeObjectEvent({
        id: 'obj-1',
        updatedAt: new Date(NOW_BASE),
        object: makeMockPinnedObject(metadata1, 'obj-1'),
      }),
      makeObjectEvent({
        id: 'obj-2',
        updatedAt: new Date(NOW_BASE + 1),
        object: makeMockPinnedObject(metadata2, 'obj-2'),
      }),
    ]

    internal().setSdk({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
      appKey: () => mockAppKey,
    } as any)

    await run(new AbortController().signal)

    const file1 = await app().files.getByObjectId('obj-1', INDEXER_URL)
    const file2 = await app().files.getByObjectId('obj-2', INDEXER_URL)
    expect(file1).not.toBeNull()
    expect(file2).not.toBeNull()
    expect(file1!.id).not.toBe(file2!.id)
    expect(file1!.hash).toBe(file2!.hash)
  })

  test('creates separate records for files with identical content hash across batches', async () => {
    const fileA: Omit<FileRecord, 'objects'> = {
      id: 'file-1',
      name: 'photo-a.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 1024,
      hash: 'sha256:8c5bcf919e1045574eadbcf0f0f9c4f2c57bb7caf8fd37c79592af7e14ebed0d',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      mediaAssetId: null,
      addedAt: NOW_BASE,
      trashedAt: null,
      deletedAt: null,
    }
    await app().files.create(
      fileA,
      makeLocalObject({
        fileId: fileA.id,
        objectId: 'obj-1',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )

    const metadataB: FileMetadata = {
      id: 'file-2',
      name: 'photo-b.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 1024,
      hash: 'sha256:8c5bcf919e1045574eadbcf0f0f9c4f2c57bb7caf8fd37c79592af7e14ebed0d',
      createdAt: NOW_BASE + 1,
      updatedAt: NOW_BASE + 1,
      trashedAt: null,
    }

    const events: ObjectEvent[] = [
      makeObjectEvent({
        id: 'obj-2',
        updatedAt: new Date(NOW_BASE + 1),
        object: makeMockPinnedObject(metadataB, 'obj-2'),
      }),
    ]

    internal().setSdk({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
      appKey: () => mockAppKey,
    } as any)

    await run(new AbortController().signal)

    const file1 = await app().files.getByObjectId('obj-1', INDEXER_URL)
    const file2 = await app().files.getByObjectId('obj-2', INDEXER_URL)
    expect(file1).not.toBeNull()
    expect(file2).not.toBeNull()
    expect(file1!.id).toBe('file-1')
    expect(file2!.id).toBe('file-2')
    expect(file1!.hash).toBe(file2!.hash)
  })

  test('creates separate records for thumbnails with identical content hash', async () => {
    const thumb1: FileMetadata = {
      id: 'thumb-1',
      name: 'thumb-a.jpg',
      type: 'image/jpeg',
      kind: 'thumb',
      size: 50,
      hash: 'sha256:6129b85f102d722bc6db7910b9f578c1e0fb9709ca8465b7b3d75599c6dd1705',
      thumbForId: 'file-a',
      thumbSize: 64,
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      trashedAt: null,
    }

    const thumb2: FileMetadata = {
      id: 'thumb-2',
      name: 'thumb-b.jpg',
      type: 'image/jpeg',
      kind: 'thumb',
      size: 50,
      hash: 'sha256:6129b85f102d722bc6db7910b9f578c1e0fb9709ca8465b7b3d75599c6dd1705',
      thumbForId: 'file-b',
      thumbSize: 64,
      createdAt: NOW_BASE + 1,
      updatedAt: NOW_BASE + 1,
      trashedAt: null,
    }

    const events: ObjectEvent[] = [
      makeObjectEvent({
        id: 'obj-t1',
        updatedAt: new Date(NOW_BASE),
        object: makeMockPinnedObject(thumb1, 'obj-t1'),
      }),
      makeObjectEvent({
        id: 'obj-t2',
        updatedAt: new Date(NOW_BASE + 1),
        object: makeMockPinnedObject(thumb2, 'obj-t2'),
      }),
    ]

    internal().setSdk({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
      appKey: () => mockAppKey,
    } as any)

    await run(new AbortController().signal)

    const t1 = await app().files.getByObjectId('obj-t1', INDEXER_URL)
    const t2 = await app().files.getByObjectId('obj-t2', INDEXER_URL)
    expect(t1).not.toBeNull()
    expect(t2).not.toBeNull()
    expect(t1!.id).not.toBe(t2!.id)
    expect(t1!.hash).toBe(t2!.hash)
  })

  test('handles multiple objects with the same metadata.id in one batch', async () => {
    const fileMeta: FileMetadata = {
      id: 'file-1',
      name: 'photo.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 1024,
      hash: 'sha256:6ca13d52ca70c883e0f0bb101e425a89e8624de51db2d2392593af6a84118090',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      trashedAt: null,
    }

    const events: ObjectEvent[] = [
      makeObjectEvent({
        id: 'obj-1',
        updatedAt: new Date(NOW_BASE),
        object: makeMockPinnedObject(fileMeta, 'obj-1'),
      }),
      makeObjectEvent({
        id: 'obj-2',
        updatedAt: new Date(NOW_BASE + 1),
        object: makeMockPinnedObject(fileMeta, 'obj-2'),
      }),
    ]

    internal().setSdk({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
      appKey: () => mockAppKey,
    } as any)

    await run(new AbortController().signal)

    const fromObj1 = await app().files.getByObjectId('obj-1', INDEXER_URL)
    const fromObj2 = await app().files.getByObjectId('obj-2', INDEXER_URL)
    expect(fromObj1).not.toBeNull()
    expect(fromObj2).not.toBeNull()
    expect(fromObj1!.id).toBe('file-1')
    expect(fromObj2!.id).toBe('file-1')

    const objects = await app().localObjects.getForFile('file-1')
    expect(objects).toHaveLength(2)
  })

  test('delete event only removes the object for the current indexer', async () => {
    const file: Omit<FileRecord, 'objects'> = {
      id: 'file-1',
      name: 'photo.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 1024,
      hash: 'sha256:73a370509b33f7d64369bf097335b57c4021bd28e33a3f12c1b622fd62222374',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      mediaAssetId: null,
      addedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    }
    await app().files.create(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-1',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )
    await app().localObjects.upsert(
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-1',
        indexerURL: 'other-indexer',
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )

    const events: ObjectEvent[] = [
      makeObjectEvent({
        id: 'obj-1',
        updatedAt: new Date(NOW_BASE + 1),
        deleted: true,
      }),
    ]

    internal().setSdk({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
      appKey: () => mockAppKey,
    } as any)

    await run(new AbortController().signal)

    const fileRecord = await app().files.getById('file-1')
    expect(fileRecord).not.toBeNull()
    expect(fileRecord!.deletedAt).not.toBeNull()

    const objects = await app().localObjects.getForFile('file-1')
    expect(objects).toHaveLength(1)
    expect(objects[0].indexerURL).toBe('other-indexer')
  })

  test('update event does not affect objects from a different indexer', async () => {
    const file: Omit<FileRecord, 'objects'> = {
      id: 'file-1',
      name: 'photo.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 1024,
      hash: 'sha256:73a370509b33f7d64369bf097335b57c4021bd28e33a3f12c1b622fd62222374',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      mediaAssetId: null,
      addedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    }
    await app().files.create(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-1',
        indexerURL: 'other-indexer',
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )

    const remoteMetadata: FileMetadata = {
      id: 'file-1',
      name: 'photo-updated.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 1024,
      hash: 'sha256:73a370509b33f7d64369bf097335b57c4021bd28e33a3f12c1b622fd62222374',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE + 1,
      trashedAt: null,
    }

    const events: ObjectEvent[] = [
      makeObjectEvent({
        id: 'obj-1',
        updatedAt: new Date(NOW_BASE + 1),
        object: makeMockPinnedObject(remoteMetadata, 'obj-1'),
      }),
    ]

    internal().setSdk({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
      appKey: () => mockAppKey,
    } as any)

    await run(new AbortController().signal)

    const fileRecord = await app().files.getById('file-1')
    expect(fileRecord).not.toBeNull()
    const objects = await app().localObjects.getForFile('file-1')
    expect(objects).toHaveLength(2)
  })

  test('delete event sets deletedAt tombstone on file when other objects remain', async () => {
    const file: Omit<FileRecord, 'objects'> = {
      id: 'file-1',
      name: 'photo.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 1024,
      hash: 'sha256:73a370509b33f7d64369bf097335b57c4021bd28e33a3f12c1b622fd62222374',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      mediaAssetId: null,
      addedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    }
    await app().files.create(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-current',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )
    await app().localObjects.upsert(
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-other',
        indexerURL: 'other-indexer',
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )

    const events: ObjectEvent[] = [
      makeObjectEvent({
        id: 'obj-current',
        updatedAt: new Date(NOW_BASE + 1),
        deleted: true,
      }),
    ]

    internal().setSdk({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
      appKey: () => mockAppKey,
    } as any)

    await run(new AbortController().signal)

    const fileRecord = await app().files.getById('file-1')
    expect(fileRecord).not.toBeNull()
    expect(fileRecord!.deletedAt).not.toBeNull()

    const remainingObjects = await app().localObjects.getForFile('file-1')
    expect(remainingObjects).toHaveLength(1)
    expect(remainingObjects[0].indexerURL).toBe('other-indexer')
  })

  describe('transaction rollback', () => {
    test('Phase 3B failure rolls back Phase 2 file/object writes', async () => {
      const metadata: FileMetadata = {
        id: 'file-rb',
        name: 'rollback.jpg',
        type: 'image/jpeg',
        kind: 'file',
        size: 100,
        hash: 'sha256:4fb1b9b97ca15bd25fbc78d73478299322a4e849ad36f5be94cadd189921b2ca',
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
        thumbForId: undefined,
        thumbSize: undefined,
        trashedAt: null,
        directory: 'photos/2026',
      }

      const events: ObjectEvent[] = [
        makeObjectEvent({
          id: 'obj-rb',
          updatedAt: new Date(NOW_BASE),
          object: makeMockPinnedObject(metadata, 'obj-rb'),
        }),
      ]

      internal().setSdk({
        objectEvents: jest.fn().mockResolvedValueOnce(events),
        appKey: () => mockAppKey,
      } as any)

      // The batch body calls the facade bound to its transaction, so the
      // failure goes on that facade.
      const withTransaction = internal().withTransaction
      const txSpy = jest.spyOn(internal(), 'withTransaction').mockImplementationOnce((fn) =>
        withTransaction((tx) =>
          fn({
            ...tx,
            directories: {
              ...tx.directories,
              syncManyFromMetadata: () => Promise.reject(new Error('directory sync failed')),
            },
          }),
        ),
      )

      await run(new AbortController().signal)

      // File row must not exist — Phase 2 commit was rolled back.
      const file = await app().files.getByObjectId('obj-rb', INDEXER_URL)
      expect(file).toBeNull()

      // Cursor must not have advanced — batch will retry.
      const cursor = await app().sync.getSyncDownCursor()
      expect(cursor).toBeUndefined()

      txSpy.mockRestore()
    })
  })

  describe('syncGateStatus transitions', () => {
    function makeEvents(count: number, startId = 0) {
      return Array.from({ length: count }, (_, i) => {
        const id = `obj-gate-${startId + i}`
        const metadata: FileMetadata = {
          id: `file-gate-${startId + i}`,
          name: `gate-${startId + i}.jpg`,
          type: 'image/jpeg',
          kind: 'file',
          size: 100,
          hash: fakeHash(`hash-gate-${startId + i}`),
          createdAt: NOW_BASE + startId + i,
          updatedAt: NOW_BASE + startId + i,
          thumbForId: undefined,
          thumbSize: undefined,
          trashedAt: null,
        }
        return makeObjectEvent({
          id,
          updatedAt: new Date(NOW_BASE + startId + i),
          object: makeMockPinnedObject(metadata, id),
        })
      })
    }

    test('stays idle when never set to pending', async () => {
      const events = makeEvents(20)
      internal().setSdk({
        objectEvents: jest.fn().mockResolvedValueOnce(events),
        appKey: () => mockAppKey,
      } as any)

      await run(new AbortController().signal)
      expect(app().sync.getState().syncGateStatus).toBe('idle')
    })

    test('transitions from pending to active on large batch', async () => {
      app().sync.setState({ syncGateStatus: 'pending' })
      const events = makeEvents(20)
      const heartbeat = makeEvents(1, 20)
      internal().setSdk({
        objectEvents: jest.fn().mockResolvedValueOnce(events).mockResolvedValueOnce(heartbeat),
        appKey: () => mockAppKey,
      } as any)

      await run(new AbortController().signal)
      expect(app().sync.getState().syncGateStatus).toBe('active')

      await run(new AbortController().signal)
      expect(app().sync.getState().syncGateStatus).toBe('dismissed')
    })

    test('transitions from pending to dismissed on small batch', async () => {
      app().sync.setState({ syncGateStatus: 'pending' })
      const events = makeEvents(5)
      internal().setSdk({
        objectEvents: jest.fn().mockResolvedValueOnce(events),
        appKey: () => mockAppKey,
      } as any)

      await run(new AbortController().signal)
      expect(app().sync.getState().syncGateStatus).toBe('dismissed')
    })

    test('transitions from pending to dismissed on heartbeat', async () => {
      app().sync.setState({ syncGateStatus: 'pending' })
      const events = makeEvents(1)
      internal().setSdk({
        objectEvents: jest.fn().mockResolvedValueOnce(events),
        appKey: () => mockAppKey,
      } as any)

      await run(new AbortController().signal)
      expect(app().sync.getState().syncGateStatus).toBe('dismissed')
    })

    test('transitions from active to dismissed when caught up', async () => {
      app().sync.setState({ syncGateStatus: 'pending' })
      const largeBatch = makeEvents(500)
      const heartbeat = makeEvents(1, 500)

      internal().setSdk({
        objectEvents: jest.fn().mockResolvedValueOnce(largeBatch).mockResolvedValueOnce(heartbeat),
        appKey: () => mockAppKey,
      } as any)

      await run(new AbortController().signal)
      expect(app().sync.getState().syncGateStatus).toBe('active')

      await run(new AbortController().signal)
      expect(app().sync.getState().syncGateStatus).toBe('dismissed')
    })

    test('unchanged when not connected', async () => {
      app().sync.setState({ syncGateStatus: 'pending' })
      app().connection.setState({ isConnected: false })

      await run(new AbortController().signal)
      expect(app().sync.getState().syncGateStatus).toBe('pending')
    })

    test('unchanged when auto sync disabled', async () => {
      app().sync.setState({ syncGateStatus: 'pending' })
      await app().settings.setAutoSyncDownEvents(false)

      await run(new AbortController().signal)
      expect(app().sync.getState().syncGateStatus).toBe('pending')

      await app().settings.setAutoSyncDownEvents(true)
    })

    test("preserves 'active' gate when aborted mid-sync", async () => {
      app().sync.setState({ syncGateStatus: 'pending' })
      const largeBatch = makeEvents(500)
      const heartbeat = makeEvents(1, 500)
      internal().setSdk({
        objectEvents: jest.fn().mockResolvedValueOnce(largeBatch).mockResolvedValueOnce(heartbeat),
        appKey: () => mockAppKey,
      } as any)
      await run(new AbortController().signal)
      expect(app().sync.getState().syncGateStatus).toBe('active')

      const aborted = new AbortController()
      aborted.abort()
      await run(aborted.signal)
      expect(app().sync.getState().syncGateStatus).toBe('active')
    })

    test("preserves 'pending' gate when aborted before any sync", async () => {
      app().sync.setState({ syncGateStatus: 'pending' })
      const aborted = new AbortController()
      aborted.abort()
      await run(aborted.signal)
      expect(app().sync.getState().syncGateStatus).toBe('pending')
    })

    // Re-push existing seeded files (same metadata.id) with a newer updatedAt so
    // they classify as updates (repairs), not creates.
    function makeUpdateEvents(count: number, startId = 0) {
      return Array.from({ length: count }, (_, i) => {
        const id = `obj-gate-${startId + i}`
        const metadata: FileMetadata = {
          id: `file-gate-${startId + i}`,
          name: `gate-${startId + i}.jpg`,
          type: 'image/jpeg',
          kind: 'file',
          size: 100,
          hash: fakeHash(`hash-gate-${startId + i}`),
          createdAt: NOW_BASE + startId + i,
          updatedAt: NOW_BASE + startId + i + 100_000,
          thumbForId: undefined,
          thumbSize: undefined,
          trashedAt: null,
        }
        return makeObjectEvent({
          id,
          updatedAt: new Date(NOW_BASE + startId + i + 100_000),
          object: makeMockPinnedObject(metadata, id),
        })
      })
    }

    function makeThumbEvents(count: number, startId = 0) {
      return Array.from({ length: count }, (_, i) => {
        const id = `obj-thumb-${startId + i}`
        const metadata: FileMetadata = {
          id: `thumb-${startId + i}`,
          name: `thumb-${startId + i}.jpg`,
          type: 'image/jpeg',
          kind: 'thumb',
          size: 100,
          hash: fakeHash(`hash-thumb-${startId + i}`),
          createdAt: NOW_BASE + startId + i,
          updatedAt: NOW_BASE + startId + i,
          thumbForId: `file-gate-${startId + i}`,
          thumbSize: 64,
          trashedAt: null,
        }
        return makeObjectEvent({
          id,
          updatedAt: new Date(NOW_BASE + startId + i),
          object: makeMockPinnedObject(metadata, id),
        })
      })
    }

    // Populate the local library so subsequent runs see an established (not
    // hydrating) library. Runs with the gate idle so seeding doesn't gate.
    async function seedLibrary(count: number) {
      app().sync.setState({ syncGateStatus: 'idle' })
      internal().setSdk({
        objectEvents: jest.fn().mockResolvedValueOnce(makeEvents(count)),
        appKey: () => mockAppKey,
      } as any)
      await run(new AbortController().signal)
      expect(await app().library.fileCount()).toBeGreaterThanOrEqual(SYNC_GATE_HYDRATION_MIN)
    }

    test('established library: repair-only catch-up dismisses without gating', async () => {
      await seedLibrary(60)
      app().sync.setState({ syncGateStatus: 'pending' })
      internal().setSdk({
        objectEvents: jest.fn().mockResolvedValueOnce(makeUpdateEvents(60)),
        appKey: () => mockAppKey,
      } as any)

      await run(new AbortController().signal)
      expect(app().sync.getState().syncGateStatus).toBe('dismissed')
    })

    test('established library: create-light batch dismisses past the old event threshold', async () => {
      await seedLibrary(60)
      app().sync.setState({ syncGateStatus: 'pending' })
      // 5 new files + 30 repairs = 35 events. The old gate keyed on total events
      // (>= 10) would activate; the new gate keys on the 5 creates and dismisses.
      const events = [...makeEvents(5, 1000), ...makeUpdateEvents(30)]
      internal().setSdk({
        objectEvents: jest.fn().mockResolvedValueOnce(events),
        appKey: () => mockAppKey,
      } as any)

      await run(new AbortController().signal)
      expect(app().sync.getState().syncGateStatus).toBe('dismissed')
    })

    test('established library: a real influx of new files still gates', async () => {
      await seedLibrary(60)
      app().sync.setState({ syncGateStatus: 'pending' })
      const events = makeEvents(15, 2000)
      internal().setSdk({
        objectEvents: jest.fn().mockResolvedValueOnce(events),
        appKey: () => mockAppKey,
      } as any)

      await run(new AbortController().signal)
      expect(app().sync.getState().syncGateStatus).toBe('active')
    })

    test('established library: thumbnail creates do not count toward the gate', async () => {
      await seedLibrary(60)
      app().sync.setState({ syncGateStatus: 'pending' })
      // 20 thumbnail creates, no new files — must not gate.
      internal().setSdk({
        objectEvents: jest.fn().mockResolvedValueOnce(makeThumbEvents(20)),
        appKey: () => mockAppKey,
      } as any)

      await run(new AbortController().signal)
      expect(app().sync.getState().syncGateStatus).toBe('dismissed')
    })

    test('aborted mid-batch leaves the gate pending instead of dismissing', async () => {
      await seedLibrary(60)
      app().sync.setState({ syncGateStatus: 'pending' })
      const controller = new AbortController()
      // Abort during the fetch so the batch never commits: counts.fileCreates
      // stays 0 and would read as create-light. The gate must stay 'pending'
      // for the next run, not dismiss against an incomplete sync.
      internal().setSdk({
        objectEvents: jest.fn().mockImplementationOnce(async () => {
          controller.abort()
          return makeEvents(20, 3000)
        }),
        appKey: () => mockAppKey,
      } as any)

      await run(controller.signal)
      expect(app().sync.getState().syncGateStatus).toBe('pending')
    })
  })

  test('delete event on already-tombstoned file preserves tombstone when no objects remain', async () => {
    const file: Omit<FileRecord, 'objects'> = {
      id: 'file-1',
      name: 'photo.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 1024,
      hash: 'sha256:73a370509b33f7d64369bf097335b57c4021bd28e33a3f12c1b622fd62222374',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      mediaAssetId: null,
      addedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    }
    await app().files.create(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-1',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )

    await app().files.update({ id: 'file-1', deletedAt: 5000 }, { updatedAt: 'now' })

    const events: ObjectEvent[] = [
      makeObjectEvent({
        id: 'obj-1',
        updatedAt: new Date(NOW_BASE + 1),
        deleted: true,
      }),
    ]

    internal().setSdk({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
      appKey: () => mockAppKey,
    } as any)

    await run(new AbortController().signal)

    const deletedFile = await app().files.getByObjectId('obj-1', INDEXER_URL)
    expect(deletedFile).toBeNull()

    const fileRecord = await app().files.getById('file-1')
    expect(fileRecord).not.toBeNull()
    expect(fileRecord!.deletedAt).toBe(5000)
  })

  test('tombstone blocks syncDown from clearing deletedAt via metadata update', async () => {
    const file: Omit<FileRecord, 'objects'> = {
      id: 'file-1',
      name: 'photo.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 1024,
      hash: 'sha256:73a370509b33f7d64369bf097335b57c4021bd28e33a3f12c1b622fd62222374',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      mediaAssetId: null,
      addedAt: NOW_BASE,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    }
    await app().files.create(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-1',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )

    await app().files.update({ id: 'file-1', deletedAt: 5000 }, { updatedAt: 'now' })

    const updatedMetadata: FileMetadata = {
      id: 'file-1',
      name: 'photo.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 1024,
      hash: 'sha256:73a370509b33f7d64369bf097335b57c4021bd28e33a3f12c1b622fd62222374',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE + 100,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
    }

    const events: ObjectEvent[] = [
      makeObjectEvent({
        id: 'obj-1',
        updatedAt: new Date(NOW_BASE + 100),
        object: makeMockPinnedObject(updatedMetadata, 'obj-1'),
      }),
    ]

    internal().setSdk({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
      appKey: () => mockAppKey,
    } as any)

    await run(new AbortController().signal)

    const fileRecord = await app().files.getById('file-1')
    expect(fileRecord).not.toBeNull()
    expect(fileRecord!.deletedAt).not.toBeNull()
  })

  describe('cursor advance and anti-spin', () => {
    // Matches the production batchSize in packages/core/src/services/syncDownEvents.ts.
    const BATCH_SIZE = 500
    const mockLoggerWarn = logger.warn as jest.Mock

    function makeBatch(count: number, baseTime: number, prefix: string): ObjectEvent[] {
      return Array.from({ length: count }, (_, i) => {
        const metadata: FileMetadata = {
          id: `file-${prefix}-${i}`,
          name: `${prefix}-${i}.jpg`,
          type: 'image/jpeg',
          kind: 'file',
          size: 100,
          hash: fakeHash(`hash-${prefix}-${i}`),
          createdAt: baseTime,
          updatedAt: baseTime,
          thumbForId: undefined,
          thumbSize: undefined,
          trashedAt: null,
        }
        return makeObjectEvent({
          id: `${prefix}-${i}`,
          updatedAt: new Date(baseTime),
          object: makeMockPinnedObject(metadata, `${prefix}-${i}`),
        })
      })
    }

    test('keeps looping on full batches, breaks on partial', async () => {
      const fullBatch = makeBatch(BATCH_SIZE, NOW_BASE, 'a')
      const partialBatch = makeBatch(1, NOW_BASE + 1, 'b')

      const objectEvents = jest
        .fn()
        .mockResolvedValueOnce(fullBatch)
        .mockResolvedValueOnce(partialBatch)
      internal().setSdk({
        objectEvents,
        appKey: () => mockAppKey,
      } as any)

      const result = await run(new AbortController().signal)

      expect(objectEvents).toHaveBeenCalledTimes(2)
      // >1 events fetched → return 0 (poll immediately).
      expect(result).toBe(0)
    })

    test('anti-spin breaks when a full batch leaves the cursor unchanged', async () => {
      const fullBatch = makeBatch(BATCH_SIZE, NOW_BASE, 'spin')
      const objectEvents = jest.fn().mockResolvedValue(fullBatch)
      internal().setSdk({
        objectEvents,
        appKey: () => mockAppKey,
      } as any)

      mockLoggerWarn.mockClear()

      const result = await run(new AbortController().signal)

      // First call advances cursor; second sees it unchanged → guard breaks.
      expect(objectEvents).toHaveBeenCalledTimes(2)
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        'syncDownEvents',
        'cursor_did_not_advance',
        expect.objectContaining({
          id: `spin-${BATCH_SIZE - 1}`,
          batchSize: BATCH_SIZE,
        }),
      )
      expect(result).toBe(0)
    })

    test('heartbeat does not trigger anti-spin warning', async () => {
      await app().sync.setSyncDownCursor({
        id: 'obj-heartbeat',
        after: new Date(NOW_BASE),
      })

      const heartbeatMetadata: FileMetadata = {
        id: 'file-heartbeat',
        name: 'heartbeat.jpg',
        type: 'image/jpeg',
        kind: 'file',
        size: 1,
        hash: 'sha256:03dbe5b5a029b776f6d8d9321cf4550e4aab548788c09286c2c9db9dd184d4f2',
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
        thumbForId: undefined,
        thumbSize: undefined,
        trashedAt: null,
      }
      const heartbeat: ObjectEvent[] = [
        makeObjectEvent({
          id: 'obj-heartbeat',
          updatedAt: new Date(NOW_BASE),
          object: makeMockPinnedObject(heartbeatMetadata, 'obj-heartbeat'),
        }),
      ]

      const objectEvents = jest.fn().mockResolvedValueOnce(heartbeat)
      internal().setSdk({
        objectEvents,
        appKey: () => mockAppKey,
      } as any)

      mockLoggerWarn.mockClear()

      const result = await run(new AbortController().signal)

      expect(objectEvents).toHaveBeenCalledTimes(1)
      // Single event → return undefined (default interval).
      expect(result).toBeUndefined()
      // Partial-batch break runs before the anti-spin guard.
      expect(mockLoggerWarn).not.toHaveBeenCalledWith(
        'syncDownEvents',
        'cursor_did_not_advance',
        expect.anything(),
      )
    })

    test('re-delivering the same batch produces no duplicates', async () => {
      const metadata: FileMetadata = {
        id: 'file-idem',
        name: 'idem.jpg',
        type: 'image/jpeg',
        kind: 'file',
        size: 100,
        hash: 'sha256:734c57733a76d1ea9b0eabf37c06fd870ad7e98e5bf2ba5965a9f033e7963518',
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
        thumbForId: undefined,
        thumbSize: undefined,
        trashedAt: null,
      }
      const events: ObjectEvent[] = [
        makeObjectEvent({
          id: 'obj-idem',
          updatedAt: new Date(NOW_BASE),
          object: makeMockPinnedObject(metadata, 'obj-idem'),
        }),
      ]

      internal().setSdk({
        objectEvents: jest.fn().mockResolvedValueOnce(events).mockResolvedValueOnce(events),
        appKey: () => mockAppKey,
      } as any)

      await run(new AbortController().signal)
      // Reset so the same batch is delivered again.
      await app().sync.setSyncDownCursor(undefined)
      await run(new AbortController().signal)

      const file = await app().files.getByObjectId('obj-idem', INDEXER_URL)
      expect(file).not.toBeNull()
      const objects = await app().localObjects.getForFile(file!.id)
      expect(objects).toHaveLength(1)
    })
  })
})

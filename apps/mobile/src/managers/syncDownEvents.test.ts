import { encodeFileMetadata } from '@siastorage/core/encoding/fileMetadata'
import type { LocalObject } from '@siastorage/core/encoding/localObject'
import type { FileMetadata, FileRecord } from '@siastorage/core/types'
import type { ObjectEvent, PinnedObjectInterface } from 'react-native-sia'
import { initializeDB, resetDb } from '../db'
import { app, internal } from '../stores/appService'
import { run } from './syncDownEvents'

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

let removeFileSpy: jest.SpyInstance
const cursorIncrement = 1

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
      hash: 'hash-1',
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
      hash: 'hash-2',
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
      after: new Date(NOW_BASE + 1 + cursorIncrement),
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
      hash: 'hash-1',
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
      after: new Date(NOW_BASE + cursorIncrement),
    })
  })

  test('handles delete event by removing file record and fs files', async () => {
    const file: Omit<FileRecord, 'objects'> = {
      id: 'file-1',
      name: 'test.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-1',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      localId: null,
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
      hash: 'hash-1',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      localId: null,
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
      hash: 'hash-1',
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
      hash: 'hash-new',
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
      hash: 'hash-1',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      localId: null,
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
      hash: 'hash-1',
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
        hash: 'hash-1',
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

  test('does not merge metadata when remote is older', async () => {
    const file: Omit<FileRecord, 'objects'> = {
      id: 'file-1',
      name: 'newer-name.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-1',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE + 100,
      localId: null,
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
      hash: 'hash-1',
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
      hash: 'hash-1',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      localId: null,
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
      after: new Date(NOW_BASE + 2 + cursorIncrement),
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
      hash: 'hash-1',
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
      hash: 'hash-2',
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
      hash: 'hash-thumb',
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
      hash: 'hash-1',
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
      hash: 'hash-2',
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
      after: new Date(NOW_BASE + cursorIncrement),
    })

    await run(new AbortController().signal)
    const cursor2 = await app().sync.getSyncDownCursor()
    expect(cursor2).toEqual({
      id: 'obj-2',
      after: new Date(NOW_BASE + 1 + cursorIncrement),
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
      hash: 'hash-1',
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
      hash: 'hash-2',
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
      hash: 'hash-1',
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
      hash: 'same-hash',
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
      hash: 'same-hash',
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
      hash: 'same-hash',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      localId: null,
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
      hash: 'same-hash',
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
      hash: 'same-thumb-hash',
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
      hash: 'same-thumb-hash',
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
      hash: 'abc123',
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
      hash: 'hash-1',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      localId: null,
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
      hash: 'hash-1',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      localId: null,
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
      hash: 'hash-1',
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
      hash: 'hash-1',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      localId: null,
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
        hash: 'hash-rb',
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

      const dirSpy = jest
        .spyOn(app().directories, 'syncManyFromMetadata')
        .mockRejectedValueOnce(new Error('directory sync failed'))

      await run(new AbortController().signal)

      // File row must not exist — Phase 2 commit was rolled back.
      const file = await app().files.getByObjectId('obj-rb', INDEXER_URL)
      expect(file).toBeNull()

      // Cursor must not have advanced — batch will retry.
      const cursor = await app().sync.getSyncDownCursor()
      expect(cursor).toBeUndefined()

      dirSpy.mockRestore()
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
          hash: `hash-gate-${startId + i}`,
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

    test('transitions pending → active on large batch', async () => {
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

    test('transitions pending → dismissed on small batch', async () => {
      app().sync.setState({ syncGateStatus: 'pending' })
      const events = makeEvents(5)
      internal().setSdk({
        objectEvents: jest.fn().mockResolvedValueOnce(events),
        appKey: () => mockAppKey,
      } as any)

      await run(new AbortController().signal)
      expect(app().sync.getState().syncGateStatus).toBe('dismissed')
    })

    test('transitions pending → dismissed on heartbeat', async () => {
      app().sync.setState({ syncGateStatus: 'pending' })
      const events = makeEvents(1)
      internal().setSdk({
        objectEvents: jest.fn().mockResolvedValueOnce(events),
        appKey: () => mockAppKey,
      } as any)

      await run(new AbortController().signal)
      expect(app().sync.getState().syncGateStatus).toBe('dismissed')
    })

    test('transitions active → dismissed when caught up', async () => {
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
  })

  test('delete event on already-tombstoned file preserves tombstone when no objects remain', async () => {
    const file: Omit<FileRecord, 'objects'> = {
      id: 'file-1',
      name: 'photo.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 1024,
      hash: 'hash-1',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      localId: null,
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

    await app().files.update({ id: 'file-1', deletedAt: 5000 })

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
      hash: 'hash-1',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      localId: null,
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

    await app().files.update({ id: 'file-1', deletedAt: 5000 })

    const updatedMetadata: FileMetadata = {
      id: 'file-1',
      name: 'photo.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 1024,
      hash: 'hash-1',
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
})

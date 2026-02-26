import { encodeFileMetadata } from '@siastorage/core/encoding/fileMetadata'
import type { LocalObject } from '@siastorage/core/encoding/localObject'
import type { ObjectEvent, PinnedObjectInterface } from 'react-native-sia'
import { db, initializeDB, resetDb } from '../db'
import { getAppKeyForIndexer } from '../stores/appKey'
import {
  createFileRecordWithLocalObject,
  type FileMetadata,
  type FileRecord,
  readFileRecord,
  readFileRecordByObjectId,
  updateFileRecord,
} from '../stores/files'
import { removeFsFile } from '../stores/fs'
import {
  readLocalObjectsForFile,
  upsertLocalObject,
} from '../stores/localObjects'
import { getIsConnected, getSdk } from '../stores/sdk'
import { getIndexerURL } from '../stores/settings'
import { removeTempDownloadFile } from '../stores/tempFs'
import { removeUpload } from '../stores/uploads'
import {
  getSyncDownCursor,
  resetSyncDownCursor,
  setSyncDownCursor,
  syncDownEvents,
} from './syncDownEvents'

jest.mock('../stores/sdk', () => ({
  getIsConnected: jest.fn(),
  getSdk: jest.fn(),
}))
jest.mock('../stores/settings', () => ({
  getAutoSyncDownEvents: jest.fn(),
  getIndexerURL: jest.fn(),
}))
jest.mock('../stores/fs', () => ({
  removeFsFile: jest.fn(),
}))
jest.mock('../stores/tempFs', () => ({
  removeTempDownloadFile: jest.fn(),
}))
jest.mock('../stores/uploads', () => ({
  removeUpload: jest.fn(),
}))
jest.mock('../stores/appKey', () => ({
  getAppKeyForIndexer: jest.fn(),
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

function makeMockPinnedObject(
  metadata: FileMetadata,
  objectId: string = 'obj-id',
  createdAt: Date = new Date(),
  updatedAt: Date = new Date(),
): PinnedObjectInterface {
  const encodedMetadata = encodeFileMetadata(
    metadata,
    metadata.kind === 'thumb'
      ? { thumbForHash: `hash-for-${metadata.thumbForId}` }
      : undefined,
  )
  return {
    id: () => objectId,
    metadata: () => encodedMetadata,
    slabs: () => [],
    size: () => BigInt(metadata.size),
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

const getSdkMock = jest.mocked(getSdk)
const getIndexerURLMock = jest.mocked(getIndexerURL)
const removeFsFileMock = jest.mocked(removeFsFile)
const removeTempDownloadFileMock = jest.mocked(removeTempDownloadFile)
const removeUploadMock = jest.mocked(removeUpload)
const getAppKeyForIndexerMock = jest.mocked(getAppKeyForIndexer)
const getIsConnectedMock = jest.mocked(getIsConnected)

const cursorIncrement = 1

describe('syncDownEvents', () => {
  const INDEXER_URL = 'indexer-url'
  const NOW_BASE = 1000

  beforeEach(async () => {
    await initializeDB()
    jest.clearAllMocks()
    await resetSyncDownCursor()
    getIsConnectedMock.mockReturnValue(true)
    getIndexerURLMock.mockResolvedValue(INDEXER_URL)
    removeFsFileMock.mockResolvedValue(undefined)
    removeTempDownloadFileMock.mockResolvedValue(undefined)
    removeUploadMock.mockReturnValue(undefined)
    getAppKeyForIndexerMock.mockResolvedValue({} as any)
  })

  afterEach(async () => {
    await resetDb()
  })

  test('early exit when not connected', async () => {
    getIsConnectedMock.mockReturnValue(false)
    await syncDownEvents(new AbortController().signal)
    expect(getSdkMock).not.toHaveBeenCalled()
  })

  test('early exit when no sdk', async () => {
    getIsConnectedMock.mockReturnValue(true)
    getSdkMock.mockReturnValue(null)
    await syncDownEvents(new AbortController().signal)
    const cur = await getSyncDownCursor()
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

    getSdkMock.mockReturnValue({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents(new AbortController().signal)

    expect(getSdkMock).toHaveBeenCalledTimes(1)

    // Verify cursor was updated correctly.
    const cursor = await getSyncDownCursor()
    expect(cursor).toEqual({
      id: 'obj-2',
      after: new Date(NOW_BASE + 1 + cursorIncrement),
    })

    // Verify files were inserted into database.
    const file1 = await readFileRecordByObjectId('obj-1', INDEXER_URL)
    expect(file1).not.toBeNull()
    const objects1 = await readLocalObjectsForFile(file1!.id)
    expect(objects1).toHaveLength(1)

    const file2 = await readFileRecordByObjectId('obj-2', INDEXER_URL)
    expect(file2).not.toBeNull()
    const objects2 = await readLocalObjectsForFile(file2!.id)
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

    getSdkMock.mockReturnValue({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents(new AbortController().signal)

    // Should only call once since batch is not full.
    expect(getSdkMock).toHaveBeenCalledTimes(1)
    const cursor = await getSyncDownCursor()
    expect(cursor).toEqual({
      id: 'obj-1',
      after: new Date(NOW_BASE + cursorIncrement),
    })
  })

  test('handles delete event by removing file record and fs files', async () => {
    // Create existing file.
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
    await createFileRecordWithLocalObject(
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

    getSdkMock.mockReturnValue({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents(new AbortController().signal)

    expect(removeFsFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'file-1' }),
    )
    expect(removeTempDownloadFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'file-1' }),
    )

    const deletedFile = await readFileRecordByObjectId('obj-1', INDEXER_URL)
    expect(deletedFile).toBeNull()
  })

  test('handles update event for existing file', async () => {
    // Create existing file.
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
    await createFileRecordWithLocalObject(
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

    getSdkMock.mockReturnValue({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents(new AbortController().signal)

    expect(removeUploadMock).toHaveBeenCalledWith('file-1')
    const updatedFile = await readFileRecordByObjectId('obj-1', INDEXER_URL)
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

    getSdkMock.mockReturnValue({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents(new AbortController().signal)

    const newFile = await readFileRecordByObjectId('obj-1', INDEXER_URL)
    expect(newFile).not.toBeNull()
  })

  test('merges metadata correctly when remote is newer', async () => {
    // Create existing file with older metadata.
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
    await createFileRecordWithLocalObject(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-1',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )

    // Remote has newer metadata with different values.
    const newerRemoteMetadata: FileMetadata = {
      id: 'file-1',
      name: 'new-name.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-1',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE + 100, // Newer timestamp.
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

    getSdkMock.mockReturnValue({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents(new AbortController().signal)

    // Verify all metadata fields were merged from remote since it's newer.
    const updatedFile = await readFileRecordByObjectId('obj-1', INDEXER_URL)
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

    // Verify object was updated in objects table.
    const objects = await readLocalObjectsForFile(updatedFile!.id)
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
    // Create existing file with newer metadata.
    const file: Omit<FileRecord, 'objects'> = {
      id: 'file-1',
      name: 'newer-name.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-1',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE + 100, // Newer timestamp.
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
        objectId: 'obj-1',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE + 100,
      }),
    )

    // Remote has older metadata with different values.
    const olderRemoteMetadata: FileMetadata = {
      id: 'file-1',
      name: 'older-name.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-1',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE, // Older timestamp.
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

    getSdkMock.mockReturnValue({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents(new AbortController().signal)

    // Verify local metadata was preserved since it's newer.
    const file2 = await readFileRecordByObjectId('obj-1', INDEXER_URL)
    expect(file2).not.toBeNull()
    expect(file2).toEqual(
      expect.objectContaining({
        name: 'newer-name.jpg',
        updatedAt: NOW_BASE + 100,
      }),
    )

    // Verify object was still updated in objects table.
    const objects = await readLocalObjectsForFile(file2!.id)
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

    jest.mocked(getSdk).mockReturnValue({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents(new AbortController().signal)

    const file = await readFileRecordByObjectId('obj-1', INDEXER_URL)
    expect(file).toBeNull()
  })

  test('FS error in delete cleanup does not prevent cursor advancement', async () => {
    // Create existing file.
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
    await createFileRecordWithLocalObject(
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

    jest.mocked(getSdk).mockReturnValue({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
    } as any)

    // Simulate error during file system removal (cleanup phase).
    jest.mocked(removeFsFile).mockRejectedValueOnce(new Error('FS error'))

    await syncDownEvents(new AbortController().signal)

    // Cursor should have advanced because DB commit succeeded (FS cleanup is non-fatal).
    const cursor = await getSyncDownCursor()
    expect(cursor).toEqual({
      id: 'obj-2',
      after: new Date(NOW_BASE + 2 + cursorIncrement),
    })

    // File should be deleted from DB.
    const deletedFile = await readFileRecordByObjectId('obj-1', INDEXER_URL)
    expect(deletedFile).toBeNull()

    // Verify that removeFsFile was still called.
    expect(removeFsFile).toHaveBeenCalled()
  })

  test('error in update event breaks loop without advancing cursor', async () => {
    const mockSdk = {
      objectEvents: jest.fn(),
    }
    jest.mocked(getSdk).mockReturnValue(mockSdk as any)

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

    // Simulate error during seal operation by making appKey throw.
    jest
      .mocked(getAppKeyForIndexer)
      .mockRejectedValueOnce(new Error('AppKey error'))

    await syncDownEvents(new AbortController().signal)

    // Cursor should not have advanced because error broke the loop.
    const cursor = await getSyncDownCursor()
    expect(cursor).toBeUndefined()

    // Second event should not have been processed.
    const file = await readFileRecordByObjectId('obj-2', INDEXER_URL)
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

    getSdkMock.mockReturnValue({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents(new AbortController().signal)

    // Verify the thumbnail was created.
    const thumb = await readFileRecordByObjectId('obj-thumb', INDEXER_URL)
    expect(thumb).not.toBeNull()
  })

  test('cursor persists across multiple runs', async () => {
    // First run events.
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

    // Second run events.
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
    // Second run should use cursor from first run.
    const events2: ObjectEvent[] = [
      makeObjectEvent({
        id: 'obj-2',
        updatedAt: new Date(NOW_BASE + 1),
        object: makeMockPinnedObject(metadata2, 'obj-2'),
      }),
    ]

    getSdkMock.mockReturnValue({
      objectEvents: jest
        .fn()
        .mockResolvedValueOnce(events1)
        .mockResolvedValueOnce(events2),
    } as any)

    // First run.
    await syncDownEvents(new AbortController().signal)
    const cursor1 = await getSyncDownCursor()
    expect(cursor1).toEqual({
      id: 'obj-1',
      after: new Date(NOW_BASE + cursorIncrement),
    })

    // Second run.
    await syncDownEvents(new AbortController().signal)
    const cursor2 = await getSyncDownCursor()
    expect(cursor2).toEqual({
      id: 'obj-2',
      after: new Date(NOW_BASE + 1 + cursorIncrement),
    })
  })

  test('reset cursor clears saved cursor', async () => {
    await setSyncDownCursor({
      id: 'obj-1',
      after: new Date(NOW_BASE),
    })

    let cursor = await getSyncDownCursor()
    expect(cursor).toBeDefined()

    await resetSyncDownCursor()

    cursor = await getSyncDownCursor()
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

    getSdkMock.mockReturnValue({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
    } as any)

    const result = await syncDownEvents(new AbortController().signal)
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

    getSdkMock.mockReturnValue({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
    } as any)

    const result = await syncDownEvents(new AbortController().signal)
    expect(result).toBeUndefined()
  })

  test('returns undefined (use default interval) when no events found', async () => {
    getSdkMock.mockReturnValue({
      objectEvents: jest.fn().mockResolvedValueOnce([]),
    } as any)

    const result = await syncDownEvents(new AbortController().signal)
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

    getSdkMock.mockReturnValue({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents(new AbortController().signal)

    const file1 = await readFileRecordByObjectId('obj-1', INDEXER_URL)
    const file2 = await readFileRecordByObjectId('obj-2', INDEXER_URL)
    expect(file1).not.toBeNull()
    expect(file2).not.toBeNull()
    expect(file1!.id).not.toBe(file2!.id)
    expect(file1!.hash).toBe(file2!.hash)
  })

  test('creates separate records for files with identical content hash across batches', async () => {
    // File A already in DB from a previous sync.
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
    await createFileRecordWithLocalObject(
      fileA,
      makeLocalObject({
        fileId: fileA.id,
        objectId: 'obj-1',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )

    // File B arrives in a new batch with different ID but same hash.
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

    getSdkMock.mockReturnValue({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents(new AbortController().signal)

    const file1 = await readFileRecordByObjectId('obj-1', INDEXER_URL)
    const file2 = await readFileRecordByObjectId('obj-2', INDEXER_URL)
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

    getSdkMock.mockReturnValue({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents(new AbortController().signal)

    const t1 = await readFileRecordByObjectId('obj-t1', INDEXER_URL)
    const t2 = await readFileRecordByObjectId('obj-t2', INDEXER_URL)
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

    // Two different objects on the indexer share the same metadata.id
    // (e.g., same file uploaded from two devices pre-migration)
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

    getSdkMock.mockReturnValue({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents(new AbortController().signal)

    // One file record, but both objects associated
    const fromObj1 = await readFileRecordByObjectId('obj-1', INDEXER_URL)
    const fromObj2 = await readFileRecordByObjectId('obj-2', INDEXER_URL)
    expect(fromObj1).not.toBeNull()
    expect(fromObj2).not.toBeNull()
    expect(fromObj1!.id).toBe('file-1')
    expect(fromObj2!.id).toBe('file-1')

    // Both local objects point to the same file
    const objects = await readLocalObjectsForFile('file-1')
    expect(objects).toHaveLength(2)
  })

  test('does not create duplicate when v1 thumb has null thumbForId (post-migration)', async () => {
    // Simulate post-migration state: thumb exists with thumbForId=NULL because
    // migration 0004 couldn't resolve the parent hash → file ID.
    const parent: Omit<FileRecord, 'objects'> = {
      id: 'parent-file',
      name: 'photo.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 1024,
      hash: 'parent-hash',
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
      parent,
      makeLocalObject({
        fileId: parent.id,
        objectId: 'obj-parent',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )

    const thumb: Omit<FileRecord, 'objects'> = {
      id: 'thumb-id',
      name: 'thumbnail.webp',
      type: 'image/webp',
      kind: 'thumb',
      size: 4318,
      hash: 'thumb-hash',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      localId: null,
      addedAt: NOW_BASE,
      thumbForId: undefined, // NULL — migration couldn't resolve
      thumbSize: 64,
      trashedAt: null,
      deletedAt: null,
    }
    await createFileRecordWithLocalObject(
      thumb,
      makeLocalObject({
        fileId: thumb.id,
        objectId: 'obj-thumb',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )

    // Simulate the v1 metadata that syncUp pushed before the guard was added.
    // encodeFileMetadata with null thumbForId produces "thumbForId":null in JSON,
    // which causes both MetadataV1Schema and FutureVersionSchema to fail
    // (z.string().optional() rejects null), falling through to v0 decode
    // which returns id=''.
    const rawMetadata = JSON.stringify({
      version: 1,
      id: 'thumb-id',
      name: 'thumbnail.webp',
      type: 'image/webp',
      kind: 'thumb',
      size: 4318,
      hash: 'thumb-hash',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      thumbForId: null,
      thumbForHash: 'parent-hash',
      thumbSize: 64,
    })
    const encodedMetadata = new TextEncoder().encode(rawMetadata)
      .buffer as ArrayBuffer

    const mockPinnedObject: PinnedObjectInterface = {
      id: () => 'obj-thumb',
      metadata: () => encodedMetadata,
      slabs: () => [],
      size: () => BigInt(4318),
      createdAt: () => new Date(NOW_BASE),
      updatedAt: () => new Date(NOW_BASE + 1),
      updateMetadata: () => {},
      seal: () => ({
        id: 'obj-thumb',
        slabs: [],
        encryptedDataKey: new ArrayBuffer(32),
        encryptedMetadataKey: new ArrayBuffer(32),
        encryptedMetadata: encodedMetadata,
        dataSignature: new ArrayBuffer(64),
        metadataSignature: new ArrayBuffer(64),
        createdAt: new Date(NOW_BASE),
        updatedAt: new Date(NOW_BASE + 1),
      }),
    }

    const events: ObjectEvent[] = [
      makeObjectEvent({
        id: 'obj-thumb',
        updatedAt: new Date(NOW_BASE + 1),
        object: mockPinnedObject,
      }),
    ]

    getSdkMock.mockReturnValue({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
    } as any)

    const countBefore = (await db().getFirstAsync<{ c: number }>(
      'SELECT COUNT(*) as c FROM files',
    ))!.c

    await syncDownEvents(new AbortController().signal)

    const countAfter = (await db().getFirstAsync<{ c: number }>(
      'SELECT COUNT(*) as c FROM files',
    ))!.c

    // The existing thumb should be found via objectId fallback — no duplicate.
    expect(countAfter).toBe(countBefore)

    // Original thumb record should still be accessible.
    const thumbRecord = await readFileRecordByObjectId('obj-thumb', INDEXER_URL)
    expect(thumbRecord).not.toBeNull()
    expect(thumbRecord!.id).toBe('thumb-id')
  })

  test('adopt: single object migrates to canonical remote ID', async () => {
    const file: Omit<FileRecord, 'objects'> = {
      id: 'local-id-xyz',
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
    await createFileRecordWithLocalObject(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-1',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )

    const remoteMetadata: FileMetadata = {
      id: 'remote-id-abc',
      name: 'photo.jpg',
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

    getSdkMock.mockReturnValue({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents(new AbortController().signal)

    const adopted = await readFileRecord('remote-id-abc')
    expect(adopted).not.toBeNull()
    expect(adopted!.name).toBe('photo.jpg')

    const old = await readFileRecord('local-id-xyz')
    expect(old).toBeNull()

    const fromObj = await readFileRecordByObjectId('obj-1', INDEXER_URL)
    expect(fromObj).not.toBeNull()
    expect(fromObj!.id).toBe('remote-id-abc')
  })

  test('adopt: preserves localId and addedAt from old record', async () => {
    const file: Omit<FileRecord, 'objects'> = {
      id: 'local-id',
      name: 'photo.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 1024,
      hash: 'hash-1',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      localId: 'device-local-123',
      addedAt: NOW_BASE - 500,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    }
    await createFileRecordWithLocalObject(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-1',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )

    const remoteMetadata: FileMetadata = {
      id: 'canonical-id',
      name: 'photo.jpg',
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

    getSdkMock.mockReturnValue({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents(new AbortController().signal)

    const adopted = await readFileRecord('canonical-id')
    expect(adopted).not.toBeNull()
    expect(adopted!.localId).toBe('device-local-123')
    expect(adopted!.addedAt).toBe(NOW_BASE - 500)
  })

  test('adopt: two objects sharing a file both migrate in one batch', async () => {
    // A file with two objects (e.g. pinned to two indexers).
    const file: Omit<FileRecord, 'objects'> = {
      id: 'old-local-id',
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
    await createFileRecordWithLocalObject(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-1',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )
    await upsertLocalObject(
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-2',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )

    // Both objects arrive with the same canonical metadata.id.
    const remoteMetadata: FileMetadata = {
      id: 'canonical-id',
      name: 'photo.jpg',
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
      makeObjectEvent({
        id: 'obj-2',
        updatedAt: new Date(NOW_BASE + 2),
        object: makeMockPinnedObject(remoteMetadata, 'obj-2'),
      }),
    ]

    getSdkMock.mockReturnValue({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents(new AbortController().signal)

    // Old file record should be gone.
    const old = await readFileRecord('old-local-id')
    expect(old).toBeNull()

    // New canonical file record should exist.
    const adopted = await readFileRecord('canonical-id')
    expect(adopted).not.toBeNull()

    // Both objects should point to the canonical file.
    const fromObj1 = await readFileRecordByObjectId('obj-1', INDEXER_URL)
    expect(fromObj1).not.toBeNull()
    expect(fromObj1!.id).toBe('canonical-id')

    const fromObj2 = await readFileRecordByObjectId('obj-2', INDEXER_URL)
    expect(fromObj2).not.toBeNull()
    expect(fromObj2!.id).toBe('canonical-id')

    // Both local objects should exist for the file.
    const objects = await readLocalObjectsForFile('canonical-id')
    expect(objects).toHaveLength(2)
  })

  test('adopt: thumbnail migrates to canonical remote ID', async () => {
    const thumb: Omit<FileRecord, 'objects'> = {
      id: 'local-thumb-id',
      name: 'thumb.webp',
      type: 'image/webp',
      kind: 'thumb',
      size: 512,
      hash: 'thumb-hash',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      localId: null,
      addedAt: NOW_BASE,
      thumbForId: 'parent-file',
      thumbSize: 64,
      trashedAt: null,
      deletedAt: null,
    }
    await createFileRecordWithLocalObject(
      thumb,
      makeLocalObject({
        fileId: thumb.id,
        objectId: 'obj-thumb',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )

    const remoteMetadata: FileMetadata = {
      id: 'canonical-thumb-id',
      name: 'thumb.webp',
      type: 'image/webp',
      kind: 'thumb',
      size: 512,
      hash: 'thumb-hash',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE + 1,
      thumbForId: 'parent-file',
      thumbSize: 64,
      trashedAt: null,
    }

    const events: ObjectEvent[] = [
      makeObjectEvent({
        id: 'obj-thumb',
        updatedAt: new Date(NOW_BASE + 1),
        object: makeMockPinnedObject(remoteMetadata, 'obj-thumb'),
      }),
    ]

    getSdkMock.mockReturnValue({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents(new AbortController().signal)

    const adopted = await readFileRecord('canonical-thumb-id')
    expect(adopted).not.toBeNull()
    expect(adopted!.thumbForId).toBe('parent-file')
    expect(adopted!.kind).toBe('thumb')

    const old = await readFileRecord('local-thumb-id')
    expect(old).toBeNull()

    const fromObj = await readFileRecordByObjectId('obj-thumb', INDEXER_URL)
    expect(fromObj).not.toBeNull()
    expect(fromObj!.id).toBe('canonical-thumb-id')
  })

  test('delete event only removes the object for the current indexer', async () => {
    // File with two objects: one on the current indexer, one on another.
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
    await createFileRecordWithLocalObject(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-1',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )
    await upsertLocalObject(
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-1',
        indexerURL: 'other-indexer',
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )

    // Delete event for obj-1 from the current indexer.
    const events: ObjectEvent[] = [
      makeObjectEvent({
        id: 'obj-1',
        updatedAt: new Date(NOW_BASE + 1),
        deleted: true,
      }),
    ]

    getSdkMock.mockReturnValue({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents(new AbortController().signal)

    // Tombstoned file row must persist — tombstones are never removed.
    const fileRecord = await readFileRecord('file-1')
    expect(fileRecord).not.toBeNull()
    expect(fileRecord!.deletedAt).not.toBeNull()

    // The other indexer's object should still be present.
    const objects = await readLocalObjectsForFile('file-1')
    expect(objects).toHaveLength(1)
    expect(objects[0].indexerURL).toBe('other-indexer')
  })

  test('update event does not affect objects from a different indexer', async () => {
    // File with an object on a different indexer.
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
    await createFileRecordWithLocalObject(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-1',
        indexerURL: 'other-indexer',
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )

    // Event arrives with the same objectId but from the current indexer.
    // Since readFileRecordByObjectId is scoped, it should NOT find the
    // existing file and should create a new one.
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

    getSdkMock.mockReturnValue({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents(new AbortController().signal)

    // File should exist and have objects from both indexers.
    const fileRecord = await readFileRecord('file-1')
    expect(fileRecord).not.toBeNull()
    const objects = await readLocalObjectsForFile('file-1')
    expect(objects).toHaveLength(2)
  })

  test('delete event sets deletedAt tombstone on file when other objects remain', async () => {
    // Create a file with two objects: one on the current indexer, one on another.
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
    await upsertLocalObject(
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

    getSdkMock.mockReturnValue({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents(new AbortController().signal)

    // Tombstoned file row must persist — tombstones are never removed.
    const fileRecord = await readFileRecord('file-1')
    expect(fileRecord).not.toBeNull()
    expect(fileRecord!.deletedAt).not.toBeNull()

    // Only the other indexer's object should remain.
    const remainingObjects = await readLocalObjectsForFile('file-1')
    expect(remainingObjects).toHaveLength(1)
    expect(remainingObjects[0].indexerURL).toBe('other-indexer')
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
    await createFileRecordWithLocalObject(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-1',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )

    await updateFileRecord({ id: 'file-1', deletedAt: 5000 })

    const events: ObjectEvent[] = [
      makeObjectEvent({
        id: 'obj-1',
        updatedAt: new Date(NOW_BASE + 1),
        deleted: true,
      }),
    ]

    getSdkMock.mockReturnValue({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents(new AbortController().signal)

    // Object row should be gone.
    const deletedFile = await readFileRecordByObjectId('obj-1', INDEXER_URL)
    expect(deletedFile).toBeNull()

    // Tombstoned file row must persist even with zero objects remaining.
    const fileRecord = await readFileRecord('file-1')
    expect(fileRecord).not.toBeNull()
    expect(fileRecord!.deletedAt).toBe(5000)
  })

  test('tombstone blocks syncDown from clearing deletedAt via metadata update', async () => {
    // Create a file with a single object.
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
    await createFileRecordWithLocalObject(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-1',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )

    // Tombstone the file.
    await updateFileRecord({ id: 'file-1', deletedAt: 5000 })

    // Inject a metadata UPDATE event for the same object with a newer updatedAt.
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

    getSdkMock.mockReturnValue({
      objectEvents: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents(new AbortController().signal)

    // The tombstone must NOT be cleared by the metadata merge, because
    // toFileRecordFields does not include deletedAt.
    const fileRecord = await readFileRecord('file-1')
    expect(fileRecord).not.toBeNull()
    expect(fileRecord!.deletedAt).not.toBeNull()
  })
})

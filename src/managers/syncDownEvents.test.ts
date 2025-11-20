import {
  syncDownEvents,
  getSyncDownCursor,
  setSyncDownCursor,
  resetSyncDownCursor,
} from './syncDownEvents'
import { initializeDB, resetDb } from '../db'
import {
  createFileRecordWithLocalObject,
  readFileRecordByObjectId,
  type FileRecord,
  type FileMetadata,
} from '../stores/files'
import { type LocalObject } from '../encoding/localObject'
import { type ObjectEvent, type PinnedObjectInterface } from 'react-native-sia'
import { encodeFileMetadata } from '../encoding/fileMetadata'
import { readLocalObjectsForFile } from '../stores/localObjects'
import { getIsConnected, getSdk } from '../stores/sdk'
import { getIndexerURL } from '../stores/settings'
import { removeFsFile } from '../stores/fs'
import { removeTempDownloadFile } from '../stores/tempFs'
import { cancelUpload } from '../stores/uploads'
import { getAppKey } from '../lib/appKey'

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
  cancelUpload: jest.fn(),
}))
jest.mock('../lib/appKey', () => ({
  getAppKey: jest.fn(),
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

function makeMockPinnedObject(
  metadata: FileMetadata,
  objectId: string = 'obj-id',
  createdAt: Date = new Date(),
  updatedAt: Date = new Date()
): PinnedObjectInterface {
  const encodedMetadata = encodeFileMetadata(metadata)
  return {
    id: () => objectId,
    metadata: () => encodedMetadata,
    slabs: () => [],
    size: () => BigInt(metadata.size),
    createdAt: () => createdAt,
    updatedAt: () => updatedAt,
    updateMetadata: (newMetadata: ArrayBuffer) => {
      // Not used in tests
    },
    seal: () => ({
      id: objectId,
      slabs: [],
      encryptedMasterKey: new ArrayBuffer(32),
      encryptedMetadata: encodedMetadata,
      signature: new ArrayBuffer(64),
      createdAt,
      updatedAt,
    }),
  }
}

function makeObjectEvent(params: {
  key: string
  updatedAt: Date
  deleted?: boolean
  object?: PinnedObjectInterface
}): ObjectEvent {
  return {
    key: params.key,
    updatedAt: params.updatedAt,
    deleted: params.deleted ?? false,
    object: params.object,
  }
}

const getSdkMock = jest.mocked(getSdk)
const getIndexerURLMock = jest.mocked(getIndexerURL)
const removeFsFileMock = jest.mocked(removeFsFile)
const removeTempDownloadFileMock = jest.mocked(removeTempDownloadFile)
const cancelUploadMock = jest.mocked(cancelUpload)
const getAppKeyMock = jest.mocked(getAppKey)
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
    cancelUploadMock.mockReturnValue(undefined)
    getAppKeyMock.mockResolvedValue({} as any)
  })

  afterEach(async () => {
    await resetDb()
  })

  test('early exit when not connected', async () => {
    getIsConnectedMock.mockReturnValue(false)
    await syncDownEvents()
    expect(getSdkMock).not.toHaveBeenCalled()
  })

  test('early exit when no sdk', async () => {
    getIsConnectedMock.mockReturnValue(true)
    getSdkMock.mockReturnValue(null)
    await syncDownEvents()
    const cur = await getSyncDownCursor()
    expect(cur).toBeUndefined()
  })

  test('processes full batch and updates cursor', async () => {
    const metadata1: FileMetadata = {
      name: 'test1.jpg',
      type: 'image/jpeg',
      size: 100,
      hash: 'hash-1',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      thumbForHash: undefined,
      thumbSize: undefined,
    }

    const metadata2: FileMetadata = {
      name: 'test2.jpg',
      type: 'image/jpeg',
      size: 200,
      hash: 'hash-2',
      createdAt: NOW_BASE + 1,
      updatedAt: NOW_BASE + 1,
      thumbForHash: undefined,
      thumbSize: undefined,
    }

    const events: ObjectEvent[] = [
      makeObjectEvent({
        key: 'obj-1',
        updatedAt: new Date(NOW_BASE),
        object: makeMockPinnedObject(metadata1, 'obj-1'),
      }),
      makeObjectEvent({
        key: 'obj-2',
        updatedAt: new Date(NOW_BASE + 1),
        object: makeMockPinnedObject(metadata2, 'obj-2'),
      }),
    ]

    getSdkMock.mockReturnValue({
      objects: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents()

    expect(getSdkMock).toHaveBeenCalledTimes(1)

    // Verify cursor was updated correctly.
    const cursor = await getSyncDownCursor()
    expect(cursor).toEqual({
      key: 'obj-2',
      after: new Date(NOW_BASE + 1 + cursorIncrement),
    })

    // Verify files were inserted into database.
    const file1 = await readFileRecordByObjectId('obj-1')
    expect(file1).not.toBeNull()
    const objects1 = await readLocalObjectsForFile(file1!.id)
    expect(objects1).toHaveLength(1)

    const file2 = await readFileRecordByObjectId('obj-2')
    expect(file2).not.toBeNull()
    const objects2 = await readLocalObjectsForFile(file2!.id)
    expect(objects2).toHaveLength(1)
  })

  test('stops when batch is not full', async () => {
    const metadata: FileMetadata = {
      name: 'test.jpg',
      type: 'image/jpeg',
      size: 100,
      hash: 'hash-1',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      thumbForHash: undefined,
      thumbSize: undefined,
    }

    const events: ObjectEvent[] = [
      makeObjectEvent({
        key: 'obj-1',
        updatedAt: new Date(NOW_BASE),
        object: makeMockPinnedObject(metadata, 'obj-1'),
      }),
    ]

    getSdkMock.mockReturnValue({
      objects: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents()

    // Should only call once since batch is not full.
    expect(getSdkMock).toHaveBeenCalledTimes(1)
    const cursor = await getSyncDownCursor()
    expect(cursor).toEqual({
      key: 'obj-1',
      after: new Date(NOW_BASE + cursorIncrement),
    })
  })

  test('handles delete event by removing file record and fs files', async () => {
    // Create existing file.
    const file: Omit<FileRecord, 'objects'> = {
      id: 'file-1',
      name: 'test.jpg',
      type: 'image/jpeg',
      size: 100,
      hash: 'hash-1',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      localId: null,
      addedAt: NOW_BASE,
      thumbForHash: undefined,
      thumbSize: undefined,
    }
    await createFileRecordWithLocalObject(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-1',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      })
    )

    const events: ObjectEvent[] = [
      makeObjectEvent({
        key: 'obj-1',
        updatedAt: new Date(NOW_BASE + 1),
        deleted: true,
      }),
    ]

    getSdkMock.mockReturnValue({
      objects: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents()

    expect(removeFsFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'file-1' })
    )
    expect(removeTempDownloadFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'file-1' })
    )

    const deletedFile = await readFileRecordByObjectId('obj-1')
    expect(deletedFile).toBeNull()
  })

  test('handles update event for existing file', async () => {
    // Create existing file.
    const file: Omit<FileRecord, 'objects'> = {
      id: 'file-1',
      name: 'test.jpg',
      type: 'image/jpeg',
      size: 100,
      hash: 'hash-1',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      localId: null,
      addedAt: NOW_BASE,
      thumbForHash: undefined,
      thumbSize: undefined,
    }
    await createFileRecordWithLocalObject(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-1',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      })
    )

    const updatedMetadata: FileMetadata = {
      name: 'test-updated.jpg',
      type: 'image/jpeg',
      size: 100,
      hash: 'hash-1',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE + 1,
      thumbForHash: undefined,
      thumbSize: undefined,
    }

    const events: ObjectEvent[] = [
      makeObjectEvent({
        key: 'obj-1',
        updatedAt: new Date(NOW_BASE + 1),
        object: makeMockPinnedObject(updatedMetadata, 'obj-1'),
      }),
    ]

    getSdkMock.mockReturnValue({
      objects: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents()

    expect(cancelUploadMock).toHaveBeenCalledWith('file-1')
    const updatedFile = await readFileRecordByObjectId('obj-1')
    expect(updatedFile).not.toBeNull()
  })

  test('handles update event for new file', async () => {
    const metadata: FileMetadata = {
      name: 'new-file.jpg',
      type: 'image/jpeg',
      size: 100,
      hash: 'hash-new',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      thumbForHash: undefined,
      thumbSize: undefined,
    }

    const events: ObjectEvent[] = [
      makeObjectEvent({
        key: 'obj-1',
        updatedAt: new Date(NOW_BASE),
        object: makeMockPinnedObject(metadata, 'obj-1'),
      }),
    ]

    getSdkMock.mockReturnValue({
      objects: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents()

    const newFile = await readFileRecordByObjectId('obj-1')
    expect(newFile).not.toBeNull()
  })

  test('merges metadata correctly when remote is newer', async () => {
    // Create existing file with older metadata.
    const file: Omit<FileRecord, 'objects'> = {
      id: 'file-1',
      name: 'old-name.jpg',
      type: 'image/jpeg',
      size: 100,
      hash: 'hash-1',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      localId: null,
      addedAt: NOW_BASE,
      thumbForHash: undefined,
      thumbSize: undefined,
    }
    await createFileRecordWithLocalObject(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-1',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      })
    )

    // Remote has newer metadata with different values.
    const newerRemoteMetadata: FileMetadata = {
      name: 'new-name.jpg',
      type: 'image/jpeg',
      size: 100,
      hash: 'hash-1',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE + 100, // Newer timestamp.
      thumbForHash: undefined,
      thumbSize: undefined,
    }

    const events: ObjectEvent[] = [
      makeObjectEvent({
        key: 'obj-1',
        updatedAt: new Date(NOW_BASE + 100),
        object: makeMockPinnedObject(newerRemoteMetadata, 'obj-1'),
      }),
    ]

    getSdkMock.mockReturnValue({
      objects: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents()

    // Verify all metadata fields were merged from remote since it's newer.
    const updatedFile = await readFileRecordByObjectId('obj-1')
    expect(updatedFile).not.toBeNull()
    expect(updatedFile).toEqual(
      expect.objectContaining({
        name: 'new-name.jpg',
        type: 'image/jpeg',
        size: 100,
        hash: 'hash-1',
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE + 100,
      })
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
      ])
    )
  })

  test('does not merge metadata when remote is older', async () => {
    // Create existing file with newer metadata.
    const file: Omit<FileRecord, 'objects'> = {
      id: 'file-1',
      name: 'newer-name.jpg',
      type: 'image/jpeg',
      size: 100,
      hash: 'hash-1',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE + 100, // Newer timestamp.
      localId: null,
      addedAt: NOW_BASE,
      thumbForHash: undefined,
      thumbSize: undefined,
    }
    await createFileRecordWithLocalObject(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-1',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE + 100,
      })
    )

    // Remote has older metadata with different values.
    const olderRemoteMetadata: FileMetadata = {
      name: 'older-name.jpg',
      type: 'image/jpeg',
      size: 100,
      hash: 'hash-1',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE, // Older timestamp.
      thumbForHash: undefined,
      thumbSize: undefined,
    }

    const events: ObjectEvent[] = [
      makeObjectEvent({
        key: 'obj-1',
        updatedAt: new Date(NOW_BASE),
        object: makeMockPinnedObject(olderRemoteMetadata, 'obj-1'),
      }),
    ]

    getSdkMock.mockReturnValue({
      objects: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents()

    // Verify local metadata was preserved since it's newer.
    const file2 = await readFileRecordByObjectId('obj-1')
    expect(file2).not.toBeNull()
    expect(file2).toEqual(
      expect.objectContaining({
        name: 'newer-name.jpg',
        updatedAt: NOW_BASE + 100,
      })
    )

    // Verify object was still updated in objects table.
    const objects = await readLocalObjectsForFile(file2!.id)
    expect(objects).toHaveLength(1)
  })

  test('skips events with incomplete metadata', async () => {
    const incompleteMetadata: FileMetadata = {
      name: 'incomplete.jpg',
      type: '',
      size: 0,
      hash: '',
      createdAt: 0,
      updatedAt: 0,
      thumbForHash: undefined,
      thumbSize: undefined,
    }

    const events: ObjectEvent[] = [
      makeObjectEvent({
        key: 'obj-1',
        updatedAt: new Date(NOW_BASE),
        object: makeMockPinnedObject(incompleteMetadata, 'obj-1'),
      }),
    ]

    jest.mocked(getSdk).mockReturnValue({
      objects: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents()

    const file = await readFileRecordByObjectId('obj-1')
    expect(file).toBeNull()
  })

  test('error in delete event breaks loop without advancing cursor', async () => {
    // Create existing file.
    const file: Omit<FileRecord, 'objects'> = {
      id: 'file-1',
      name: 'test.jpg',
      type: 'image/jpeg',
      size: 100,
      hash: 'hash-1',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      localId: null,
      addedAt: NOW_BASE,
      thumbForHash: undefined,
      thumbSize: undefined,
    }
    await createFileRecordWithLocalObject(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-1',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      })
    )

    // First event will fail during delete.
    const events: ObjectEvent[] = [
      makeObjectEvent({
        key: 'obj-1',
        updatedAt: new Date(NOW_BASE + 1),
        deleted: true,
      }),
      makeObjectEvent({
        key: 'obj-2',
        updatedAt: new Date(NOW_BASE + 2),
        deleted: true,
      }),
    ]

    jest.mocked(getSdk).mockReturnValue({
      objects: jest.fn().mockResolvedValueOnce(events),
    } as any)

    // Simulate error during file system removal.
    jest.mocked(removeFsFile).mockRejectedValueOnce(new Error('FS error'))

    await syncDownEvents()

    // Cursor should not have advanced because error broke the loop.
    const cursor = await getSyncDownCursor()
    expect(cursor).toBeUndefined()

    // Verify that removeFsFile was called, indicating the delete was attempted.
    expect(removeFsFile).toHaveBeenCalled()
  })

  test('error in update event breaks loop without advancing cursor', async () => {
    const mockSdk = {
      objects: jest.fn(),
    }
    jest.mocked(getSdk).mockReturnValue(mockSdk as any)

    const metadata1: FileMetadata = {
      name: 'test.jpg',
      type: 'image/jpeg',
      size: 100,
      hash: 'hash-1',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      thumbForHash: undefined,
      thumbSize: undefined,
    }

    const metadata2: FileMetadata = {
      name: 'test2.jpg',
      type: 'image/jpeg',
      size: 200,
      hash: 'hash-2',
      createdAt: NOW_BASE + 1,
      updatedAt: NOW_BASE + 1,
      thumbForHash: undefined,
      thumbSize: undefined,
    }

    const events: ObjectEvent[] = [
      makeObjectEvent({
        key: 'obj-1',
        updatedAt: new Date(NOW_BASE),
        object: makeMockPinnedObject(metadata1, 'obj-1'),
      }),
      makeObjectEvent({
        key: 'obj-2',
        updatedAt: new Date(NOW_BASE + 1),
        object: makeMockPinnedObject(metadata2, 'obj-2'),
      }),
    ]

    mockSdk.objects.mockResolvedValueOnce(events)

    // Simulate error during seal operation by making appKey throw.
    jest.mocked(getAppKey).mockRejectedValueOnce(new Error('AppKey error'))

    await syncDownEvents()

    // Cursor should not have advanced because error broke the loop.
    const cursor = await getSyncDownCursor()
    expect(cursor).toBeUndefined()

    // Second event should not have been processed.
    const file = await readFileRecordByObjectId('obj-2')
    expect(file).toBeNull()
  })

  test('handles thumbnail events', async () => {
    const thumbnailMetadata: FileMetadata = {
      thumbForHash: 'hash-original',
      thumbSize: 512,
      name: 'thumb.jpg',
      type: 'image/jpeg',
      size: 50,
      hash: 'hash-thumb',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
    }

    const events: ObjectEvent[] = [
      makeObjectEvent({
        key: 'obj-thumb',
        updatedAt: new Date(NOW_BASE),
        object: makeMockPinnedObject(thumbnailMetadata, 'obj-thumb'),
      }),
    ]

    getSdkMock.mockReturnValue({
      objects: jest.fn().mockResolvedValueOnce(events),
    } as any)

    await syncDownEvents()

    // Verify the thumbnail was created.
    const thumb = await readFileRecordByObjectId('obj-thumb')
    expect(thumb).not.toBeNull()
  })

  test('cursor persists across multiple runs', async () => {
    // First run events.
    const metadata1: FileMetadata = {
      name: 'test.jpg',
      type: 'image/jpeg',
      size: 100,
      hash: 'hash-1',
      createdAt: NOW_BASE,
      updatedAt: NOW_BASE,
      thumbForHash: undefined,
      thumbSize: undefined,
    }
    const events1: ObjectEvent[] = [
      makeObjectEvent({
        key: 'obj-1',
        updatedAt: new Date(NOW_BASE),
        object: makeMockPinnedObject(metadata1, 'obj-1'),
      }),
    ]

    // Second run events.
    const metadata2: FileMetadata = {
      name: 'test2.jpg',
      type: 'image/jpeg',
      size: 200,
      hash: 'hash-2',
      createdAt: NOW_BASE + 1,
      updatedAt: NOW_BASE + 1,
      thumbForHash: undefined,
      thumbSize: undefined,
    }
    // Second run should use cursor from first run.
    const events2: ObjectEvent[] = [
      makeObjectEvent({
        key: 'obj-2',
        updatedAt: new Date(NOW_BASE + 1),
        object: makeMockPinnedObject(metadata2, 'obj-2'),
      }),
    ]

    getSdkMock.mockReturnValue({
      objects: jest
        .fn()
        .mockResolvedValueOnce(events1)
        .mockResolvedValueOnce(events2),
    } as any)

    // First run.
    await syncDownEvents()
    const cursor1 = await getSyncDownCursor()
    expect(cursor1).toEqual({
      key: 'obj-1',
      after: new Date(NOW_BASE + cursorIncrement),
    })

    // Second run.
    await syncDownEvents()
    const cursor2 = await getSyncDownCursor()
    expect(cursor2).toEqual({
      key: 'obj-2',
      after: new Date(NOW_BASE + 1 + cursorIncrement),
    })
  })

  test('reset cursor clears saved cursor', async () => {
    await setSyncDownCursor({
      key: 'obj-1',
      after: new Date(NOW_BASE),
    })

    let cursor = await getSyncDownCursor()
    expect(cursor).toBeDefined()

    await resetSyncDownCursor()

    cursor = await getSyncDownCursor()
    expect(cursor).toBeUndefined()
  })
})

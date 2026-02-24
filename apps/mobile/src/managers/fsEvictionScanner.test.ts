import { daysInMs } from '@siastorage/core'
import type { LocalObject } from '@siastorage/core/encoding/localObject'
import { initializeDB, resetDb } from '../db'
import {
  getAsyncStorageNumber,
  setAsyncStorageNumber,
} from '../stores/asyncStore'
import {
  createFileRecord,
  createFileRecordWithLocalObject,
  type FileRecord,
} from '../stores/files'
import { readFsFileMetadata, upsertFsFileMetadata } from '../stores/fs'
import { runFsEvictionScanner } from './fsEvictionScanner'

jest.mock('@siastorage/core/config', () => {
  const { daysInMs } = jest.requireActual('@siastorage/core')
  const actual = jest.requireActual('@siastorage/core/config')
  return {
    ...actual,
    FS_MAX_BYTES: 1_000,
    FS_EVICTION_FREQUENCY: 60_000,
    FS_EVICTABLE_MIN_AGE: daysInMs(7),
  }
})

const now = 1_000_000_000
const indexerURL = 'https://indexer.com'

describe('fsEvictionScanner', () => {
  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(now)
    await initializeDB()
    await setAsyncStorageNumber('fsEvictionLastRun', 0)
  })

  afterEach(async () => {
    jest.spyOn(Date, 'now').mockRestore()
    await resetDb()
  })

  it('does nothing when total size is below limit', async () => {
    await createRemoteFile({
      id: 'file-1',
      size: 200,
      usedAt: now - daysInMs(1000),
    })
    const result = await runFsEvictionScanner()

    expect(await readFsFileMetadata('file-1')).toBeDefined()
    expect(await getAsyncStorageNumber('fsEvictionLastRun', now)).toBe(now)
    expect(result).toBeUndefined()
  })

  it('never evicts local-only files', async () => {
    await createLocalOnlyFile({
      id: 'file-2',
      size: 300,
      usedAt: now - daysInMs(500),
    })
    await createRemoteFile({
      id: 'file-3',
      size: 400,
      usedAt: now - daysInMs(1000),
    })
    const result = await runFsEvictionScanner()

    expect(await readFsFileMetadata('file-2')).toBeDefined()
    expect(await readFsFileMetadata('file-3')).toBeDefined()
    expect(await getAsyncStorageNumber('fsEvictionLastRun', now)).toBe(now)
    expect(result).toBeUndefined()
  })

  it('evicts oldest remote files until under limit', async () => {
    // Keep
    await createLocalOnlyFile({
      id: 'file-1',
      size: 500,
      usedAt: now - daysInMs(100),
    })
    // Evict
    await createRemoteFile({
      id: 'file-2',
      size: 100,
      usedAt: now - daysInMs(10),
    })
    // Keep
    await createLocalOnlyFile({
      id: 'file-3',
      size: 300,
      usedAt: now - daysInMs(5),
    })
    // Evict
    await createRemoteFile({
      id: 'file-4',
      size: 100,
      usedAt: now - daysInMs(10),
    })
    // Keep because we are now below the limit.
    // This file is newer so others were considered earlier.
    await createRemoteFile({
      id: 'file-5',
      size: 400,
      usedAt: now - daysInMs(1),
    })
    const result = await runFsEvictionScanner()

    expect(result).toEqual({
      processedRows: 2,
      evicted: 2,
      currentSize: 1200,
    })
    expect(await readFsFileMetadata('file-1')).toBeDefined()
    expect(await readFsFileMetadata('file-2')).toBeNull()
    expect(await readFsFileMetadata('file-3')).toBeDefined()
    expect(await readFsFileMetadata('file-4')).toBeNull()
    expect(await readFsFileMetadata('file-5')).toBeDefined()
    expect(await getAsyncStorageNumber('fsEvictionLastRun', 0)).toBe(now)
  })
})

async function createRemoteFile(params: {
  id: string
  size: number
  usedAt: number
}) {
  const record = makeFileRecord(params.id, params.size)
  const localObject = makeLocalObject({
    fileId: params.id,
    objectId: `obj-${params.id}`,
    indexerURL,
    createdAt: params.usedAt,
    updatedAt: params.usedAt,
  })
  await createFileRecordWithLocalObject(record, localObject)
  await upsertFsFileMetadata({
    fileId: params.id,
    size: params.size,
    addedAt: params.usedAt,
    usedAt: params.usedAt,
  })
}

async function createLocalOnlyFile(params: {
  id: string
  size: number
  usedAt: number
}) {
  await createFileRecord(makeFileRecord(params.id, params.size))
  await upsertFsFileMetadata({
    fileId: params.id,
    size: params.size,
    addedAt: params.usedAt,
    usedAt: params.usedAt,
  })
}

function makeFileRecord(id: string, size: number): FileRecord {
  return {
    id,
    name: `${id}.jpg`,
    type: 'image/jpeg',
    kind: 'file',
    size,
    hash: `hash-${id}`,
    createdAt: now,
    updatedAt: now,
    addedAt: now,
    localId: null,
    objects: {},
  }
}

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

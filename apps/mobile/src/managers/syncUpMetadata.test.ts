import type { LocalObject } from '@siastorage/core/encoding/localObject'
import type { FileRecord } from '@siastorage/core/types'
import { db, initializeDB, resetDb } from '../db'
import { app, internal } from '../stores/appService'
import { runSyncUpMetadata } from './syncUpMetadata'

jest.mock('@siastorage/core/encoding/fileMetadata', () => ({
  ...jest.requireActual('@siastorage/core/encoding/fileMetadata'),
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

function makeFile(params: {
  id: string
  name?: string
  hash?: string
  size?: number
  createdAt?: number
  updatedAt?: number
  trashedAt?: number | null
  deletedAt?: number | null
}): Omit<FileRecord, 'objects'> {
  const ts = params.updatedAt ?? params.createdAt ?? 100
  return {
    id: params.id,
    name: params.name ?? `${params.id}.jpg`,
    type: 'image/jpeg',
    kind: 'file',
    size: params.size ?? 100,
    hash: params.hash ?? `hash-${params.id}`,
    createdAt: params.createdAt ?? 100,
    updatedAt: ts,
    localId: null,
    addedAt: params.createdAt ?? 100,
    thumbForId: undefined,
    thumbSize: undefined,
    trashedAt: params.trashedAt ?? null,
    deletedAt: params.deletedAt ?? null,
  }
}

describe('syncUpMetadata', () => {
  const meta = require('@siastorage/core/encoding/fileMetadata') as jest.Mocked<any>
  const INDEXER_URL = 'indexer-url'
  const NOW_BASE = 400
  const mockUpdateObjectMetadata = jest.fn()
  const mockDeleteObject = jest.fn()
  const mockGetPinnedObject = jest.fn()

  beforeEach(async () => {
    await initializeDB()
    jest.clearAllMocks()
    await app().settings.setIndexerURL(INDEXER_URL)
    app().connection.setState({ isConnected: true })
    internal().setSdk({
      updateObjectMetadata: mockUpdateObjectMetadata,
      deleteObject: mockDeleteObject,
      getPinnedObject: mockGetPinnedObject,
    } as any)
  })

  afterEach(async () => {
    internal().setSdk(null)
    await resetDb()
  })

  // The sync-up dirty flag lives on the object row, keyed by (indexerURL, id).
  async function flagFor(objectId: string, indexerURL = INDEXER_URL): Promise<0 | 1> {
    const row = await db().getFirstAsync<{ needsSyncUp: number }>(
      'SELECT needsSyncUp FROM objects WHERE id = ? AND indexerURL = ?',
      objectId,
      indexerURL,
    )
    return (row?.needsSyncUp ?? 0) as 0 | 1
  }

  test('updates files where local is newer, skips files where remote is newer', async () => {
    const localA = makeFile({ id: 'file-a', updatedAt: 200 })
    await app().files.create(
      localA,
      makeLocalObject({
        fileId: localA.id,
        objectId: 'obj-a',
        indexerURL: INDEXER_URL,
        createdAt: 100,
        updatedAt: 200,
      }),
    )

    const localB = makeFile({ id: 'file-b', size: 200, hash: 'hash-b', updatedAt: 100 })
    await app().files.create(
      localB,
      makeLocalObject({
        fileId: localB.id,
        objectId: 'obj-b',
        indexerURL: INDEXER_URL,
        createdAt: 110,
        updatedAt: 100,
      }),
    )

    mockGetPinnedObject.mockImplementation(async () => ({
      metadata: () => new ArrayBuffer(0),
      updateMetadata: jest.fn(),
    }))

    const remoteA = {
      name: 'file-a.jpg',
      type: 'image/jpeg',
      size: 100,
      hash: 'hash-file-a',
      createdAt: 100,
      updatedAt: 150,
      thumbForId: undefined,
      thumbSize: undefined,
    }
    const remoteB = {
      name: 'file-b.jpg',
      type: 'image/jpeg',
      size: 200,
      hash: 'hash-b',
      createdAt: 110,
      updatedAt: 200,
      thumbForId: undefined,
      thumbSize: undefined,
    }
    meta.decodeFileMetadata.mockReturnValueOnce(remoteA).mockReturnValueOnce(remoteB)

    await runSyncUpMetadata(5)

    // Only file A pushes; file B's remote was newer.
    expect(mockUpdateObjectMetadata).toHaveBeenCalledTimes(1)
    // Both objects get their flag cleared: A via successful push, B via the
    // remote-newer CAS clear (no point re-walking until something changes).
    expect(await flagFor('obj-a')).toBe(0)
    expect(await flagFor('obj-b')).toBe(0)
  })

  test('skips objects with needsSyncUp = 0 even if pinned', async () => {
    const file = makeFile({ id: 'clean', updatedAt: NOW_BASE })
    await app().files.create(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-clean',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )
    // A freshly uploaded object starts dirty; simulate an already-synced (clean)
    // object by clearing its flag.
    await app().localObjects.clearMany(INDEXER_URL, ['obj-clean'])
    expect(await flagFor('obj-clean')).toBe(0)

    await runSyncUpMetadata(5)

    expect(mockGetPinnedObject).not.toHaveBeenCalled()
    expect(mockUpdateObjectMetadata).not.toHaveBeenCalled()
  })

  test('successful push clears the flag via CAS', async () => {
    const file = makeFile({ id: 'pushme', updatedAt: 300 })
    await app().files.create(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-pushme',
        indexerURL: INDEXER_URL,
        createdAt: 100,
        updatedAt: 300,
      }),
    )

    mockGetPinnedObject.mockResolvedValue({
      metadata: () => new ArrayBuffer(0),
      updateMetadata: jest.fn(),
    })
    meta.decodeFileMetadata.mockReturnValue({
      name: 'pushme.jpg',
      type: 'image/jpeg',
      size: 100,
      hash: 'wrong-hash',
      createdAt: 100,
      updatedAt: 200,
      thumbForId: undefined,
      thumbSize: undefined,
    })

    expect(await flagFor('obj-pushme')).toBe(1)
    await runSyncUpMetadata(5)

    expect(mockUpdateObjectMetadata).toHaveBeenCalledTimes(1)
    expect(await flagFor('obj-pushme')).toBe(0)
  })

  test('failed push leaves the flag set', async () => {
    const file = makeFile({ id: 'failpush', updatedAt: 300 })
    await app().files.create(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-fail',
        indexerURL: INDEXER_URL,
        createdAt: 100,
        updatedAt: 300,
      }),
    )

    mockGetPinnedObject.mockResolvedValue({
      metadata: () => new ArrayBuffer(0),
      updateMetadata: jest.fn(),
    })
    meta.decodeFileMetadata.mockReturnValue({
      name: 'failpush.jpg',
      type: 'image/jpeg',
      size: 100,
      hash: 'remote-hash',
      createdAt: 100,
      updatedAt: 200,
      thumbForId: undefined,
      thumbSize: undefined,
    })
    mockUpdateObjectMetadata.mockRejectedValue(new Error('network'))

    await runSyncUpMetadata(5)

    expect(await flagFor('obj-fail')).toBe(1)
  })

  test('CAS clear is no-op when a local edit lands after the metadata snapshot', async () => {
    const file = makeFile({ id: 'concurrent', updatedAt: 300 })
    await app().files.create(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-concurrent',
        indexerURL: INDEXER_URL,
        createdAt: 100,
        updatedAt: 300,
      }),
    )

    mockGetPinnedObject.mockResolvedValue({
      metadata: () => new ArrayBuffer(0),
      updateMetadata: jest.fn(),
    })
    meta.decodeFileMetadata.mockReturnValue({
      name: 'concurrent.jpg',
      type: 'image/jpeg',
      size: 100,
      hash: 'remote-hash',
      createdAt: 100,
      updatedAt: 200,
      thumbForId: undefined,
      thumbSize: undefined,
    })
    // The edit lands during the push — AFTER getMetadata captured the snapshot —
    // so it is not in the pushed payload. The CAS (against the snapshot's
    // updatedAt) must fail, leaving the object flagged for the next pass.
    mockUpdateObjectMetadata.mockImplementation(async () => {
      await app().files.update({ id: 'concurrent', name: 'edited.jpg' })
    })

    await runSyncUpMetadata(5)

    expect(await flagFor('obj-concurrent')).toBe(1)
  })

  test('no-diff case clears the flag', async () => {
    const file = makeFile({ id: 'nodiff', updatedAt: 200 })
    await app().files.create(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-nodiff',
        indexerURL: INDEXER_URL,
        createdAt: 100,
        updatedAt: 200,
      }),
    )

    mockGetPinnedObject.mockResolvedValue({
      metadata: () => new ArrayBuffer(0),
      updateMetadata: jest.fn(),
    })
    meta.decodeFileMetadata.mockReturnValue({
      id: 'nodiff',
      name: 'nodiff.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-nodiff',
      createdAt: 100,
      updatedAt: 200,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
    })

    await runSyncUpMetadata(5)

    expect(mockUpdateObjectMetadata).not.toHaveBeenCalled()
    expect(await flagFor('obj-nodiff')).toBe(0)
  })

  test('tombstoned file: deleteObject success removes the object row', async () => {
    const file = makeFile({ id: 'file-tomb', updatedAt: NOW_BASE })
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
    // Tombstoning bumps updatedAt and re-flags the file's objects.
    await app().files.update(
      { id: file.id, deletedAt: Date.now() },
      { includeUpdatedAt: false, skipInvalidation: true },
    )
    mockDeleteObject.mockResolvedValue(undefined)

    await runSyncUpMetadata(5)

    // The dirty flag lives on the object row, so deleting the row clears it.
    expect(mockDeleteObject).toHaveBeenCalledWith('obj-tomb')
    expect(await app().localObjects.getForFile('file-tomb')).toHaveLength(0)
    expect(mockGetPinnedObject).not.toHaveBeenCalled()
    expect(mockUpdateObjectMetadata).not.toHaveBeenCalled()
  })

  test('tombstoned file: deleteObject network error keeps the object row flagged', async () => {
    const file = makeFile({ id: 'file-tomb-fail', updatedAt: NOW_BASE })
    await app().files.create(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-tomb-fail',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )
    await app().files.update(
      { id: file.id, deletedAt: Date.now() },
      { includeUpdatedAt: false, skipInvalidation: true },
    )
    mockDeleteObject.mockRejectedValue(new Error('network'))

    await runSyncUpMetadata(5)

    // The remote delete failed, so the object row (and its flag) survive for retry.
    expect(await app().localObjects.getForFile('file-tomb-fail')).toHaveLength(1)
    expect(await flagFor('obj-tomb-fail')).toBe(1)
  })

  test('tombstoned file: deleteObject "object not found" is treated as success', async () => {
    const file = makeFile({ id: 'file-gone', updatedAt: NOW_BASE })
    await app().files.create(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-gone',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )
    await app().files.update(
      { id: file.id, deletedAt: Date.now() },
      { includeUpdatedAt: false, skipInvalidation: true },
    )
    // Remote object already gone (e.g. a prior session deleted it but crashed
    // before local cleanup). The delete is idempotently done, so the dangling
    // local object row must be removed — otherwise we'd re-issue this doomed
    // delete every tick forever.
    mockDeleteObject.mockRejectedValue(new Error('object not found'))

    await runSyncUpMetadata(5)

    expect(await app().localObjects.getForFile('file-gone')).toHaveLength(0)
  })

  test('tombstoned file with object on another indexer leaves that object row dangling', async () => {
    const OTHER_INDEXER = 'other-indexer-url'
    const file = makeFile({ id: 'file-multi-idx', updatedAt: NOW_BASE })
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
        indexerURL: OTHER_INDEXER,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )
    await app().files.update(
      { id: file.id, deletedAt: Date.now() },
      { includeUpdatedAt: false, skipInvalidation: true },
    )

    mockDeleteObject.mockResolvedValue(undefined)
    await runSyncUpMetadata(5)

    // Sync-up only walks the current indexer, so only its object is deleted; the
    // other indexer's object row (still flagged) persists until that indexer
    // connects.
    expect(mockDeleteObject).toHaveBeenCalledTimes(1)
    expect(mockDeleteObject).toHaveBeenCalledWith('obj-current')

    const remaining = await app().localObjects.getForFile(file.id)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe('obj-other')
    expect(remaining[0].indexerURL).toBe(OTHER_INDEXER)
    expect(await flagFor('obj-other', OTHER_INDEXER)).toBe(1)
  })

  test('early exit when disconnected', async () => {
    app().connection.setState({ isConnected: false })
    const file = makeFile({ id: 'unreachable', updatedAt: 200 })
    await app().files.create(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-unreachable',
        indexerURL: INDEXER_URL,
        createdAt: 100,
        updatedAt: 200,
      }),
    )
    await runSyncUpMetadata(5)
    expect(mockGetPinnedObject).not.toHaveBeenCalled()
    expect(await flagFor('obj-unreachable')).toBe(1)
  })

  test('skips all work when signal is already aborted', async () => {
    const file = makeFile({ id: 'aborted', updatedAt: NOW_BASE })
    await app().files.create(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-aborted',
        indexerURL: INDEXER_URL,
        createdAt: NOW_BASE,
        updatedAt: NOW_BASE,
      }),
    )
    const ac = new AbortController()
    ac.abort()
    await runSyncUpMetadata(5, ac.signal)
    expect(mockGetPinnedObject).not.toHaveBeenCalled()
    expect(await flagFor('obj-aborted')).toBe(1)
  })

  test('stops fetching objects when signal is aborted mid-batch', async () => {
    for (let i = 0; i < 5; i++) {
      const file = makeFile({ id: `file-${i}`, updatedAt: NOW_BASE + i })
      await app().files.create(
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
    mockGetPinnedObject.mockImplementation(async () => {
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
    expect(mockGetPinnedObject).toHaveBeenCalledTimes(2)
  })

  test('pushes local id when remote id differs', async () => {
    const localFile = makeFile({ id: 'local-id', name: 'photo.jpg', updatedAt: 200 })
    await app().files.create(
      localFile,
      makeLocalObject({
        fileId: localFile.id,
        objectId: 'obj-a',
        indexerURL: INDEXER_URL,
        createdAt: 100,
        updatedAt: 200,
      }),
    )
    mockGetPinnedObject.mockResolvedValue({
      metadata: () => new ArrayBuffer(0),
      updateMetadata: jest.fn(),
    })
    meta.decodeFileMetadata.mockReturnValue({
      id: 'remote-id',
      name: 'photo.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'wrong-hash',
      createdAt: 100,
      updatedAt: 200,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
    })
    await runSyncUpMetadata(5)
    expect(mockUpdateObjectMetadata).toHaveBeenCalledTimes(1)
    expect(meta.encodeFileMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'local-id' }),
    )
  })

  test('skips and clears the flag when remote metadata version exceeds MAX_SUPPORTED_VERSION', async () => {
    const file = makeFile({ id: 'newer-ver', updatedAt: 300 })
    await app().files.create(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-newer-ver',
        indexerURL: INDEXER_URL,
        createdAt: 100,
        updatedAt: 300,
      }),
    )

    const futureMeta = new TextEncoder().encode(
      JSON.stringify({ version: 99, id: 'newer-ver' }),
    ).buffer
    mockGetPinnedObject.mockResolvedValue({
      metadata: () => futureMeta,
      updateMetadata: jest.fn(),
    })
    meta.decodeFileMetadata.mockReturnValue({
      name: 'newer-ver.jpg',
      type: 'image/jpeg',
      size: 100,
      hash: 'hash-newer-ver',
      createdAt: 100,
      updatedAt: 300,
    })

    await runSyncUpMetadata(5)

    // Don't clobber a newer-schema remote; just stop re-walking it.
    expect(mockUpdateObjectMetadata).not.toHaveBeenCalled()
    expect(await flagFor('obj-newer-ver')).toBe(0)
  })

  test('pushes a tag-only change detected via live getMetadata', async () => {
    const file = makeFile({ id: 'tagonly', updatedAt: 300 })
    await app().files.create(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-tagonly',
        indexerURL: INDEXER_URL,
        createdAt: 100,
        updatedAt: 300,
      }),
    )
    // Real tag add: only the separate file_tags table changes (plus updatedAt).
    await app().tags.add('tagonly', 'trip')
    const updatedAt = (await app().files.getById('tagonly'))!.updatedAt

    mockGetPinnedObject.mockResolvedValue({
      metadata: () => new ArrayBuffer(0),
      updateMetadata: jest.fn(),
    })
    // Every scalar field matches remote; only the tag differs (remote has none).
    meta.decodeFileMetadata.mockReturnValue({
      id: 'tagonly',
      name: 'tagonly.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-tagonly',
      createdAt: 100,
      updatedAt,
      trashedAt: null,
    })

    await runSyncUpMetadata(5)

    // getMetadata pulled the tag in, diffFileMetadata flagged it, and it reached
    // the pushed payload even though every scalar field matched remote.
    expect(mockUpdateObjectMetadata).toHaveBeenCalledTimes(1)
    expect(meta.encodeFileMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ['trip'] }),
    )
    expect(await flagFor('obj-tagonly')).toBe(0)
  })

  test('a tombstone landing during the round-trip is not pushed as a metadata update', async () => {
    const file = makeFile({ id: 'race-tomb', updatedAt: 300 })
    await app().files.create(
      file,
      makeLocalObject({
        fileId: file.id,
        objectId: 'obj-race',
        indexerURL: INDEXER_URL,
        createdAt: 100,
        updatedAt: 300,
      }),
    )

    // The file is tombstoned mid-round-trip (during getPinnedObject), after the
    // batch snapshot saw it live. The live deletedAt re-check must catch it.
    mockGetPinnedObject.mockImplementationOnce(async () => {
      await app().files.tombstone(['race-tomb'])
      return { metadata: () => new ArrayBuffer(0), updateMetadata: jest.fn() }
    })
    meta.decodeFileMetadata.mockReturnValue({
      name: 'race-tomb.jpg',
      type: 'image/jpeg',
      size: 100,
      hash: 'remote-hash',
      createdAt: 100,
      updatedAt: 200,
    })

    await runSyncUpMetadata(5)

    // Must NOT push metadata for a now-deleted file, and must leave the object
    // flagged (the local tombstone set it) so the next pass deletes the remote
    // object.
    expect(mockUpdateObjectMetadata).not.toHaveBeenCalled()
    expect(await flagFor('obj-race')).toBe(1)

    // Next pass: the snapshot now shows the tombstone, so it deletes the object
    // and the row (and its flag) is removed.
    mockGetPinnedObject.mockResolvedValue({
      metadata: () => new ArrayBuffer(0),
      updateMetadata: jest.fn(),
    })
    await runSyncUpMetadata(5)
    expect(mockDeleteObject).toHaveBeenCalledTimes(1)
    expect(await app().localObjects.getForFile('race-tomb')).toHaveLength(0)
  })
})

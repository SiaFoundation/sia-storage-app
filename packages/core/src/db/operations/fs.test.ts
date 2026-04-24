import { insertFile } from './files'
import {
  queryEvictionCandidates,
  queryFsMetaTotalSize,
  queryNonCurrentCachedFiles,
  queryTrashedCachedFiles,
  deleteFsMeta,
  deleteManyFsMeta,
  readFsMeta,
  updateFsMetaUsedAt,
  upsertFsMeta,
} from './fs'
import { insertObject } from './localObjects'
import { trashFilesAndThumbnails } from './trash'
import { db, setupTestDb, teardownTestDb } from './test-setup'

beforeEach(setupTestDb)
afterEach(teardownTestDb)

describe('upsertFsMeta', () => {
  it('inserts new metadata', async () => {
    await upsertFsMeta(db(), {
      fileId: 'f1',
      size: 500,
      addedAt: 1000,
      usedAt: 1000,
    })

    const row = await readFsMeta(db(), 'f1')
    expect(row).toEqual({
      fileId: 'f1',
      size: 500,
      addedAt: 1000,
      usedAt: 1000,
    })
  })

  it('updates existing metadata via OR REPLACE', async () => {
    await upsertFsMeta(db(), {
      fileId: 'f1',
      size: 500,
      addedAt: 1000,
      usedAt: 1000,
    })
    await upsertFsMeta(db(), {
      fileId: 'f1',
      size: 800,
      addedAt: 2000,
      usedAt: 2000,
    })

    const row = await readFsMeta(db(), 'f1')
    expect(row?.size).toBe(800)
    expect(row?.addedAt).toBe(2000)
  })
})

describe('readFsMeta', () => {
  it('reads back inserted metadata', async () => {
    await upsertFsMeta(db(), {
      fileId: 'f1',
      size: 100,
      addedAt: 1000,
      usedAt: 2000,
    })

    const row = await readFsMeta(db(), 'f1')
    expect(row).not.toBeNull()
    expect(row?.fileId).toBe('f1')
    expect(row?.usedAt).toBe(2000)
  })

  it('returns null if not found', async () => {
    const row = await readFsMeta(db(), 'nonexistent')
    expect(row).toBeNull()
  })
})

describe('updateFsMetaUsedAt', () => {
  it('updates usedAt field', async () => {
    await upsertFsMeta(db(), {
      fileId: 'f1',
      size: 100,
      addedAt: 1000,
      usedAt: 1000,
    })

    await updateFsMetaUsedAt(db(), 'f1', 5000)

    const row = await readFsMeta(db(), 'f1')
    expect(row?.usedAt).toBe(5000)
  })
})

describe('deleteFsMeta', () => {
  it('deletes by fileId', async () => {
    await upsertFsMeta(db(), {
      fileId: 'f1',
      size: 100,
      addedAt: 1000,
      usedAt: 1000,
    })

    await deleteFsMeta(db(), 'f1')

    const row = await readFsMeta(db(), 'f1')
    expect(row).toBeNull()
  })
})

describe('deleteManyFsMeta', () => {
  it('batch deletes multiple entries', async () => {
    await upsertFsMeta(db(), {
      fileId: 'f1',
      size: 100,
      addedAt: 1000,
      usedAt: 1000,
    })
    await upsertFsMeta(db(), {
      fileId: 'f2',
      size: 200,
      addedAt: 1000,
      usedAt: 1000,
    })
    await upsertFsMeta(db(), {
      fileId: 'f3',
      size: 300,
      addedAt: 1000,
      usedAt: 1000,
    })

    await deleteManyFsMeta(db(), ['f1', 'f2'])

    expect(await readFsMeta(db(), 'f1')).toBeNull()
    expect(await readFsMeta(db(), 'f2')).toBeNull()
    expect(await readFsMeta(db(), 'f3')).not.toBeNull()
  })

  it('handles empty array', async () => {
    await deleteManyFsMeta(db(), [])
  })
})

describe('queryFsMetaTotalSize', () => {
  it('sums all sizes', async () => {
    await upsertFsMeta(db(), {
      fileId: 'f1',
      size: 100,
      addedAt: 1000,
      usedAt: 1000,
    })
    await upsertFsMeta(db(), {
      fileId: 'f2',
      size: 250,
      addedAt: 1000,
      usedAt: 1000,
    })

    const total = await queryFsMetaTotalSize(db())
    expect(total).toBe(350)
  })

  it('returns 0 when empty', async () => {
    const total = await queryFsMetaTotalSize(db())
    expect(total).toBe(0)
  })
})

function makeFile(id: string, overrides?: Record<string, unknown>) {
  return {
    id,
    name: `${id}.jpg`,
    type: 'image/jpeg',
    kind: 'file' as const,
    size: 100,
    hash: `hash-${id}`,
    createdAt: 1000,
    updatedAt: 1000,
    localId: null,
    addedAt: 1000,
    trashedAt: null,
    deletedAt: null,
    ...overrides,
  }
}

function makeObject(fileId: string) {
  return {
    fileId,
    indexerURL: 'https://indexer.example.com',
    id: `obj-${fileId}`,
    slabs: [],
    encryptedDataKey: new Uint8Array([1]).buffer as ArrayBuffer,
    encryptedMetadataKey: new Uint8Array([2]).buffer as ArrayBuffer,
    encryptedMetadata: new Uint8Array([3]).buffer as ArrayBuffer,
    dataSignature: new Uint8Array([4]).buffer as ArrayBuffer,
    metadataSignature: new Uint8Array([5]).buffer as ArrayBuffer,
    createdAt: new Date(1000),
    updatedAt: new Date(1000),
  }
}

describe('queryNonCurrentCachedFiles', () => {
  it('returns superseded versions that are cached, uploaded, and aged', async () => {
    await insertFile(db(), makeFile('v1', { name: 'photo.jpg', updatedAt: 1000 }))
    await insertFile(db(), makeFile('v2', { name: 'photo.jpg', updatedAt: 2000 }))
    await upsertFsMeta(db(), { fileId: 'v1', size: 500, addedAt: 1000, usedAt: 1000 })
    await upsertFsMeta(db(), { fileId: 'v2', size: 500, addedAt: 1000, usedAt: 1000 })
    await insertObject(db(), makeObject('v1'))
    await insertObject(db(), makeObject('v2'))

    const rows = await queryNonCurrentCachedFiles(db(), 2000, 10)
    expect(rows.map((r) => r.fileId)).toEqual(['v1'])
  })

  it('excludes rows without objects', async () => {
    await insertFile(db(), makeFile('v1', { name: 'photo.jpg', updatedAt: 1000 }))
    await insertFile(db(), makeFile('v2', { name: 'photo.jpg', updatedAt: 2000 }))
    await upsertFsMeta(db(), { fileId: 'v1', size: 500, addedAt: 1000, usedAt: 1000 })

    const rows = await queryNonCurrentCachedFiles(db(), 2000, 10)
    expect(rows).toHaveLength(0)
  })

  it('excludes rows newer than threshold', async () => {
    await insertFile(db(), makeFile('v1', { name: 'photo.jpg', updatedAt: 1000 }))
    await insertFile(db(), makeFile('v2', { name: 'photo.jpg', updatedAt: 2000 }))
    await upsertFsMeta(db(), { fileId: 'v1', size: 500, addedAt: 1000, usedAt: 5000 })
    await insertObject(db(), makeObject('v1'))

    const rows = await queryNonCurrentCachedFiles(db(), 2000, 10)
    expect(rows).toHaveLength(0)
  })

  it('excludes trashed and tombstoned rows', async () => {
    await insertFile(db(), makeFile('v1', { name: 'photo.jpg', updatedAt: 1000, trashedAt: 500 }))
    await insertFile(db(), makeFile('v2', { name: 'photo.jpg', updatedAt: 2000 }))
    await upsertFsMeta(db(), { fileId: 'v1', size: 500, addedAt: 1000, usedAt: 1000 })
    await insertObject(db(), makeObject('v1'))

    const rows = await queryNonCurrentCachedFiles(db(), 2000, 10)
    expect(rows).toHaveLength(0)
  })

  it('includes thumbs whose original is non-current; excludes thumbs of current originals', async () => {
    // Two versions of photo.jpg: v1 superseded, v2 current.
    await insertFile(db(), makeFile('v1', { name: 'photo.jpg', updatedAt: 1000 }))
    await insertFile(db(), makeFile('v2', { name: 'photo.jpg', updatedAt: 2000 }))
    // Thumb of v1 (non-current) — should be evicted.
    await insertFile(
      db(),
      makeFile('v1-thumb', {
        kind: 'thumb',
        name: 'thumb.webp',
        type: 'image/webp',
        thumbForId: 'v1',
        thumbSize: 512,
      }),
    )
    // Thumb of v2 (current) — must be kept even when stale.
    await insertFile(
      db(),
      makeFile('v2-thumb', {
        kind: 'thumb',
        name: 'thumb.webp',
        type: 'image/webp',
        thumbForId: 'v2',
        thumbSize: 512,
      }),
    )
    await upsertFsMeta(db(), { fileId: 'v1', size: 500, addedAt: 1000, usedAt: 1000 })
    await upsertFsMeta(db(), { fileId: 'v1-thumb', size: 50, addedAt: 1000, usedAt: 1000 })
    await upsertFsMeta(db(), { fileId: 'v2-thumb', size: 50, addedAt: 1000, usedAt: 1000 })
    await insertObject(db(), makeObject('v1'))
    await insertObject(db(), makeObject('v1-thumb'))
    await insertObject(db(), makeObject('v2-thumb'))

    const rows = await queryNonCurrentCachedFiles(db(), 2000, 10)
    // v1 (non-current file) and v1-thumb (thumb of non-current) match.
    // v2-thumb does NOT match because its parent is current=1.
    expect(rows.map((r) => r.fileId).sort()).toEqual(['v1', 'v1-thumb'])
  })
})

describe('queryEvictionCandidates (LRU)', () => {
  it('returns aged uploaded current files', async () => {
    await insertFile(db(), makeFile('f1'))
    await upsertFsMeta(db(), { fileId: 'f1', size: 500, addedAt: 1000, usedAt: 1000 })
    await insertObject(db(), makeObject('f1'))

    const rows = await queryEvictionCandidates(db(), 2000, 10)
    expect(rows.map((r) => r.fileId)).toEqual(['f1'])
  })

  it('never returns thumbnails — even thumbs of current originals when stale and uploaded', async () => {
    await insertFile(db(), makeFile('orig'))
    await insertFile(
      db(),
      makeFile('orig-thumb', {
        kind: 'thumb',
        name: 'thumb.webp',
        type: 'image/webp',
        thumbForId: 'orig',
        thumbSize: 512,
      }),
    )
    await upsertFsMeta(db(), { fileId: 'orig-thumb', size: 50, addedAt: 1000, usedAt: 1000 })
    await insertObject(db(), makeObject('orig-thumb'))

    const rows = await queryEvictionCandidates(db(), 2000, 10)
    expect(rows).toHaveLength(0)
  })

  it('never returns superseded versions', async () => {
    await insertFile(db(), makeFile('v1', { name: 'photo.jpg', updatedAt: 1000 }))
    await insertFile(db(), makeFile('v2', { name: 'photo.jpg', updatedAt: 2000 }))
    await upsertFsMeta(db(), { fileId: 'v1', size: 500, addedAt: 1000, usedAt: 1000 })
    await insertObject(db(), makeObject('v1'))

    const rows = await queryEvictionCandidates(db(), 2000, 10)
    // Only v2 (current) should appear — but v2 has no fs row, so empty.
    expect(rows).toHaveLength(0)
  })

  it('never returns trashed or tombstoned files', async () => {
    await insertFile(db(), makeFile('trashed', { trashedAt: 500 }))
    await insertFile(db(), makeFile('tombstoned', { trashedAt: 500, deletedAt: 600 }))
    await upsertFsMeta(db(), { fileId: 'trashed', size: 500, addedAt: 1000, usedAt: 1000 })
    await upsertFsMeta(db(), { fileId: 'tombstoned', size: 500, addedAt: 1000, usedAt: 1000 })
    await insertObject(db(), makeObject('trashed'))
    await insertObject(db(), makeObject('tombstoned'))

    const rows = await queryEvictionCandidates(db(), 2000, 10)
    expect(rows).toHaveLength(0)
  })

  it('excludes local-only files (no objects)', async () => {
    await insertFile(db(), makeFile('local'))
    await upsertFsMeta(db(), { fileId: 'local', size: 500, addedAt: 1000, usedAt: 1000 })

    const rows = await queryEvictionCandidates(db(), 2000, 10)
    expect(rows).toHaveLength(0)
  })

  it('excludes files newer than threshold', async () => {
    await insertFile(db(), makeFile('fresh'))
    await upsertFsMeta(db(), { fileId: 'fresh', size: 500, addedAt: 1000, usedAt: 5000 })
    await insertObject(db(), makeObject('fresh'))

    const rows = await queryEvictionCandidates(db(), 2000, 10)
    expect(rows).toHaveLength(0)
  })
})

describe('queryTrashedCachedFiles', () => {
  it('returns trashed uploaded files regardless of age', async () => {
    await insertFile(db(), makeFile('f1'))
    await upsertFsMeta(db(), { fileId: 'f1', size: 500, addedAt: 1000, usedAt: 1000 })
    await insertObject(db(), makeObject('f1'))
    await trashFilesAndThumbnails(db(), ['f1'])

    const rows = await queryTrashedCachedFiles(db(), 10)
    expect(rows.map((r) => r.fileId)).toEqual(['f1'])
  })

  it('excludes local-only trashed files (no objects row)', async () => {
    await insertFile(db(), makeFile('f1'))
    await upsertFsMeta(db(), { fileId: 'f1', size: 500, addedAt: 1000, usedAt: 1000 })
    await trashFilesAndThumbnails(db(), ['f1'])

    const rows = await queryTrashedCachedFiles(db(), 10)
    expect(rows).toHaveLength(0)
  })

  it('excludes tombstoned files', async () => {
    await insertFile(db(), makeFile('f1', { trashedAt: 1000, deletedAt: 2000 }))
    await upsertFsMeta(db(), { fileId: 'f1', size: 500, addedAt: 1000, usedAt: 1000 })
    await insertObject(db(), makeObject('f1'))

    const rows = await queryTrashedCachedFiles(db(), 10)
    expect(rows).toHaveLength(0)
  })

  it('excludes non-trashed files', async () => {
    await insertFile(db(), makeFile('f1'))
    await upsertFsMeta(db(), { fileId: 'f1', size: 500, addedAt: 1000, usedAt: 1000 })
    await insertObject(db(), makeObject('f1'))

    const rows = await queryTrashedCachedFiles(db(), 10)
    expect(rows).toHaveLength(0)
  })

  it('picks up thumbs of trashed originals via transactional cascade', async () => {
    await insertFile(db(), makeFile('orig'))
    await insertFile(
      db(),
      makeFile('thumb', {
        kind: 'thumb',
        name: 'thumb.webp',
        type: 'image/webp',
        thumbForId: 'orig',
        thumbSize: 512,
      }),
    )
    await upsertFsMeta(db(), { fileId: 'orig', size: 500, addedAt: 1000, usedAt: 1000 })
    await upsertFsMeta(db(), { fileId: 'thumb', size: 50, addedAt: 1000, usedAt: 1000 })
    await insertObject(db(), makeObject('orig'))
    await insertObject(db(), makeObject('thumb'))
    await trashFilesAndThumbnails(db(), ['orig'])

    const rows = await queryTrashedCachedFiles(db(), 10)
    expect(rows.map((r) => r.fileId).sort()).toEqual(['orig', 'thumb'])
  })
})

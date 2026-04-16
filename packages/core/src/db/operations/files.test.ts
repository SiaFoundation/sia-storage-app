import {
  deleteFileAndThumbnails,
  deleteFileById,
  deleteFilesAndThumbnails,
  deleteLostFilesAndThumbnails,
  deleteManyFilesByIds,
  insertFile,
  insertManyFiles,
  queryFileByContentHash,
  queryFileByObjectId,
  queryFiles,
  queryFilesByContentHashes,
  queryFilesByLocalIds,
  queryFileCount,
  queryFileStats,
  queryLostFiles,
  readFile,
  readFileWithSlabs,
  readFilesByIds,
  updateFile,
  updateManyFiles,
} from './files'
import { upsertFsMeta } from './fs'
import { insertObject } from './localObjects'
import { db, setupTestDb, teardownTestDb } from './test-setup'

function makeFileRecord(id: string, overrides?: Partial<any>) {
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

function makeLocalObject(fileId: string, overrides?: Partial<any>) {
  return {
    fileId,
    indexerURL: 'https://indexer.example.com',
    id: `obj-${fileId}`,
    slabs: [],
    encryptedDataKey: new Uint8Array([1, 2, 3]).buffer as ArrayBuffer,
    encryptedMetadataKey: new Uint8Array([4, 5, 6]).buffer as ArrayBuffer,
    encryptedMetadata: new Uint8Array([7, 8, 9]).buffer as ArrayBuffer,
    dataSignature: new Uint8Array([10, 11]).buffer as ArrayBuffer,
    metadataSignature: new Uint8Array([12, 13]).buffer as ArrayBuffer,
    createdAt: new Date(1000),
    updatedAt: new Date(1000),
    ...overrides,
  }
}

beforeEach(setupTestDb)
afterEach(teardownTestDb)

describe('insertFile', () => {
  it('inserts a record that can be read back by ID', async () => {
    const record = makeFileRecord('file-1')
    await insertFile(db(), record)
    const result = await readFile(db(), 'file-1')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('file-1')
    expect(result!.name).toBe('file-1.jpg')
    expect(result!.size).toBe(100)
  })
})

describe('readFile', () => {
  it('returns record with objects map', async () => {
    await insertFile(db(), makeFileRecord('file-1'))
    await insertObject(db(), makeLocalObject('file-1'))
    const result = await readFile(db(), 'file-1')
    expect(result).not.toBeNull()
    expect(result!.objects['https://indexer.example.com']).toBeDefined()
    expect(result!.objects['https://indexer.example.com'].id).toBe('obj-file-1')
  })

  it('returns null for non-existent ID', async () => {
    const result = await readFile(db(), 'does-not-exist')
    expect(result).toBeNull()
  })

  it('excludes slabs from objects', async () => {
    await insertFile(db(), makeFileRecord('file-1'))
    await insertObject(db(), makeLocalObject('file-1'))
    const result = await readFile(db(), 'file-1')
    const obj = result!.objects['https://indexer.example.com']
    expect(obj).toBeDefined()
    expect(obj).not.toHaveProperty('slabs')
  })
})

describe('readFileWithSlabs', () => {
  it('includes slabs in objects', async () => {
    await insertFile(db(), makeFileRecord('file-1'))
    await insertObject(db(), makeLocalObject('file-1'))
    const result = await readFileWithSlabs(db(), 'file-1')
    expect(result).not.toBeNull()
    const obj = result!.objects['https://indexer.example.com']
    expect(obj).toBeDefined()
    expect(obj).toHaveProperty('slabs')
  })
})

describe('readFilesByIds', () => {
  it('batch reads with objects joined', async () => {
    await insertFile(db(), makeFileRecord('file-1'))
    await insertFile(db(), makeFileRecord('file-2'))
    await insertObject(db(), makeLocalObject('file-1'))
    const results = await readFilesByIds(db(), ['file-1', 'file-2'])
    expect(results).toHaveLength(2)
    const f1 = results.find((r) => r.id === 'file-1')
    expect(f1!.objects['https://indexer.example.com']).toBeDefined()
  })

  it('returns empty array for empty input', async () => {
    const results = await readFilesByIds(db(), [])
    expect(results).toEqual([])
  })

  it('returns only matching IDs', async () => {
    await insertFile(db(), makeFileRecord('file-1'))
    const results = await readFilesByIds(db(), ['file-1', 'file-999'])
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('file-1')
  })
})

describe('insertManyFiles', () => {
  it('batch inserts in transaction and all are readable', async () => {
    const records = [makeFileRecord('file-1'), makeFileRecord('file-2'), makeFileRecord('file-3')]
    await insertManyFiles(db(), records)
    const results = await readFilesByIds(db(), ['file-1', 'file-2', 'file-3'])
    expect(results).toHaveLength(3)
  })

  it('handles empty array', async () => {
    await insertManyFiles(db(), [])
    const results = await queryFiles(db(), { order: 'ASC' })
    expect(results).toHaveLength(0)
  })
})

describe('updateFile', () => {
  it('updates specified fields', async () => {
    await insertFile(db(), makeFileRecord('file-1'))
    await updateFile(db(), { id: 'file-1', name: 'renamed.jpg' })
    const result = await readFile(db(), 'file-1')
    expect(result!.name).toBe('renamed.jpg')
  })

  it('auto-sets updatedAt', async () => {
    await insertFile(db(), makeFileRecord('file-1', { updatedAt: 1000 }))
    await updateFile(db(), { id: 'file-1', name: 'renamed.jpg' })
    const result = await readFile(db(), 'file-1')
    expect(result!.updatedAt).toBeGreaterThan(1000)
  })

  it('can include updatedAt explicitly', async () => {
    await insertFile(db(), makeFileRecord('file-1'))
    await updateFile(
      db(),
      { id: 'file-1', name: 'renamed.jpg', updatedAt: 5000 },
      { includeUpdatedAt: true },
    )
    const result = await readFile(db(), 'file-1')
    expect(result!.updatedAt).toBe(5000)
  })
})

describe('updateManyFiles', () => {
  it('batch updates in transaction', async () => {
    await insertFile(db(), makeFileRecord('file-1'))
    await insertFile(db(), makeFileRecord('file-2'))
    await updateManyFiles(db(), [
      { id: 'file-1', name: 'a.jpg' },
      { id: 'file-2', name: 'b.jpg' },
    ])
    const r1 = await readFile(db(), 'file-1')
    const r2 = await readFile(db(), 'file-2')
    expect(r1!.name).toBe('a.jpg')
    expect(r2!.name).toBe('b.jpg')
  })

  it('handles empty array', async () => {
    await updateManyFiles(db(), [])
  })
})

describe('deleteFileById', () => {
  it('deletes a record', async () => {
    await insertFile(db(), makeFileRecord('file-1'))
    await deleteFileById(db(), 'file-1')
    const result = await readFile(db(), 'file-1')
    expect(result).toBeNull()
  })
})

describe('deleteManyFilesByIds', () => {
  it('batch deletes in transaction', async () => {
    await insertFile(db(), makeFileRecord('file-1'))
    await insertFile(db(), makeFileRecord('file-2'))
    await deleteManyFilesByIds(db(), ['file-1', 'file-2'])
    const r1 = await readFile(db(), 'file-1')
    const r2 = await readFile(db(), 'file-2')
    expect(r1).toBeNull()
    expect(r2).toBeNull()
  })

  it('handles empty array', async () => {
    await deleteManyFilesByIds(db(), [])
  })
})

describe('deleteFileAndThumbnails', () => {
  it('deletes file and its thumbnails', async () => {
    await insertFile(db(), makeFileRecord('file-1'))
    await insertFile(db(), makeFileRecord('thumb-1', { thumbForId: 'file-1', kind: 'thumbnail' }))
    await insertFile(db(), makeFileRecord('thumb-2', { thumbForId: 'file-1', kind: 'thumbnail' }))
    await deleteFileAndThumbnails(db(), 'file-1')
    const file = await readFile(db(), 'file-1')
    const t1 = await readFile(db(), 'thumb-1')
    const t2 = await readFile(db(), 'thumb-2')
    expect(file).toBeNull()
    expect(t1).toBeNull()
    expect(t2).toBeNull()
  })
})

describe('deleteFilesAndThumbnails', () => {
  it('batch deletes files and their thumbnails', async () => {
    await insertFile(db(), makeFileRecord('file-1'))
    await insertFile(db(), makeFileRecord('file-2'))
    await insertFile(db(), makeFileRecord('thumb-1', { thumbForId: 'file-1', kind: 'thumbnail' }))
    await insertFile(db(), makeFileRecord('thumb-2', { thumbForId: 'file-2', kind: 'thumbnail' }))
    await deleteFilesAndThumbnails(db(), ['file-1', 'file-2'])
    expect(await readFile(db(), 'file-1')).toBeNull()
    expect(await readFile(db(), 'file-2')).toBeNull()
    expect(await readFile(db(), 'thumb-1')).toBeNull()
    expect(await readFile(db(), 'thumb-2')).toBeNull()
  })

  it('handles empty array', async () => {
    await deleteFilesAndThumbnails(db(), [])
  })
})

describe('deleteLostFilesAndThumbnails', () => {
  it('deletes files not pinned to indexer and not on local fs', async () => {
    const indexerURL = 'https://indexer.example.com'
    await insertFile(db(), makeFileRecord('pinned'))
    await insertObject(db(), makeLocalObject('pinned', { indexerURL }))
    await insertFile(db(), makeFileRecord('local-only'))
    await upsertFsMeta(db(), {
      fileId: 'local-only',
      size: 100,
      addedAt: 1000,
      usedAt: 1000,
    })
    await insertFile(db(), makeFileRecord('lost'))
    const deletedCount = await deleteLostFilesAndThumbnails(db(), indexerURL)
    expect(deletedCount).toBe(1)
    expect(await readFile(db(), 'pinned')).not.toBeNull()
    expect(await readFile(db(), 'local-only')).not.toBeNull()
    expect(await readFile(db(), 'lost')).toBeNull()
  })

  it('returns 0 when no files are lost', async () => {
    const indexerURL = 'https://indexer.example.com'
    await insertFile(db(), makeFileRecord('pinned'))
    await insertObject(db(), makeLocalObject('pinned', { indexerURL }))
    const deletedCount = await deleteLostFilesAndThumbnails(db(), indexerURL)
    expect(deletedCount).toBe(0)
  })
})

describe('queryLostFiles', () => {
  const indexerURL = 'https://indexer.example.com'

  it('returns files with an explicit lostReason even when pinned or local', async () => {
    await insertFile(db(), makeFileRecord('explicit-pinned', { lostReason: 'Corrupted' }))
    await insertObject(db(), makeLocalObject('explicit-pinned', { indexerURL }))
    await insertFile(db(), makeFileRecord('explicit-local', { lostReason: 'Unreadable' }))
    await upsertFsMeta(db(), {
      fileId: 'explicit-local',
      size: 100,
      addedAt: 1000,
      usedAt: 1000,
    })
    const results = await queryLostFiles(db(), indexerURL)
    const ids = results.map((r) => r.id).sort()
    expect(ids).toEqual(['explicit-local', 'explicit-pinned'])
  })

  it('returns files that are hashed but missing from both objects and fs', async () => {
    await insertFile(db(), makeFileRecord('implicit-lost'))
    const results = await queryLostFiles(db(), indexerURL)
    expect(results.map((r) => r.id)).toEqual(['implicit-lost'])
  })

  it('excludes pinned, local-only, and empty-hash files', async () => {
    await insertFile(db(), makeFileRecord('pinned'))
    await insertObject(db(), makeLocalObject('pinned', { indexerURL }))
    await insertFile(db(), makeFileRecord('local-only'))
    await upsertFsMeta(db(), {
      fileId: 'local-only',
      size: 100,
      addedAt: 1000,
      usedAt: 1000,
    })
    await insertFile(db(), makeFileRecord('no-hash', { hash: '' }))
    const results = await queryLostFiles(db(), indexerURL)
    expect(results).toHaveLength(0)
  })

  it('orders results by addedAt DESC', async () => {
    await insertFile(db(), makeFileRecord('older', { addedAt: 1000 }))
    await insertFile(db(), makeFileRecord('newer', { addedAt: 2000 }))
    const results = await queryLostFiles(db(), indexerURL)
    expect(results.map((r) => r.id)).toEqual(['newer', 'older'])
  })
})

describe('queryFiles', () => {
  it('returns paginated results with objects', async () => {
    await insertFile(db(), makeFileRecord('file-1', { createdAt: 1000 }))
    await insertFile(db(), makeFileRecord('file-2', { createdAt: 2000 }))
    await insertObject(db(), makeLocalObject('file-1'))
    const results = await queryFiles(db(), { order: 'ASC', limit: 10 })
    expect(results).toHaveLength(2)
    expect(results[0].id).toBe('file-1')
    expect(results[0].objects['https://indexer.example.com']).toBeDefined()
    expect(results[1].id).toBe('file-2')
  })

  it('respects order and limit', async () => {
    await insertFile(db(), makeFileRecord('file-1', { createdAt: 1000 }))
    await insertFile(db(), makeFileRecord('file-2', { createdAt: 2000 }))
    await insertFile(db(), makeFileRecord('file-3', { createdAt: 3000 }))
    const results = await queryFiles(db(), { order: 'DESC', limit: 2 })
    expect(results).toHaveLength(2)
    expect(results[0].id).toBe('file-3')
    expect(results[1].id).toBe('file-2')
  })

  it('respects after cursor', async () => {
    await insertFile(db(), makeFileRecord('file-1', { createdAt: 1000 }))
    await insertFile(db(), makeFileRecord('file-2', { createdAt: 2000 }))
    await insertFile(db(), makeFileRecord('file-3', { createdAt: 3000 }))
    const results = await queryFiles(db(), {
      order: 'ASC',
      after: { value: 1000, id: 'file-1' },
    })
    expect(results).toHaveLength(2)
    expect(results[0].id).toBe('file-2')
    expect(results[1].id).toBe('file-3')
  })

  it('filters by activeOnly', async () => {
    await insertFile(db(), makeFileRecord('active'))
    await insertFile(db(), makeFileRecord('trashed', { trashedAt: 2000 }))
    await insertFile(db(), makeFileRecord('deleted', { deletedAt: 3000 }))
    const results = await queryFiles(db(), {
      order: 'ASC',
      activeOnly: true,
    })
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('active')
  })

  it('orders by updatedAt', async () => {
    await insertFile(db(), makeFileRecord('f1', { createdAt: 1000, updatedAt: 3000 }))
    await insertFile(db(), makeFileRecord('f2', { createdAt: 2000, updatedAt: 1000 }))
    const results = await queryFiles(db(), {
      order: 'ASC',
      orderBy: 'updatedAt',
    })
    expect(results[0].id).toBe('f2')
    expect(results[1].id).toBe('f1')
  })

  it('filters by fileExistsLocally=true', async () => {
    await insertFile(db(), makeFileRecord('local'))
    await insertFile(db(), makeFileRecord('remote'))
    await upsertFsMeta(db(), {
      fileId: 'local',
      size: 100,
      addedAt: 1000,
      usedAt: 1000,
    })
    const results = await queryFiles(db(), {
      order: 'ASC',
      fileExistsLocally: true,
    })
    expect(results.map((r) => r.id)).toEqual(['local'])
  })

  it('filters by fileExistsLocally=false', async () => {
    await insertFile(db(), makeFileRecord('local'))
    await insertFile(db(), makeFileRecord('remote'))
    await upsertFsMeta(db(), {
      fileId: 'local',
      size: 100,
      addedAt: 1000,
      usedAt: 1000,
    })
    const results = await queryFiles(db(), {
      order: 'ASC',
      fileExistsLocally: false,
    })
    expect(results.map((r) => r.id)).toEqual(['remote'])
  })

  it('paginates by updatedAt cursor', async () => {
    await insertFile(db(), makeFileRecord('f1', { createdAt: 1000, updatedAt: 1000 }))
    await insertFile(db(), makeFileRecord('f2', { createdAt: 2000, updatedAt: 2000 }))
    await insertFile(db(), makeFileRecord('f3', { createdAt: 3000, updatedAt: 2000 }))
    const results = await queryFiles(db(), {
      order: 'ASC',
      orderBy: 'updatedAt',
      after: { value: 1000, id: 'f1' },
    })
    expect(results.map((r) => r.id)).toEqual(['f2', 'f3'])
  })

  it('activeOnly excludes trashed separately from deleted', async () => {
    await insertFile(db(), makeFileRecord('active'))
    await insertFile(db(), makeFileRecord('trashed', { trashedAt: 2000 }))
    await insertFile(db(), makeFileRecord('deleted', { deletedAt: 3000, trashedAt: 3000 }))
    const active = await queryFiles(db(), {
      order: 'ASC',
      activeOnly: true,
    })
    expect(active.map((r) => r.id)).toEqual(['active'])
    const all = await queryFiles(db(), { order: 'ASC' })
    expect(all).toHaveLength(3)
  })
})

describe('updateFile edge cases', () => {
  it('writes null values correctly', async () => {
    await insertFile(db(), makeFileRecord('f1', { trashedAt: 2000 }))
    await updateFile(db(), { id: 'f1', trashedAt: null })
    const result = await readFile(db(), 'f1')
    expect(result!.trashedAt).toBeNull()
  })
})

describe('readFilesByIds edge cases', () => {
  it('returns tombstoned files', async () => {
    await insertFile(db(), makeFileRecord('f1', { deletedAt: 2000, trashedAt: 2000 }))
    const results = await readFilesByIds(db(), ['f1'])
    expect(results).toHaveLength(1)
    expect(results[0].deletedAt).toBe(2000)
  })
})

describe('queryFileCount', () => {
  it('returns count matching filter options', async () => {
    await insertFile(db(), makeFileRecord('f1'))
    await insertFile(db(), makeFileRecord('f2'))
    await insertFile(db(), makeFileRecord('f3', { trashedAt: 2000 }))
    const count = await queryFileCount(db(), {
      order: 'ASC',
      activeOnly: true,
    })
    expect(count).toBe(2)
  })

  it('returns 0 when no records match', async () => {
    const count = await queryFileCount(db(), {
      order: 'ASC',
      activeOnly: true,
    })
    expect(count).toBe(0)
  })
})

describe('queryFileStats', () => {
  it('returns count and totalBytes', async () => {
    await insertFile(db(), makeFileRecord('f1', { size: 500 }))
    await insertFile(db(), makeFileRecord('f2', { size: 300 }))
    const stats = await queryFileStats(db(), { order: 'ASC' })
    expect(stats.count).toBe(2)
    expect(stats.totalBytes).toBe(800)
  })

  it('returns zeros when no records match', async () => {
    const stats = await queryFileStats(db(), {
      order: 'ASC',
      activeOnly: true,
    })
    expect(stats.count).toBe(0)
    expect(stats.totalBytes).toBe(0)
  })
})

describe('queryFileByContentHash', () => {
  it('finds file by hash', async () => {
    await insertFile(db(), makeFileRecord('f1', { hash: 'abc123' }))
    const row = await queryFileByContentHash(db(), 'abc123')
    expect(row).not.toBeNull()
    expect(row!.id).toBe('f1')
  })

  it('returns null when hash not found', async () => {
    const row = await queryFileByContentHash(db(), 'nonexistent')
    expect(row).toBeNull()
  })

  it('excludes trashed files', async () => {
    await insertFile(db(), makeFileRecord('f1', { hash: 'abc123', trashedAt: 2000 }))
    const row = await queryFileByContentHash(db(), 'abc123')
    expect(row).toBeNull()
  })

  it('excludes deleted files', async () => {
    await insertFile(db(), makeFileRecord('f1', { hash: 'abc123', deletedAt: 2000 }))
    const row = await queryFileByContentHash(db(), 'abc123')
    expect(row).toBeNull()
  })
})

describe('queryFilesByLocalIds', () => {
  it('finds files by local IDs', async () => {
    await insertFile(db(), makeFileRecord('f1', { localId: 'local-1' }))
    await insertFile(db(), makeFileRecord('f2', { localId: 'local-2' }))
    await insertFile(db(), makeFileRecord('f3', { localId: 'local-3' }))
    const rows = await queryFilesByLocalIds(db(), ['local-1', 'local-3'])
    expect(rows.map((r) => r.id).sort()).toEqual(['f1', 'f3'])
  })

  it('excludes trashed files', async () => {
    await insertFile(db(), makeFileRecord('f1', { localId: 'local-1', trashedAt: 2000 }))
    const rows = await queryFilesByLocalIds(db(), ['local-1'])
    expect(rows).toEqual([])
  })

  it('excludes deleted files', async () => {
    await insertFile(db(), makeFileRecord('f1', { localId: 'local-1', deletedAt: 2000 }))
    const rows = await queryFilesByLocalIds(db(), ['local-1'])
    expect(rows).toEqual([])
  })
})

describe('queryFilesByContentHashes', () => {
  it('finds files by content hashes', async () => {
    await insertFile(db(), makeFileRecord('f1', { hash: 'hash-a' }))
    await insertFile(db(), makeFileRecord('f2', { hash: 'hash-b' }))
    await insertFile(db(), makeFileRecord('f3', { hash: 'hash-c' }))
    const rows = await queryFilesByContentHashes(db(), ['hash-a', 'hash-c'])
    expect(rows.map((r) => r.id).sort()).toEqual(['f1', 'f3'])
  })

  it('excludes trashed files', async () => {
    await insertFile(db(), makeFileRecord('f1', { hash: 'hash-a', trashedAt: 2000 }))
    const rows = await queryFilesByContentHashes(db(), ['hash-a'])
    expect(rows).toEqual([])
  })

  it('excludes deleted files', async () => {
    await insertFile(db(), makeFileRecord('f1', { hash: 'hash-a', deletedAt: 2000 }))
    const rows = await queryFilesByContentHashes(db(), ['hash-a'])
    expect(rows).toEqual([])
  })
})

describe('queryFileByObjectId', () => {
  it('finds file by object reference', async () => {
    await insertFile(db(), makeFileRecord('f1'))
    await insertObject(db(), makeLocalObject('f1'))
    const row = await queryFileByObjectId(db(), 'obj-f1', 'https://indexer.example.com')
    expect(row).not.toBeNull()
    expect(row!.id).toBe('f1')
  })

  it('returns null when object not found', async () => {
    const row = await queryFileByObjectId(db(), 'nonexistent', 'https://indexer.example.com')
    expect(row).toBeNull()
  })
})

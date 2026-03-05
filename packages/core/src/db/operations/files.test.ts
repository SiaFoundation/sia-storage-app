import {
  deleteFileRecordAndThumbnails,
  deleteFileRecordById,
  deleteFileRecordsAndThumbnails,
  deleteLostFiles,
  deleteManyFileRecordsByIds,
  insertFileRecord,
  insertManyFileRecords,
  queryFileRecords,
  readFileRecord,
  readFileRecordsByIds,
  updateFileRecordFields,
  updateManyFileRecordFields,
} from './files'
import { upsertFsFileMetadata } from './fs'
import { insertLocalObject } from './localObjects'
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

describe('insertFileRecord', () => {
  it('inserts a record that can be read back by ID', async () => {
    const record = makeFileRecord('file-1')
    await insertFileRecord(db(), record)
    const result = await readFileRecord(db(), 'file-1')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('file-1')
    expect(result!.name).toBe('file-1.jpg')
    expect(result!.size).toBe(100)
  })
})

describe('readFileRecord', () => {
  it('returns record with objects map', async () => {
    await insertFileRecord(db(), makeFileRecord('file-1'))
    await insertLocalObject(db(), makeLocalObject('file-1'))
    const result = await readFileRecord(db(), 'file-1')
    expect(result).not.toBeNull()
    expect(result!.objects['https://indexer.example.com']).toBeDefined()
    expect(result!.objects['https://indexer.example.com'].id).toBe('obj-file-1')
  })

  it('returns null for non-existent ID', async () => {
    const result = await readFileRecord(db(), 'does-not-exist')
    expect(result).toBeNull()
  })
})

describe('readFileRecordsByIds', () => {
  it('batch reads with objects joined', async () => {
    await insertFileRecord(db(), makeFileRecord('file-1'))
    await insertFileRecord(db(), makeFileRecord('file-2'))
    await insertLocalObject(db(), makeLocalObject('file-1'))
    const results = await readFileRecordsByIds(db(), ['file-1', 'file-2'])
    expect(results).toHaveLength(2)
    const f1 = results.find((r) => r.id === 'file-1')
    expect(f1!.objects['https://indexer.example.com']).toBeDefined()
  })

  it('returns empty array for empty input', async () => {
    const results = await readFileRecordsByIds(db(), [])
    expect(results).toEqual([])
  })

  it('returns only matching IDs', async () => {
    await insertFileRecord(db(), makeFileRecord('file-1'))
    const results = await readFileRecordsByIds(db(), ['file-1', 'file-999'])
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('file-1')
  })
})

describe('insertManyFileRecords', () => {
  it('batch inserts in transaction and all are readable', async () => {
    const records = [
      makeFileRecord('file-1'),
      makeFileRecord('file-2'),
      makeFileRecord('file-3'),
    ]
    await insertManyFileRecords(db(), records)
    const results = await readFileRecordsByIds(db(), [
      'file-1',
      'file-2',
      'file-3',
    ])
    expect(results).toHaveLength(3)
  })

  it('handles empty array', async () => {
    await insertManyFileRecords(db(), [])
    const results = await queryFileRecords(db(), { order: 'ASC' })
    expect(results).toHaveLength(0)
  })
})

describe('updateFileRecordFields', () => {
  it('updates specified fields', async () => {
    await insertFileRecord(db(), makeFileRecord('file-1'))
    await updateFileRecordFields(db(), { id: 'file-1', name: 'renamed.jpg' })
    const result = await readFileRecord(db(), 'file-1')
    expect(result!.name).toBe('renamed.jpg')
  })

  it('auto-sets updatedAt', async () => {
    await insertFileRecord(db(), makeFileRecord('file-1', { updatedAt: 1000 }))
    await updateFileRecordFields(db(), { id: 'file-1', name: 'renamed.jpg' })
    const result = await readFileRecord(db(), 'file-1')
    expect(result!.updatedAt).toBeGreaterThan(1000)
  })

  it('can include updatedAt explicitly', async () => {
    await insertFileRecord(db(), makeFileRecord('file-1'))
    await updateFileRecordFields(
      db(),
      { id: 'file-1', name: 'renamed.jpg', updatedAt: 5000 },
      { includeUpdatedAt: true },
    )
    const result = await readFileRecord(db(), 'file-1')
    expect(result!.updatedAt).toBe(5000)
  })
})

describe('updateManyFileRecordFields', () => {
  it('batch updates in transaction', async () => {
    await insertFileRecord(db(), makeFileRecord('file-1'))
    await insertFileRecord(db(), makeFileRecord('file-2'))
    await updateManyFileRecordFields(db(), [
      { id: 'file-1', name: 'a.jpg' },
      { id: 'file-2', name: 'b.jpg' },
    ])
    const r1 = await readFileRecord(db(), 'file-1')
    const r2 = await readFileRecord(db(), 'file-2')
    expect(r1!.name).toBe('a.jpg')
    expect(r2!.name).toBe('b.jpg')
  })

  it('handles empty array', async () => {
    await updateManyFileRecordFields(db(), [])
  })
})

describe('deleteFileRecordById', () => {
  it('deletes a record', async () => {
    await insertFileRecord(db(), makeFileRecord('file-1'))
    await deleteFileRecordById(db(), 'file-1')
    const result = await readFileRecord(db(), 'file-1')
    expect(result).toBeNull()
  })
})

describe('deleteManyFileRecordsByIds', () => {
  it('batch deletes in transaction', async () => {
    await insertFileRecord(db(), makeFileRecord('file-1'))
    await insertFileRecord(db(), makeFileRecord('file-2'))
    await deleteManyFileRecordsByIds(db(), ['file-1', 'file-2'])
    const r1 = await readFileRecord(db(), 'file-1')
    const r2 = await readFileRecord(db(), 'file-2')
    expect(r1).toBeNull()
    expect(r2).toBeNull()
  })

  it('handles empty array', async () => {
    await deleteManyFileRecordsByIds(db(), [])
  })
})

describe('deleteFileRecordAndThumbnails', () => {
  it('deletes file and its thumbnails', async () => {
    await insertFileRecord(db(), makeFileRecord('file-1'))
    await insertFileRecord(
      db(),
      makeFileRecord('thumb-1', { thumbForId: 'file-1', kind: 'thumbnail' }),
    )
    await insertFileRecord(
      db(),
      makeFileRecord('thumb-2', { thumbForId: 'file-1', kind: 'thumbnail' }),
    )
    await deleteFileRecordAndThumbnails(db(), 'file-1')
    const file = await readFileRecord(db(), 'file-1')
    const t1 = await readFileRecord(db(), 'thumb-1')
    const t2 = await readFileRecord(db(), 'thumb-2')
    expect(file).toBeNull()
    expect(t1).toBeNull()
    expect(t2).toBeNull()
  })
})

describe('deleteFileRecordsAndThumbnails', () => {
  it('batch deletes files and their thumbnails', async () => {
    await insertFileRecord(db(), makeFileRecord('file-1'))
    await insertFileRecord(db(), makeFileRecord('file-2'))
    await insertFileRecord(
      db(),
      makeFileRecord('thumb-1', { thumbForId: 'file-1', kind: 'thumbnail' }),
    )
    await insertFileRecord(
      db(),
      makeFileRecord('thumb-2', { thumbForId: 'file-2', kind: 'thumbnail' }),
    )
    await deleteFileRecordsAndThumbnails(db(), ['file-1', 'file-2'])
    expect(await readFileRecord(db(), 'file-1')).toBeNull()
    expect(await readFileRecord(db(), 'file-2')).toBeNull()
    expect(await readFileRecord(db(), 'thumb-1')).toBeNull()
    expect(await readFileRecord(db(), 'thumb-2')).toBeNull()
  })

  it('handles empty array', async () => {
    await deleteFileRecordsAndThumbnails(db(), [])
  })
})

describe('deleteLostFiles', () => {
  it('deletes files not pinned to indexer and not on local fs', async () => {
    const indexerURL = 'https://indexer.example.com'
    await insertFileRecord(db(), makeFileRecord('pinned'))
    await insertLocalObject(db(), makeLocalObject('pinned', { indexerURL }))
    await insertFileRecord(db(), makeFileRecord('local-only'))
    await upsertFsFileMetadata(db(), {
      fileId: 'local-only',
      size: 100,
      addedAt: 1000,
      usedAt: 1000,
    })
    await insertFileRecord(db(), makeFileRecord('lost'))
    const deleted = await deleteLostFiles(db(), indexerURL)
    expect(deleted).toEqual(['lost'])
    expect(await readFileRecord(db(), 'pinned')).not.toBeNull()
    expect(await readFileRecord(db(), 'local-only')).not.toBeNull()
    expect(await readFileRecord(db(), 'lost')).toBeNull()
  })

  it('returns empty when no files are lost', async () => {
    const indexerURL = 'https://indexer.example.com'
    await insertFileRecord(db(), makeFileRecord('pinned'))
    await insertLocalObject(db(), makeLocalObject('pinned', { indexerURL }))
    const deleted = await deleteLostFiles(db(), indexerURL)
    expect(deleted).toEqual([])
  })
})

describe('queryFileRecords', () => {
  it('returns paginated results with objects', async () => {
    await insertFileRecord(db(), makeFileRecord('file-1', { createdAt: 1000 }))
    await insertFileRecord(db(), makeFileRecord('file-2', { createdAt: 2000 }))
    await insertLocalObject(db(), makeLocalObject('file-1'))
    const results = await queryFileRecords(db(), { order: 'ASC', limit: 10 })
    expect(results).toHaveLength(2)
    expect(results[0].id).toBe('file-1')
    expect(results[0].objects['https://indexer.example.com']).toBeDefined()
    expect(results[1].id).toBe('file-2')
  })

  it('respects order and limit', async () => {
    await insertFileRecord(db(), makeFileRecord('file-1', { createdAt: 1000 }))
    await insertFileRecord(db(), makeFileRecord('file-2', { createdAt: 2000 }))
    await insertFileRecord(db(), makeFileRecord('file-3', { createdAt: 3000 }))
    const results = await queryFileRecords(db(), { order: 'DESC', limit: 2 })
    expect(results).toHaveLength(2)
    expect(results[0].id).toBe('file-3')
    expect(results[1].id).toBe('file-2')
  })

  it('respects after cursor', async () => {
    await insertFileRecord(db(), makeFileRecord('file-1', { createdAt: 1000 }))
    await insertFileRecord(db(), makeFileRecord('file-2', { createdAt: 2000 }))
    await insertFileRecord(db(), makeFileRecord('file-3', { createdAt: 3000 }))
    const results = await queryFileRecords(db(), {
      order: 'ASC',
      after: { value: 1000, id: 'file-1' },
    })
    expect(results).toHaveLength(2)
    expect(results[0].id).toBe('file-2')
    expect(results[1].id).toBe('file-3')
  })

  it('filters by activeOnly', async () => {
    await insertFileRecord(db(), makeFileRecord('active'))
    await insertFileRecord(db(), makeFileRecord('trashed', { trashedAt: 2000 }))
    await insertFileRecord(db(), makeFileRecord('deleted', { deletedAt: 3000 }))
    const results = await queryFileRecords(db(), {
      order: 'ASC',
      activeOnly: true,
    })
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('active')
  })

  it('orders by updatedAt', async () => {
    await insertFileRecord(
      db(),
      makeFileRecord('f1', { createdAt: 1000, updatedAt: 3000 }),
    )
    await insertFileRecord(
      db(),
      makeFileRecord('f2', { createdAt: 2000, updatedAt: 1000 }),
    )
    const results = await queryFileRecords(db(), {
      order: 'ASC',
      orderBy: 'updatedAt',
    })
    expect(results[0].id).toBe('f2')
    expect(results[1].id).toBe('f1')
  })

  it('filters by fileExistsLocally=true', async () => {
    await insertFileRecord(db(), makeFileRecord('local'))
    await insertFileRecord(db(), makeFileRecord('remote'))
    await upsertFsFileMetadata(db(), {
      fileId: 'local',
      size: 100,
      addedAt: 1000,
      usedAt: 1000,
    })
    const results = await queryFileRecords(db(), {
      order: 'ASC',
      fileExistsLocally: true,
    })
    expect(results.map((r) => r.id)).toEqual(['local'])
  })

  it('filters by fileExistsLocally=false', async () => {
    await insertFileRecord(db(), makeFileRecord('local'))
    await insertFileRecord(db(), makeFileRecord('remote'))
    await upsertFsFileMetadata(db(), {
      fileId: 'local',
      size: 100,
      addedAt: 1000,
      usedAt: 1000,
    })
    const results = await queryFileRecords(db(), {
      order: 'ASC',
      fileExistsLocally: false,
    })
    expect(results.map((r) => r.id)).toEqual(['remote'])
  })

  it('paginates by updatedAt cursor', async () => {
    await insertFileRecord(
      db(),
      makeFileRecord('f1', { createdAt: 1000, updatedAt: 1000 }),
    )
    await insertFileRecord(
      db(),
      makeFileRecord('f2', { createdAt: 2000, updatedAt: 2000 }),
    )
    await insertFileRecord(
      db(),
      makeFileRecord('f3', { createdAt: 3000, updatedAt: 2000 }),
    )
    const results = await queryFileRecords(db(), {
      order: 'ASC',
      orderBy: 'updatedAt',
      after: { value: 1000, id: 'f1' },
    })
    expect(results.map((r) => r.id)).toEqual(['f2', 'f3'])
  })

  it('activeOnly excludes trashed separately from deleted', async () => {
    await insertFileRecord(db(), makeFileRecord('active'))
    await insertFileRecord(db(), makeFileRecord('trashed', { trashedAt: 2000 }))
    await insertFileRecord(
      db(),
      makeFileRecord('deleted', { deletedAt: 3000, trashedAt: 3000 }),
    )
    const active = await queryFileRecords(db(), {
      order: 'ASC',
      activeOnly: true,
    })
    expect(active.map((r) => r.id)).toEqual(['active'])
    const all = await queryFileRecords(db(), { order: 'ASC' })
    expect(all).toHaveLength(3)
  })
})

describe('updateFileRecordFields edge cases', () => {
  it('writes null values correctly', async () => {
    await insertFileRecord(db(), makeFileRecord('f1', { trashedAt: 2000 }))
    await updateFileRecordFields(db(), { id: 'f1', trashedAt: null })
    const result = await readFileRecord(db(), 'f1')
    expect(result!.trashedAt).toBeNull()
  })
})

describe('readFileRecordsByIds edge cases', () => {
  it('returns tombstoned files', async () => {
    await insertFileRecord(
      db(),
      makeFileRecord('f1', { deletedAt: 2000, trashedAt: 2000 }),
    )
    const results = await readFileRecordsByIds(db(), ['f1'])
    expect(results).toHaveLength(1)
    expect(results[0].deletedAt).toBe(2000)
  })
})

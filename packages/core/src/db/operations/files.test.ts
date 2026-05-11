import {
  deleteFileAndThumbnails,
  deleteFileById,
  deleteFilesAndThumbnails,
  deleteLostFilesAndThumbnails,
  deleteManyFilesByIds,
  insertFile,
  insertManyFiles,
  tombstoneFiles,
  queryFileByContentHash,
  queryFileByObjectId,
  queryFiles,
  queryCurrentFilesByNamesInDirectory,
  queryFilesByContentHashes,
  queryFilesByLocalIds,
  queryFileCount,
  recalculateCurrentForGroups,
  queryFileStats,
  queryLostFiles,
  readFile,
  readFileWithObjects,
  readFilesByIds,
  updateFile,
  updateManyFiles,
} from './files'
import { insertDirectory } from './directories'
import { upsertFsMeta } from './fs'
import {
  clearObjectIfUnchanged,
  clearObjectsNeedsSyncUp,
  insertObject,
  markAllObjectsNeedsSyncUp,
} from './localObjects'
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

const INDEXER_URL = 'https://indexer.example.com'

/** Reads a file's object dirty flag (0 if the file has no object). */
async function objectFlag(fileId: string): Promise<number> {
  const row = await db().getFirstAsync<{ needsSyncUp: number }>(
    'SELECT needsSyncUp FROM objects WHERE fileId = ?',
    fileId,
  )
  return row?.needsSyncUp ?? 0
}

/** Clears a file's object dirty flag directly (test setup for "M flags it"). */
async function clearObjectFlag(fileId: string): Promise<void> {
  await db().runAsync('UPDATE objects SET needsSyncUp = 0 WHERE fileId = ?', fileId)
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

describe('needsSyncUp dirty flag (on objects)', () => {
  it('insertFile alone creates no object, so there is nothing to sync up', async () => {
    // A never-uploaded file has no object row and no dirty flag; the uploader
    // discovers it separately (queryUnuploadedFiles), not via needsSyncUp.
    await insertFile(db(), makeFileRecord('file-1'))
    const row = await db().getFirstAsync<{ id: string }>(
      'SELECT id FROM objects WHERE fileId = ?',
      'file-1',
    )
    expect(row).toBeNull()
  })

  it('insertObject creates the object flagged dirty', async () => {
    // The freshly pinned object carries the pushed metadata; needsSyncUp=1
    // reconciles it on the next pass and covers an edit that raced the upload.
    await insertFile(db(), makeFileRecord('file-1'))
    await insertObject(db(), makeLocalObject('file-1'))
    expect(await objectFlag('file-1')).toBe(1)
  })

  it('updateFile re-flags a clean object', async () => {
    await insertFile(db(), makeFileRecord('file-1', { updatedAt: 1000 }))
    await insertObject(db(), makeLocalObject('file-1'))
    await clearObjectFlag('file-1')
    expect(await objectFlag('file-1')).toBe(0)
    await updateFile(db(), { id: 'file-1', name: 'renamed.jpg' })
    expect(await objectFlag('file-1')).toBe(1)
  })

  it('clearObjectIfUnchanged clears only when files.updatedAt matches (CAS)', async () => {
    await insertFile(db(), makeFileRecord('file-1', { updatedAt: 1000 }))
    await insertObject(db(), makeLocalObject('file-1'))
    expect(await objectFlag('file-1')).toBe(1)
    // Stale expectation: a concurrent edit moved files.updatedAt, so the clear must no-op.
    await clearObjectIfUnchanged(db(), 'obj-file-1', INDEXER_URL, 999)
    expect(await objectFlag('file-1')).toBe(1)
    await clearObjectIfUnchanged(db(), 'obj-file-1', INDEXER_URL, 1000)
    expect(await objectFlag('file-1')).toBe(0)
  })

  it('tombstoneFiles flags local deletes but leaves remote-driven deletes clean', async () => {
    await insertFile(db(), makeFileRecord('local-del', { updatedAt: 1000 }))
    await insertObject(db(), makeLocalObject('local-del'))
    await clearObjectFlag('local-del')
    await tombstoneFiles(db(), ['local-del'], Date.now())
    expect(await objectFlag('local-del')).toBe(1)

    await insertFile(db(), makeFileRecord('remote-del', { updatedAt: 1000 }))
    await insertObject(db(), makeLocalObject('remote-del'))
    await clearObjectFlag('remote-del')
    await tombstoneFiles(db(), ['remote-del'], Date.now(), { setNeedsSyncUp: false })
    expect(await objectFlag('remote-del')).toBe(0)
  })

  it('tombstoneFiles flags the objects of every passed file id', async () => {
    // tombstoneFiles flags only the ids it is given; thumbForId-based thumbnail
    // flagging is tombstoneFilesAndThumbnails' job (covered in trash.test.ts).
    await insertFile(db(), makeFileRecord('a', { updatedAt: 1000 }))
    await insertFile(db(), makeFileRecord('b', { updatedAt: 1000 }))
    await insertObject(db(), makeLocalObject('a', { id: 'obj-a' }))
    await insertObject(db(), makeLocalObject('b', { id: 'obj-b' }))
    await clearObjectFlag('a')
    await clearObjectFlag('b')
    await tombstoneFiles(db(), ['a', 'b'], Date.now())
    expect(await objectFlag('a')).toBe(1)
    expect(await objectFlag('b')).toBe(1)
  })

  it('clearObjectsNeedsSyncUp clears the flag unconditionally (no CAS)', async () => {
    await insertFile(db(), makeFileRecord('uncond', { updatedAt: 1000 }))
    await insertObject(db(), makeLocalObject('uncond', { id: 'obj-uncond' }))
    expect(await objectFlag('uncond')).toBe(1)
    await clearObjectsNeedsSyncUp(db(), INDEXER_URL, ['obj-uncond'])
    expect(await objectFlag('uncond')).toBe(0)
  })

  it('markAllObjectsNeedsSyncUp re-flags every object', async () => {
    await insertManyFiles(db(), [
      makeFileRecord('a', { updatedAt: 1000 }),
      makeFileRecord('b', { updatedAt: 1000 }),
    ])
    await insertObject(db(), makeLocalObject('a', { id: 'obj-a' }))
    await insertObject(db(), makeLocalObject('b', { id: 'obj-b' }))
    await clearObjectFlag('a')
    await clearObjectFlag('b')
    await markAllObjectsNeedsSyncUp(db())
    expect(await objectFlag('a')).toBe(1)
    expect(await objectFlag('b')).toBe(1)
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

describe('readFileWithObjects', () => {
  it('includes slabs in objects', async () => {
    await insertFile(db(), makeFileRecord('file-1'))
    await insertObject(db(), makeLocalObject('file-1'))
    const result = await readFileWithObjects(db(), 'file-1')
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

  it('files all rows into directoryId when supplied', async () => {
    const dir = await insertDirectory(db(), 'Media')
    const records = [makeFileRecord('file-1'), makeFileRecord('file-2')]
    await insertManyFiles(db(), records, { directoryId: dir.id })
    const rows = await db().getAllAsync<{ id: string; directoryId: string | null }>(
      'SELECT id, directoryId FROM files WHERE id IN (?, ?)',
      'file-1',
      'file-2',
    )
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.directoryId === dir.id)).toBe(true)
  })

  it('leaves rows at root when directoryId is null or omitted', async () => {
    await insertManyFiles(db(), [makeFileRecord('file-1')], { directoryId: null })
    await insertManyFiles(db(), [makeFileRecord('file-2')])
    const rows = await db().getAllAsync<{ id: string; directoryId: string | null }>(
      'SELECT id, directoryId FROM files WHERE id IN (?, ?)',
      'file-1',
      'file-2',
    )
    expect(rows.every((r) => r.directoryId === null)).toBe(true)
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

  it('filters out trashed and deleted records', async () => {
    await insertFile(db(), makeFileRecord('active'))
    await insertFile(db(), makeFileRecord('trashed', { trashedAt: 2000 }))
    await insertFile(db(), makeFileRecord('deleted', { deletedAt: 3000 }))
    const results = await queryFiles(db(), {
      order: 'ASC',
      includeThumbnails: true,
      includeOldVersions: true,
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

  it('excludes trashed separately from deleted', async () => {
    await insertFile(db(), makeFileRecord('active'))
    await insertFile(db(), makeFileRecord('trashed', { trashedAt: 2000 }))
    await insertFile(db(), makeFileRecord('deleted', { deletedAt: 3000, trashedAt: 3000 }))
    const active = await queryFiles(db(), {
      order: 'ASC',
      includeThumbnails: true,
      includeOldVersions: true,
    })
    expect(active.map((r) => r.id)).toEqual(['active'])
    const all = await queryFiles(db(), {
      order: 'ASC',
      includeThumbnails: true,
      includeOldVersions: true,
      includeTrashed: true,
      includeDeleted: true,
    })
    expect(all).toHaveLength(3)
  })

  it('filters by lostReasonIsNull when set', async () => {
    await insertFile(db(), makeFileRecord('clean'))
    await insertFile(
      db(),
      makeFileRecord('lost', { lostReason: 'Source photo deleted from device' }),
    )
    const results = await queryFiles(db(), {
      order: 'ASC',
      lostReasonIsNull: true,
    })
    expect(results.map((r) => r.id)).toEqual(['clean'])
  })

  it('does not filter lostReason by default', async () => {
    await insertFile(db(), makeFileRecord('clean'))
    await insertFile(
      db(),
      makeFileRecord('lost', { lostReason: 'Source photo deleted from device' }),
    )
    const results = await queryFiles(db(), { order: 'ASC' })
    expect(results.map((r) => r.id).sort()).toEqual(['clean', 'lost'])
  })

  it('combines lostReasonIsNull with hashEmpty for the placeholder selector', async () => {
    // Mirrors importScanner Phase 2: hash='' AND lostReason IS NULL —
    // terminally lost placeholders must not re-enter the candidate pool.
    await insertFile(db(), makeFileRecord('placeholder', { hash: '' }))
    await insertFile(
      db(),
      makeFileRecord('placeholder-lost', {
        hash: '',
        lostReason: 'Source photo deleted from device',
      }),
    )
    await insertFile(db(), makeFileRecord('finalized', { hash: 'sha256:abc' }))
    const results = await queryFiles(db(), {
      order: 'ASC',
      hashEmpty: true,
      lostReasonIsNull: true,
    })
    expect(results.map((r) => r.id)).toEqual(['placeholder'])
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
      includeThumbnails: true,
      includeOldVersions: true,
    })
    expect(count).toBe(2)
  })

  it('returns 0 when no records match', async () => {
    const count = await queryFileCount(db(), {
      order: 'ASC',
      includeThumbnails: true,
      includeOldVersions: true,
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
      includeThumbnails: true,
      includeOldVersions: true,
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

describe('queryCurrentFilesByNamesInDirectory', () => {
  // Move a row to a different directory and recompute current flags for both
  // the source (root) and the destination groups, so each group's lone row
  // ends up current = 1.
  async function moveAndRecalc(id: string, directoryId: string | null) {
    const row = await db().getFirstAsync<{ name: string; directoryId: string | null }>(
      'SELECT name, directoryId FROM files WHERE id = ?',
      id,
    )
    if (!row) throw new Error(`row ${id} not found`)
    await db().runAsync('UPDATE files SET directoryId = ? WHERE id = ?', directoryId, id)
    await recalculateCurrentForGroups(db(), [
      { name: row.name, directoryId: row.directoryId },
      { name: row.name, directoryId },
    ])
  }

  it('matches by name within the given directoryId', async () => {
    const dir = await insertDirectory(db(), 'Docs')
    await insertFile(db(), makeFileRecord('root-a', { name: 'notes.txt' }))
    await insertFile(db(), makeFileRecord('dir-a', { name: 'notes.txt' }))
    await moveAndRecalc('dir-a', dir.id)
    const root = await queryCurrentFilesByNamesInDirectory(db(), ['notes.txt'], null)
    expect(root.map((r) => r.id)).toEqual(['root-a'])
    const inDir = await queryCurrentFilesByNamesInDirectory(db(), ['notes.txt'], dir.id)
    expect(inDir.map((r) => r.id)).toEqual(['dir-a'])
  })

  it('matches multiple names in one round-trip', async () => {
    await insertFile(db(), makeFileRecord('a', { name: 'a.txt' }))
    await insertFile(db(), makeFileRecord('b', { name: 'b.txt' }))
    await insertFile(db(), makeFileRecord('c', { name: 'c.txt' }))
    const rows = await queryCurrentFilesByNamesInDirectory(db(), ['a.txt', 'c.txt'], null)
    expect(rows.map((r) => r.id).sort()).toEqual(['a', 'c'])
  })

  it('returns only the current version when name has prior versions', async () => {
    await insertFile(db(), makeFileRecord('v1', { name: 'doc.txt', updatedAt: 1 }))
    await insertFile(db(), makeFileRecord('v2', { name: 'doc.txt', updatedAt: 2 }))
    const rows = await queryCurrentFilesByNamesInDirectory(db(), ['doc.txt'], null)
    expect(rows.map((r) => r.id)).toEqual(['v2'])
  })

  it('excludes trashed and deleted rows', async () => {
    await insertFile(db(), makeFileRecord('t', { name: 'gone.txt', trashedAt: 1 }))
    await insertFile(db(), makeFileRecord('d', { name: 'gone.txt', deletedAt: 1 }))
    const rows = await queryCurrentFilesByNamesInDirectory(db(), ['gone.txt'], null)
    expect(rows).toEqual([])
  })

  it('returns [] when names is empty', async () => {
    await insertFile(db(), makeFileRecord('a', { name: 'a.txt' }))
    const rows = await queryCurrentFilesByNamesInDirectory(db(), [], null)
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

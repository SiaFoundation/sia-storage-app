import { insertFileRecord } from './files'
import {
  countLocalObjectsForFile,
  deleteLocalObjectById,
  deleteLocalObjectsByFileId,
  deleteManyLocalObjectsByFileIds,
  insertLocalObject,
  queryLocalObjectsForFile,
  queryLocalObjectsForFiles,
} from './localObjects'
import { db, setupTestDb, teardownTestDb } from './test-setup'

async function createTestFile(id: string, overrides?: Record<string, any>) {
  await insertFileRecord(db(), {
    id,
    name: `${id}.jpg`,
    type: 'image/jpeg',
    kind: 'file',
    size: 100,
    hash: `hash-${id}`,
    createdAt: 1000,
    updatedAt: 1000,
    localId: `local-${id}`,
    addedAt: 1000,
    trashedAt: null,
    deletedAt: null,
    ...overrides,
  })
}

function makeLocalObject(fileId: string, indexerURL: string, objectId: string) {
  return {
    fileId,
    indexerURL,
    id: objectId,
    slabs: [],
    encryptedDataKey: new ArrayBuffer(3),
    encryptedMetadataKey: new ArrayBuffer(3),
    encryptedMetadata: new ArrayBuffer(3),
    dataSignature: new ArrayBuffer(2),
    metadataSignature: new ArrayBuffer(2),
    createdAt: new Date(1000),
    updatedAt: new Date(1000),
  }
}

beforeEach(setupTestDb)
afterEach(teardownTestDb)

describe('insertLocalObject', () => {
  it('inserts and can be read back', async () => {
    await createTestFile('f1')
    const obj = makeLocalObject('f1', 'https://idx.example.com', 'obj1')
    await insertLocalObject(db(), obj)

    const results = await queryLocalObjectsForFile(db(), 'f1')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('obj1')
    expect(results[0].fileId).toBe('f1')
    expect(results[0].indexerURL).toBe('https://idx.example.com')
  })
})

describe('queryLocalObjectsForFile', () => {
  it('returns objects for a file', async () => {
    await createTestFile('f1')
    await insertLocalObject(
      db(),
      makeLocalObject('f1', 'https://a.com', 'obj1'),
    )
    await insertLocalObject(
      db(),
      makeLocalObject('f1', 'https://b.com', 'obj2'),
    )

    const results = await queryLocalObjectsForFile(db(), 'f1')
    expect(results).toHaveLength(2)
  })

  it('returns empty for non-existent file', async () => {
    const results = await queryLocalObjectsForFile(db(), 'nonexistent')
    expect(results).toEqual([])
  })
})

describe('queryLocalObjectsForFiles', () => {
  it('returns map keyed by fileId', async () => {
    await createTestFile('f1')
    await createTestFile('f2')
    await insertLocalObject(
      db(),
      makeLocalObject('f1', 'https://a.com', 'obj1'),
    )
    await insertLocalObject(
      db(),
      makeLocalObject('f2', 'https://a.com', 'obj2'),
    )

    const map = await queryLocalObjectsForFiles(db(), ['f1', 'f2'])
    expect(map.f1).toHaveLength(1)
    expect(map.f1[0].id).toBe('obj1')
    expect(map.f2).toHaveLength(1)
    expect(map.f2[0].id).toBe('obj2')
  })

  it('returns empty object for empty input', async () => {
    const map = await queryLocalObjectsForFiles(db(), [])
    expect(map).toEqual({})
  })
})

describe('countLocalObjectsForFile', () => {
  it('counts correctly', async () => {
    await createTestFile('f1')
    await insertLocalObject(
      db(),
      makeLocalObject('f1', 'https://a.com', 'obj1'),
    )
    await insertLocalObject(
      db(),
      makeLocalObject('f1', 'https://b.com', 'obj2'),
    )

    const count = await countLocalObjectsForFile(db(), 'f1')
    expect(count).toBe(2)
  })

  it('returns 0 for no objects', async () => {
    await createTestFile('f1')
    const count = await countLocalObjectsForFile(db(), 'f1')
    expect(count).toBe(0)
  })
})

describe('deleteLocalObjectById', () => {
  it('deletes specific object', async () => {
    await createTestFile('f1')
    await insertLocalObject(
      db(),
      makeLocalObject('f1', 'https://a.com', 'obj1'),
    )
    await insertLocalObject(
      db(),
      makeLocalObject('f1', 'https://b.com', 'obj2'),
    )

    await deleteLocalObjectById(db(), 'obj1', 'https://a.com')

    const results = await queryLocalObjectsForFile(db(), 'f1')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('obj2')
  })
})

describe('deleteLocalObjectsByFileId', () => {
  it('deletes all objects for a file', async () => {
    await createTestFile('f1')
    await insertLocalObject(
      db(),
      makeLocalObject('f1', 'https://a.com', 'obj1'),
    )
    await insertLocalObject(
      db(),
      makeLocalObject('f1', 'https://b.com', 'obj2'),
    )

    await deleteLocalObjectsByFileId(db(), 'f1')

    const results = await queryLocalObjectsForFile(db(), 'f1')
    expect(results).toEqual([])
  })
})

describe('deleteManyLocalObjectsByFileIds', () => {
  it('batch deletes across multiple files', async () => {
    await createTestFile('f1')
    await createTestFile('f2')
    await createTestFile('f3')
    await insertLocalObject(
      db(),
      makeLocalObject('f1', 'https://a.com', 'obj1'),
    )
    await insertLocalObject(
      db(),
      makeLocalObject('f2', 'https://a.com', 'obj2'),
    )
    await insertLocalObject(
      db(),
      makeLocalObject('f3', 'https://a.com', 'obj3'),
    )

    await deleteManyLocalObjectsByFileIds(db(), ['f1', 'f2'])

    expect(await queryLocalObjectsForFile(db(), 'f1')).toEqual([])
    expect(await queryLocalObjectsForFile(db(), 'f2')).toEqual([])
    expect(await queryLocalObjectsForFile(db(), 'f3')).toHaveLength(1)
  })

  it('handles empty array', async () => {
    await deleteManyLocalObjectsByFileIds(db(), [])
  })
})

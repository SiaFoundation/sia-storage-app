import { insertFile } from './files'
import {
  countObjectsForFile,
  deleteObject,
  deleteObjectsForFile,
  deleteManyObjectsForFiles,
  insertObject,
  queryObjectRefsForFile,
  queryObjectRefsForFiles,
  queryObjectsForFile,
  queryObjectsForFiles,
} from './localObjects'
import { db, setupTestDb, teardownTestDb } from './test-setup'

async function createTestFile(id: string, overrides?: Record<string, any>) {
  await insertFile(db(), {
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

describe('insertObject', () => {
  it('inserts and can be read back', async () => {
    await createTestFile('f1')
    const obj = makeLocalObject('f1', 'https://idx.example.com', 'obj1')
    await insertObject(db(), obj)

    const results = await queryObjectRefsForFile(db(), 'f1')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('obj1')
    expect(results[0].fileId).toBe('f1')
    expect(results[0].indexerURL).toBe('https://idx.example.com')
  })
})

describe('queryObjectRefsForFile', () => {
  it('returns refs without slabs or encrypted fields', async () => {
    await createTestFile('f1')
    await insertObject(db(), makeLocalObject('f1', 'https://a.com', 'obj1'))
    await insertObject(db(), makeLocalObject('f1', 'https://b.com', 'obj2'))

    const results = await queryObjectRefsForFile(db(), 'f1')
    expect(results).toHaveLength(2)
    expect(results[0]).not.toHaveProperty('slabs')
    expect(results[0]).not.toHaveProperty('encryptedDataKey')
    expect(results[0].id).toBeDefined()
  })

  it('returns empty for non-existent file', async () => {
    const results = await queryObjectRefsForFile(db(), 'nonexistent')
    expect(results).toEqual([])
  })
})

describe('queryObjectsForFile', () => {
  it('returns full objects with slabs', async () => {
    await createTestFile('f1')
    await insertObject(db(), makeLocalObject('f1', 'https://a.com', 'obj1'))

    const results = await queryObjectsForFile(db(), 'f1')
    expect(results).toHaveLength(1)
    expect(results[0]).toHaveProperty('slabs')
    expect(results[0].slabs).toEqual([])
  })
})

describe('queryObjectRefsForFiles', () => {
  it('returns map keyed by fileId without slabs', async () => {
    await createTestFile('f1')
    await createTestFile('f2')
    await insertObject(db(), makeLocalObject('f1', 'https://a.com', 'obj1'))
    await insertObject(db(), makeLocalObject('f2', 'https://a.com', 'obj2'))

    const map = await queryObjectRefsForFiles(db(), ['f1', 'f2'])
    expect(map.f1).toHaveLength(1)
    expect(map.f1[0].id).toBe('obj1')
    expect(map.f1[0]).not.toHaveProperty('slabs')
    expect(map.f2).toHaveLength(1)
    expect(map.f2[0].id).toBe('obj2')
  })

  it('returns empty object for empty input', async () => {
    const map = await queryObjectRefsForFiles(db(), [])
    expect(map).toEqual({})
  })
})

describe('queryObjectsForFiles', () => {
  it('returns map with slabs included', async () => {
    await createTestFile('f1')
    await insertObject(db(), makeLocalObject('f1', 'https://a.com', 'obj1'))

    const map = await queryObjectsForFiles(db(), ['f1'])
    expect(map.f1).toHaveLength(1)
    expect(map.f1[0]).toHaveProperty('slabs')
  })
})

describe('countObjectsForFile', () => {
  it('counts correctly', async () => {
    await createTestFile('f1')
    await insertObject(db(), makeLocalObject('f1', 'https://a.com', 'obj1'))
    await insertObject(db(), makeLocalObject('f1', 'https://b.com', 'obj2'))

    const count = await countObjectsForFile(db(), 'f1')
    expect(count).toBe(2)
  })

  it('returns 0 for no objects', async () => {
    await createTestFile('f1')
    const count = await countObjectsForFile(db(), 'f1')
    expect(count).toBe(0)
  })
})

describe('deleteObject', () => {
  it('deletes specific object', async () => {
    await createTestFile('f1')
    await insertObject(db(), makeLocalObject('f1', 'https://a.com', 'obj1'))
    await insertObject(db(), makeLocalObject('f1', 'https://b.com', 'obj2'))

    await deleteObject(db(), 'obj1', 'https://a.com')

    const results = await queryObjectRefsForFile(db(), 'f1')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('obj2')
  })
})

describe('deleteObjectsForFile', () => {
  it('deletes all objects for a file', async () => {
    await createTestFile('f1')
    await insertObject(db(), makeLocalObject('f1', 'https://a.com', 'obj1'))
    await insertObject(db(), makeLocalObject('f1', 'https://b.com', 'obj2'))

    await deleteObjectsForFile(db(), 'f1')

    const results = await queryObjectRefsForFile(db(), 'f1')
    expect(results).toEqual([])
  })
})

describe('deleteManyObjectsForFiles', () => {
  it('batch deletes across multiple files', async () => {
    await createTestFile('f1')
    await createTestFile('f2')
    await createTestFile('f3')
    await insertObject(db(), makeLocalObject('f1', 'https://a.com', 'obj1'))
    await insertObject(db(), makeLocalObject('f2', 'https://a.com', 'obj2'))
    await insertObject(db(), makeLocalObject('f3', 'https://a.com', 'obj3'))

    await deleteManyObjectsForFiles(db(), ['f1', 'f2'])

    expect(await queryObjectRefsForFile(db(), 'f1')).toEqual([])
    expect(await queryObjectRefsForFile(db(), 'f2')).toEqual([])
    expect(await queryObjectRefsForFile(db(), 'f3')).toHaveLength(1)
  })

  it('handles empty array', async () => {
    await deleteManyObjectsForFiles(db(), [])
  })
})

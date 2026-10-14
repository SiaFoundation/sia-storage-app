import { queryUploadStats } from './fileStats'
import { insertFile } from './files'
import { upsertFsMeta } from './fs'
import { insertObject } from './localObjects'
import { db, setupTestDb, teardownTestDb } from './test-setup'

beforeEach(setupTestDb)
afterEach(teardownTestDb)

const INDEXER = 'https://indexer.example.com'

function makeFile(id: string, overrides?: Record<string, unknown>) {
  return {
    id,
    name: `${id}.jpg`,
    type: 'image/jpeg',
    kind: 'file' as const,
    size: 100,
    hash: `sha256:hash-${id}` as const,
    createdAt: 1000,
    updatedAt: 1000,
    mediaAssetId: null,
    addedAt: 1000,
    trashedAt: null,
    deletedAt: null,
    ...overrides,
  }
}

function makeObject(fileId: string, indexerURL = INDEXER) {
  return {
    fileId,
    indexerURL,
    id: `obj-${fileId}-${indexerURL}`,
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

async function addLocal(id: string, size = 100) {
  await upsertFsMeta(db(), { fileId: id, size, addedAt: 1000, usedAt: 1000 })
}

describe('queryUploadStats', () => {
  it('counts a file with no object and no local copy as unavailable, not remaining', async () => {
    await insertFile(db(), makeFile('uploaded', { size: 300 }))
    await insertObject(db(), makeObject('uploaded'))
    await insertFile(db(), makeFile('waiting', { size: 200 }))
    await addLocal('waiting', 200)
    await insertFile(db(), makeFile('gone', { size: 700 }))

    const { photos } = await queryUploadStats(db(), INDEXER)

    expect(photos).toMatchObject({
      total: 2,
      uploaded: 1,
      remaining: 1,
      unavailable: 1,
      totalBytes: 500,
      uploadedBytes: 300,
      unavailableBytes: 700,
    })
    expect(photos.percentDecimal).toBeCloseTo(0.6)
  })

  it('never counts uploaded below zero when a file is imported between its two reads', async () => {
    await insertFile(db(), makeFile('a'))
    await addLocal('a')
    await insertFile(db(), makeFile('b'))
    await addLocal('b')
    // The photos total is read as if before 'b' was imported, and its waiting
    // files after, so the waiting count exceeds the total by one.
    jest
      .spyOn(db(), 'getFirstAsync')
      .mockImplementationOnce(async () => ({ count: 1, bytes: 100 }) as never)

    const { photos } = await queryUploadStats(db(), INDEXER)

    expect(photos.uploaded).toBe(0)
    expect(photos.uploadedBytes).toBe(0)
    expect(photos.remaining).toBe(2)
  })

  it('reads complete when every file that can upload has uploaded', async () => {
    await insertFile(db(), makeFile('uploaded'))
    await insertObject(db(), makeObject('uploaded'))
    await insertFile(db(), makeFile('gone'))

    const { files } = await queryUploadStats(db(), INDEXER)

    expect(files.uploaded).toBe(files.total)
    expect(files.unavailable).toBe(1)
    expect(files.percentDecimal).toBe(1)
  })

  it('counts a local file marked lost as unavailable', async () => {
    await insertFile(db(), makeFile('empty', { lostReason: 'Empty file' }))
    await addLocal('empty')

    const { files } = await queryUploadStats(db(), INDEXER)

    expect(files).toMatchObject({ total: 0, remaining: 0, unavailable: 1 })
  })

  it('counts an object on another indexer as not uploaded', async () => {
    await insertFile(db(), makeFile('elsewhere'))
    await insertObject(db(), makeObject('elsewhere', 'https://other.example.com'))
    await addLocal('elsewhere')

    const { files } = await queryUploadStats(db(), INDEXER)

    expect(files).toMatchObject({ total: 1, uploaded: 0, remaining: 1, unavailable: 0 })
  })

  it('sums unavailable files across categories into files and overall', async () => {
    await insertFile(db(), makeFile('photo', { size: 10 }))
    await insertFile(db(), makeFile('clip', { type: 'video/mp4', name: 'clip.mp4', size: 20 }))
    await insertFile(
      db(),
      makeFile('thumb', { kind: 'thumb', thumbForId: 'photo', thumbSize: 64, size: 1 }),
    )

    const stats = await queryUploadStats(db(), INDEXER)

    expect(stats.files).toMatchObject({ total: 0, unavailable: 2, unavailableBytes: 30 })
    expect(stats.thumbnails).toMatchObject({ total: 0, unavailable: 1 })
    expect(stats.overall).toMatchObject({ total: 0, unavailable: 3, unavailableBytes: 31 })
  })
})

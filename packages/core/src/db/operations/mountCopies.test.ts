import { insertFile } from './files'
import { upsertFsMeta } from './fs'
import { insertObject } from './localObjects'
import {
  addMountRange,
  deleteMountCopies,
  queryMountOnlyBytes,
  markMountCopiesWhole,
  queryStaleMountStackIds,
  queryWholeMountStackIds,
  readMountCopy,
  rekeyMountCopy,
  touchMountCopies,
  upsertWholeMountCopy,
} from './mountCopies'
import { queryStackIdForRow } from './providerChanges'
import { db, setupTestDb, teardownTestDb } from './test-setup'
import { trashFilesAndThumbnails } from './trash'

beforeEach(setupTestDb)
afterEach(teardownTestDb)

const INDEXER = 'https://indexer.example.com'

function makeFile(id: string, overrides?: Record<string, unknown>) {
  return {
    id,
    name: `${id}.bin`,
    type: 'application/octet-stream',
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

/** Adds a file, uploaded unless told otherwise, and returns the id its stack is named by. */
async function addFile(
  id: string,
  opts: { uploaded?: boolean; cached?: boolean; overrides?: Record<string, unknown> } = {},
): Promise<string> {
  await insertFile(db(), makeFile(id, opts.overrides))
  if (opts.uploaded !== false) await insertObject(db(), makeObject(id))
  if (opts.cached) await upsertFsMeta(db(), { fileId: id, size: 100, addedAt: 1000, usedAt: 1000 })
  const stackId = await queryStackIdForRow(db(), id)
  if (!stackId) throw new Error(`no stack for ${id}`)
  return stackId
}

const hold = (stackId: string, fileId: string, usedAt = 1000, bytes = 100) =>
  upsertWholeMountCopy(db(), { stackId, fileId, bytes, usedAt })

describe('addMountRange', () => {
  it('adds up the ranges of one version, capped at its size, and never calls it whole', async () => {
    await addMountRange(db(), { stackId: 's', fileId: 'v1', fileSize: 1000, bytes: 400, usedAt: 1 })
    expect(await readMountCopy(db(), 's')).toEqual({
      stackId: 's',
      fileId: 'v1',
      bytes: 400,
      whole: false,
      usedAt: 1,
    })

    // Ranges can repeat, so reaching the file's size does not show the
    // system has all of it.
    for (let i = 2; i < 5; i++) {
      await addMountRange(db(), {
        stackId: 's',
        fileId: 'v1',
        fileSize: 1000,
        bytes: 400,
        usedAt: i,
      })
    }
    expect(await readMountCopy(db(), 's')).toMatchObject({ bytes: 1000, whole: false, usedAt: 4 })
  })

  it('starts over when the range belongs to another version', async () => {
    await addMountRange(db(), { stackId: 's', fileId: 'v1', fileSize: 1000, bytes: 900, usedAt: 1 })
    await addMountRange(db(), { stackId: 's', fileId: 'v2', fileSize: 1000, bytes: 200, usedAt: 2 })
    expect(await readMountCopy(db(), 's')).toMatchObject({
      fileId: 'v2',
      bytes: 200,
      whole: false,
    })
  })

  it('leaves a whole copy of the same version whole', async () => {
    await hold('s', 'v1', 1, 1000)
    await addMountRange(db(), { stackId: 's', fileId: 'v1', fileSize: 1000, bytes: 100, usedAt: 2 })
    expect(await readMountCopy(db(), 's')).toMatchObject({ bytes: 1000, whole: true, usedAt: 2 })
  })

  it('loses neither of two ranges recorded at once', async () => {
    const range = { stackId: 's', fileId: 'v1', fileSize: 1000, usedAt: 1 }
    await Promise.all([
      addMountRange(db(), { ...range, bytes: 300 }),
      addMountRange(db(), { ...range, bytes: 200 }),
    ])
    expect(await readMountCopy(db(), 's')).toMatchObject({ bytes: 500 })
  })
})

describe('deleteMountCopies', () => {
  it('returns the rows it deleted', async () => {
    await hold('a', 'va')
    await hold('b', 'vb')
    const deleted = await deleteMountCopies(db(), ['a', 'missing'])
    expect(deleted.map((r) => r.stackId)).toEqual(['a'])
    expect(await readMountCopy(db(), 'a')).toBeNull()
    expect(await readMountCopy(db(), 'b')).not.toBeNull()
  })

  it('keeps a row used at or after the time given', async () => {
    await hold('old', 'v1', 100)
    await hold('new', 'v2', 200)
    const deleted = await deleteMountCopies(db(), ['old', 'new'], 200)
    expect(deleted.map((r) => r.stackId)).toEqual(['old'])
    expect(await readMountCopy(db(), 'new')).not.toBeNull()
  })
})

describe('touch and rekey', () => {
  it('moves the last use of the rows named', async () => {
    await hold('a', 'va', 1)
    await hold('b', 'vb', 1)
    await touchMountCopies(db(), ['a'], 50)
    expect((await readMountCopy(db(), 'a'))?.usedAt).toBe(50)
    expect((await readMountCopy(db(), 'b'))?.usedAt).toBe(1)
  })

  it('moves a version to another stack, replacing the row already there', async () => {
    await hold('from', 'v1')
    await hold('to', 'v0')
    await rekeyMountCopy(db(), 'v1', 'to')
    expect(await readMountCopy(db(), 'from')).toBeNull()
    expect(await readMountCopy(db(), 'to')).toMatchObject({ fileId: 'v1' })
  })
})

describe('queryMountOnlyBytes', () => {
  it('leaves out a version the cache also holds', async () => {
    await hold('a', 'va', 1, 300)
    await hold('b', 'vb', 1, 500)
    await upsertFsMeta(db(), { fileId: 'vb', size: 500, addedAt: 1, usedAt: 1 })
    expect(await queryMountOnlyBytes(db())).toBe(300)
  })
})

describe('markMountCopiesWhole and queryStaleMountStackIds', () => {
  it('records the newest visible version of each stack, keeping the last use of a row already there', async () => {
    const stack = await addFile('v1', { overrides: { name: 'doc.bin', updatedAt: 1000 } })
    await addFile('v2', { overrides: { name: 'doc.bin', updatedAt: 2000, size: 250 } })
    const partial = await addFile('p1', { overrides: { size: 400 } })
    await addMountRange(db(), {
      stackId: partial,
      fileId: 'p1',
      fileSize: 400,
      bytes: 100,
      usedAt: 7,
    })

    await markMountCopiesWhole(db(), [stack, partial, 'unknown'], 50)

    expect(await readMountCopy(db(), stack)).toEqual({
      stackId: stack,
      fileId: 'v2',
      bytes: 250,
      whole: true,
      usedAt: 50,
    })
    expect(await readMountCopy(db(), partial)).toMatchObject({ bytes: 400, whole: true, usedAt: 7 })
    expect(await readMountCopy(db(), 'unknown')).toBeNull()
  })

  it('finds a row for a trashed file, and ranges of a version no longer shown', async () => {
    const trashed = await addFile('gone')
    await hold(trashed, 'gone')
    await trashFilesAndThumbnails(db(), ['gone'])

    const stack = await addFile('v1', { overrides: { name: 'doc.bin', updatedAt: 1000 } })
    await addMountRange(db(), {
      stackId: stack,
      fileId: 'v1',
      fileSize: 100,
      bytes: 40,
      usedAt: 1,
    })
    await addFile('v2', { overrides: { name: 'doc.bin', updatedAt: 2000 } })

    const whole = await addFile('w1', { overrides: { name: 'kept.bin', updatedAt: 1000 } })
    await hold(whole, 'w1')
    await addFile('w2', { overrides: { name: 'kept.bin', updatedAt: 2000 } })

    // The whole copy of an older version stays: those bytes are on disk
    // until the system fetches the new version.
    expect((await queryStaleMountStackIds(db())).sort()).toEqual([trashed, stack].sort())
    expect(await queryWholeMountStackIds(db())).toEqual(expect.arrayContaining([whole]))
  })
})

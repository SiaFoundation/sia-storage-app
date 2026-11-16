import { upsertFsMeta } from './fs'
import {
  addMountRange,
  deleteMountCopies,
  queryMountOnlyBytes,
  readMountCopy,
  rekeyMountCopy,
  touchMountCopies,
  upsertWholeMountCopy,
} from './mountCopies'
import { db, setupTestDb, teardownTestDb } from './test-setup'

beforeEach(setupTestDb)
afterEach(teardownTestDb)

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

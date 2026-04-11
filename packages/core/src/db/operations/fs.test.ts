import {
  queryFsMetaTotalSize,
  deleteFsMeta,
  deleteManyFsMeta,
  readFsMeta,
  updateFsMetaUsedAt,
  upsertFsMeta,
} from './fs'
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

import {
  calcFsFilesMetadataTotalSize,
  deleteFsFileMetadata,
  deleteFsFileMetadataBatch,
  readFsFileMetadata,
  updateFsFileMetadataUsedAt,
  upsertFsFileMetadata,
} from './fs'
import { db, setupTestDb, teardownTestDb } from './test-setup'

beforeEach(setupTestDb)
afterEach(teardownTestDb)

describe('upsertFsFileMetadata', () => {
  it('inserts new metadata', async () => {
    await upsertFsFileMetadata(db(), {
      fileId: 'f1',
      size: 500,
      addedAt: 1000,
      usedAt: 1000,
    })

    const row = await readFsFileMetadata(db(), 'f1')
    expect(row).toEqual({
      fileId: 'f1',
      size: 500,
      addedAt: 1000,
      usedAt: 1000,
    })
  })

  it('updates existing metadata via OR REPLACE', async () => {
    await upsertFsFileMetadata(db(), {
      fileId: 'f1',
      size: 500,
      addedAt: 1000,
      usedAt: 1000,
    })
    await upsertFsFileMetadata(db(), {
      fileId: 'f1',
      size: 800,
      addedAt: 2000,
      usedAt: 2000,
    })

    const row = await readFsFileMetadata(db(), 'f1')
    expect(row?.size).toBe(800)
    expect(row?.addedAt).toBe(2000)
  })
})

describe('readFsFileMetadata', () => {
  it('reads back inserted metadata', async () => {
    await upsertFsFileMetadata(db(), {
      fileId: 'f1',
      size: 100,
      addedAt: 1000,
      usedAt: 2000,
    })

    const row = await readFsFileMetadata(db(), 'f1')
    expect(row).not.toBeNull()
    expect(row?.fileId).toBe('f1')
    expect(row?.usedAt).toBe(2000)
  })

  it('returns null if not found', async () => {
    const row = await readFsFileMetadata(db(), 'nonexistent')
    expect(row).toBeNull()
  })
})

describe('updateFsFileMetadataUsedAt', () => {
  it('updates usedAt field', async () => {
    await upsertFsFileMetadata(db(), {
      fileId: 'f1',
      size: 100,
      addedAt: 1000,
      usedAt: 1000,
    })

    await updateFsFileMetadataUsedAt(db(), 'f1', 5000)

    const row = await readFsFileMetadata(db(), 'f1')
    expect(row?.usedAt).toBe(5000)
  })
})

describe('deleteFsFileMetadata', () => {
  it('deletes by fileId', async () => {
    await upsertFsFileMetadata(db(), {
      fileId: 'f1',
      size: 100,
      addedAt: 1000,
      usedAt: 1000,
    })

    await deleteFsFileMetadata(db(), 'f1')

    const row = await readFsFileMetadata(db(), 'f1')
    expect(row).toBeNull()
  })
})

describe('deleteFsFileMetadataBatch', () => {
  it('batch deletes multiple entries', async () => {
    await upsertFsFileMetadata(db(), {
      fileId: 'f1',
      size: 100,
      addedAt: 1000,
      usedAt: 1000,
    })
    await upsertFsFileMetadata(db(), {
      fileId: 'f2',
      size: 200,
      addedAt: 1000,
      usedAt: 1000,
    })
    await upsertFsFileMetadata(db(), {
      fileId: 'f3',
      size: 300,
      addedAt: 1000,
      usedAt: 1000,
    })

    await deleteFsFileMetadataBatch(db(), ['f1', 'f2'])

    expect(await readFsFileMetadata(db(), 'f1')).toBeNull()
    expect(await readFsFileMetadata(db(), 'f2')).toBeNull()
    expect(await readFsFileMetadata(db(), 'f3')).not.toBeNull()
  })

  it('handles empty array', async () => {
    await deleteFsFileMetadataBatch(db(), [])
  })
})

describe('calcFsFilesMetadataTotalSize', () => {
  it('sums all sizes', async () => {
    await upsertFsFileMetadata(db(), {
      fileId: 'f1',
      size: 100,
      addedAt: 1000,
      usedAt: 1000,
    })
    await upsertFsFileMetadata(db(), {
      fileId: 'f2',
      size: 250,
      addedAt: 1000,
      usedAt: 1000,
    })

    const total = await calcFsFilesMetadataTotalSize(db())
    expect(total).toBe(350)
  })

  it('returns 0 when empty', async () => {
    const total = await calcFsFilesMetadataTotalSize(db())
    expect(total).toBe(0)
  })
})

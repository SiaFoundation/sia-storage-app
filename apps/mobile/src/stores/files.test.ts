import { initializeDB, resetDb } from '../db'
import {
  createFileRecord,
  readAllFileRecords,
  readAllFileRecordsCount,
  readFileRecord,
  readFileRecordsByIds,
  updateFileRecord,
} from './files'
import { upsertFsFileMetadata } from './fs'

describe('files store queries', () => {
  const base = 1_000

  beforeEach(async () => {
    await initializeDB()
  })

  afterEach(async () => {
    await resetDb()
    jest.clearAllMocks()
  })

  async function createRecord(params: {
    id: string
    createdAt: number
    updatedAt: number
  }) {
    await createFileRecord({
      id: params.id,
      name: `${params.id}.jpg`,
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: `hash-${params.id}`,
      createdAt: params.createdAt,
      updatedAt: params.updatedAt,
      localId: null,
      addedAt: params.createdAt,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    })
  }

  async function seedRecords() {
    await createRecord({ id: 'file-old', createdAt: base, updatedAt: base })
    await createRecord({
      id: 'file-mid',
      createdAt: base + 5,
      updatedAt: base + 1_000,
    })
    await createRecord({
      id: 'file-tie',
      createdAt: base + 10,
      updatedAt: base + 1_000,
    })
    await createRecord({
      id: 'file-new',
      createdAt: base + 15,
      updatedAt: base + 2_000,
    })
  }

  test('orders by updatedAt ascending when requested', async () => {
    await seedRecords()

    const rows = await readAllFileRecords({
      order: 'ASC',
      orderBy: 'updatedAt',
    })

    expect(rows.map((r) => r.id)).toEqual([
      'file-old',
      'file-mid',
      'file-tie',
      'file-new',
    ])
  })

  test('orders by updatedAt descending when requested', async () => {
    await seedRecords()

    const rows = await readAllFileRecords({
      order: 'DESC',
      orderBy: 'updatedAt',
    })

    expect(rows.map((r) => r.id)).toEqual([
      'file-new',
      'file-tie',
      'file-mid',
      'file-old',
    ])
  })

  test('applies updatedAt cursor for pagination', async () => {
    await seedRecords()

    const rows = await readAllFileRecords({
      order: 'ASC',
      orderBy: 'updatedAt',
      after: { value: base + 1_000, id: 'file-mid' },
    })

    expect(rows.map((r) => r.id)).toEqual(['file-tie', 'file-new'])
  })

  test('count respects updatedAt ordering and cursor', async () => {
    await seedRecords()

    const count = await readAllFileRecordsCount({
      order: 'ASC',
      orderBy: 'updatedAt',
      after: { value: base + 1_000, id: 'file-mid' },
    })

    expect(count).toBe(2)
  })

  test('filters records that exist locally when fileExistsLocally is true', async () => {
    await seedRecords()
    await upsertFsFileMetadata({
      fileId: 'file-old',
      size: 100,
      addedAt: base,
      usedAt: base,
    })
    await upsertFsFileMetadata({
      fileId: 'file-mid',
      size: 200,
      addedAt: base + 5,
      usedAt: base + 5,
    })

    const rows = await readAllFileRecords({
      order: 'ASC',
      fileExistsLocally: true,
    })

    expect(rows.map((row) => row.id)).toEqual(['file-old', 'file-mid'])
  })

  test('filters records without local files when fileExistsLocally is false', async () => {
    await seedRecords()
    await upsertFsFileMetadata({
      fileId: 'file-old',
      size: 100,
      addedAt: base,
      usedAt: base,
    })
    await upsertFsFileMetadata({
      fileId: 'file-mid',
      size: 200,
      addedAt: base + 5,
      usedAt: base + 5,
    })

    const rows = await readAllFileRecords({
      order: 'ASC',
      fileExistsLocally: false,
    })

    expect(rows.map((row) => row.id)).toEqual(['file-tie', 'file-new'])
  })

  test('counts records without local files when fileExistsLocally is false', async () => {
    await seedRecords()
    await upsertFsFileMetadata({
      fileId: 'file-old',
      size: 100,
      addedAt: base,
      usedAt: base,
    })
    await upsertFsFileMetadata({
      fileId: 'file-mid',
      size: 200,
      addedAt: base + 5,
      usedAt: base + 5,
    })

    const count = await readAllFileRecordsCount({
      order: 'ASC',
      fileExistsLocally: false,
    })

    expect(count).toBe(2)
  })
})

describe('updateFileRecord', () => {
  beforeEach(async () => {
    await initializeDB()
  })

  afterEach(async () => {
    await resetDb()
    jest.restoreAllMocks()
    jest.clearAllMocks()
  })

  test('update file record ignores updatedAt when includeUpdatedAt is false', async () => {
    const mockTime = 1_695_734_567_890
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(mockTime)
    await createFileRecord({
      id: 'file-new',
      name: 'old name',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-file-new',
      createdAt: 100,
      updatedAt: 100,
      localId: null,
      addedAt: 100,
      trashedAt: null,
      deletedAt: null,
    })
    await updateFileRecord({
      id: 'file-new',
      updatedAt: 4444,
      name: 'new name',
    })

    const record = await readFileRecord('file-new')
    expect(record).toMatchObject({ name: 'new name', updatedAt: mockTime })
    expect(nowSpy).toHaveBeenCalled()
  })

  test('update file record includes updatedAt when includeUpdatedAt is true', async () => {
    const mockTime = 1_695_734_567_890
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(mockTime)
    await createFileRecord({
      id: 'file-new',
      name: 'old name',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-file-new',
      createdAt: 100,
      updatedAt: 100,
      localId: null,
      addedAt: 100,
      trashedAt: null,
      deletedAt: null,
    })
    await updateFileRecord(
      {
        id: 'file-new',
        updatedAt: 4444,
        name: 'new name',
      },
      false,
      { includeUpdatedAt: true },
    )
    const record = await readFileRecord('file-new')
    expect(record).toMatchObject({ name: 'new name', updatedAt: 4444 })
    expect(nowSpy).not.toHaveBeenCalled()
  })
})

describe('activeOnly filter and null handling', () => {
  const base = 2_000

  beforeEach(async () => {
    await initializeDB()
  })

  afterEach(async () => {
    await resetDb()
    jest.clearAllMocks()
  })

  async function createRecord(params: { id: string; createdAt: number }) {
    await createFileRecord({
      id: params.id,
      name: `${params.id}.jpg`,
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: `hash-${params.id}`,
      createdAt: params.createdAt,
      updatedAt: params.createdAt,
      localId: null,
      addedAt: params.createdAt,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    })
  }

  test('trashedAt filter excludes trashed files from active queries', async () => {
    await createRecord({ id: 'file-a', createdAt: base })

    const before = await readAllFileRecords({ order: 'ASC', activeOnly: true })
    expect(before.map((r) => r.id)).toContain('file-a')

    await updateFileRecord({ id: 'file-a', trashedAt: base + 1 })

    const afterActive = await readAllFileRecords({
      order: 'ASC',
      activeOnly: true,
    })
    expect(afterActive.map((r) => r.id)).not.toContain('file-a')

    const afterAll = await readAllFileRecords({ order: 'ASC' })
    expect(afterAll.map((r) => r.id)).toContain('file-a')
  })

  test('deletedAt filter excludes tombstones from active queries', async () => {
    await createRecord({ id: 'file-b', createdAt: base })

    const before = await readAllFileRecords({ order: 'ASC', activeOnly: true })
    expect(before.map((r) => r.id)).toContain('file-b')

    await updateFileRecord({ id: 'file-b', deletedAt: base + 1 })

    const afterActive = await readAllFileRecords({
      order: 'ASC',
      activeOnly: true,
    })
    expect(afterActive.map((r) => r.id)).not.toContain('file-b')

    const afterAll = await readAllFileRecords({ order: 'ASC' })
    expect(afterAll.map((r) => r.id)).toContain('file-b')
  })

  test('updateFileRecord writes null values correctly', async () => {
    await createRecord({ id: 'file-c', createdAt: base })
    await updateFileRecord({ id: 'file-c', trashedAt: base + 1 })

    const trashed = await readFileRecord('file-c')
    expect(trashed?.trashedAt).toBe(base + 1)

    await updateFileRecord({ id: 'file-c', trashedAt: null })

    const restored = await readFileRecord('file-c')
    expect(restored?.trashedAt).toBeNull()
  })

  test('readFileRecordsByIds returns tombstoned files', async () => {
    await createRecord({ id: 'file-d', createdAt: base })
    await updateFileRecord({ id: 'file-d', deletedAt: base + 1 })

    const results = await readFileRecordsByIds(['file-d'])
    expect(results.map((r) => r.id)).toContain('file-d')
  })
})

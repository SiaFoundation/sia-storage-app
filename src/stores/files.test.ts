import { initializeDB, resetDb } from '../db'
import {
  createFileRecord,
  readAllFileRecords,
  readAllFileRecordsCount,
} from './files'

jest.mock('./library', () => ({
  librarySwr: {
    triggerChange: jest.fn(),
    addChangeCallback: jest.fn(),
    getKey: jest.fn((key: string) => key),
  },
}))

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
      size: 100,
      hash: `hash-${params.id}`,
      createdAt: params.createdAt,
      updatedAt: params.updatedAt,
      localId: null,
      addedAt: params.createdAt,
      thumbForHash: undefined,
      thumbSize: undefined,
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
})

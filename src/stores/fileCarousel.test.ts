import { initializeDB, resetDb } from '../db'
import { createFileRecord } from './files'
import { fetchFileCarouselWindow } from './fileCarousel'

jest.mock('./library', () => {
  const actual = jest.requireActual('./library')
  return {
    ...actual,
    librarySwr: {
      triggerChange: jest.fn(),
      addChangeCallback: jest.fn(),
      getKey: jest.fn((key: string) => key),
    },
  }
})

describe('fetchFileCarouselWindow', () => {
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
    name: string | null
    createdAt: number
    type?: string
  }) {
    await createFileRecord({
      id: params.id,
      name: params.name ?? `${params.id}.jpg`,
      type: params.type ?? 'image/jpeg',
      size: 100,
      hash: `hash-${params.id}`,
      createdAt: params.createdAt,
      updatedAt: params.createdAt,
      localId: null,
      addedAt: params.createdAt,
    })
  }

  async function seedDateRecords() {
    await createRecord({ id: 'file-a', name: 'a.jpg', createdAt: base })
    await createRecord({ id: 'file-b', name: 'b.jpg', createdAt: base + 10 })
    await createRecord({ id: 'file-c', name: 'c.jpg', createdAt: base + 20 })
    await createRecord({ id: 'file-d', name: 'd.jpg', createdAt: base + 30 })
    await createRecord({ id: 'file-e', name: 'e.jpg', createdAt: base + 40 })
  }

  async function seedNameRecords() {
    await createRecord({ id: 'id-3', name: 'a.jpg', createdAt: base })
    await createRecord({ id: 'id-1', name: 'b.jpg', createdAt: base + 10 })
    await createRecord({ id: 'id-5', name: 'c.jpg', createdAt: base + 20 })
    await createRecord({ id: 'id-2', name: 'd.jpg', createdAt: base + 30 })
    await createRecord({ id: 'id-4', name: 'e.jpg', createdAt: base + 40 })
  }

  describe('DATE sorting (DESC)', () => {
    test('returns window centered on anchor with neighbors', async () => {
      await seedDateRecords()

      const result = await fetchFileCarouselWindow({
        initialId: 'file-c',
        neighborsPerSide: 2,
        sortBy: 'DATE',
        sortDir: 'DESC',
        categories: [],
        searchQuery: '',
      })

      expect(result.files.map((f) => f.id)).toEqual([
        'file-e',
        'file-d',
        'file-c',
        'file-b',
        'file-a',
      ])
      expect(result.hasPrevious).toBe(true)
      expect(result.hasNext).toBe(true)
      expect(result.anchorId).toBe('file-c')
    })

    test('returns hasPrevious=false when anchor is at start', async () => {
      await seedDateRecords()

      const result = await fetchFileCarouselWindow({
        initialId: 'file-e',
        neighborsPerSide: 2,
        sortBy: 'DATE',
        sortDir: 'DESC',
        categories: [],
        searchQuery: '',
      })

      expect(result.files.map((f) => f.id)).toEqual([
        'file-e',
        'file-d',
        'file-c',
      ])
      expect(result.hasPrevious).toBe(false)
      expect(result.hasNext).toBe(true)
      expect(result.anchorId).toBe('file-e')
    })

    test('returns hasNext=false when anchor is at end', async () => {
      await seedDateRecords()

      const result = await fetchFileCarouselWindow({
        initialId: 'file-a',
        neighborsPerSide: 2,
        sortBy: 'DATE',
        sortDir: 'DESC',
        categories: [],
        searchQuery: '',
      })

      expect(result.files.map((f) => f.id)).toEqual([
        'file-c',
        'file-b',
        'file-a',
      ])
      expect(result.hasPrevious).toBe(true)
      expect(result.hasNext).toBe(false)
      expect(result.anchorId).toBe('file-a')
    })
  })

  describe('DATE sorting (ASC)', () => {
    test('returns window in ascending order', async () => {
      await seedDateRecords()

      const result = await fetchFileCarouselWindow({
        initialId: 'file-c',
        neighborsPerSide: 2,
        sortBy: 'DATE',
        sortDir: 'ASC',
        categories: [],
        searchQuery: '',
      })

      expect(result.files.map((f) => f.id)).toEqual([
        'file-a',
        'file-b',
        'file-c',
        'file-d',
        'file-e',
      ])
      expect(result.hasPrevious).toBe(true)
      expect(result.hasNext).toBe(true)
    })
  })

  describe('NAME sorting (ASC)', () => {
    test('returns window in alphabetical order', async () => {
      await seedNameRecords()

      const result = await fetchFileCarouselWindow({
        initialId: 'id-5',
        neighborsPerSide: 2,
        sortBy: 'NAME',
        sortDir: 'ASC',
        categories: [],
        searchQuery: '',
      })

      expect(result.files.map((f) => f.id)).toEqual([
        'id-3',
        'id-1',
        'id-5',
        'id-2',
        'id-4',
      ])
      expect(result.hasPrevious).toBe(true)
      expect(result.hasNext).toBe(true)
    })

    test('returns hasPrevious=false at start of alphabetical list', async () => {
      await seedNameRecords()

      const result = await fetchFileCarouselWindow({
        initialId: 'id-3',
        neighborsPerSide: 2,
        sortBy: 'NAME',
        sortDir: 'ASC',
        categories: [],
        searchQuery: '',
      })

      expect(result.files.map((f) => f.id)).toEqual(['id-3', 'id-1', 'id-5'])
      expect(result.hasPrevious).toBe(false)
      expect(result.hasNext).toBe(true)
    })
  })

  describe('NAME sorting (DESC)', () => {
    test('returns window in reverse alphabetical order', async () => {
      await seedNameRecords()

      const result = await fetchFileCarouselWindow({
        initialId: 'id-5',
        neighborsPerSide: 2,
        sortBy: 'NAME',
        sortDir: 'DESC',
        categories: [],
        searchQuery: '',
      })

      expect(result.files.map((f) => f.id)).toEqual([
        'id-4',
        'id-2',
        'id-5',
        'id-1',
        'id-3',
      ])
    })
  })

  describe('tie-breaking by ID', () => {
    test('breaks DATE ties using ID', async () => {
      await createRecord({ id: 'file-c', name: 'c.jpg', createdAt: base })
      await createRecord({ id: 'file-a', name: 'a.jpg', createdAt: base })
      await createRecord({ id: 'file-b', name: 'b.jpg', createdAt: base })

      const result = await fetchFileCarouselWindow({
        initialId: 'file-b',
        neighborsPerSide: 2,
        sortBy: 'DATE',
        sortDir: 'DESC',
        categories: [],
        searchQuery: '',
      })

      expect(result.files.map((f) => f.id)).toEqual([
        'file-c',
        'file-b',
        'file-a',
      ])
    })

    test('breaks NAME ties using ID', async () => {
      await createRecord({ id: 'file-c', name: 'same.jpg', createdAt: base })
      await createRecord({ id: 'file-a', name: 'same.jpg', createdAt: base + 10 })
      await createRecord({ id: 'file-b', name: 'same.jpg', createdAt: base + 20 })

      const result = await fetchFileCarouselWindow({
        initialId: 'file-b',
        neighborsPerSide: 2,
        sortBy: 'NAME',
        sortDir: 'ASC',
        categories: [],
        searchQuery: '',
      })

      expect(result.files.map((f) => f.id)).toEqual([
        'file-a',
        'file-b',
        'file-c',
      ])
    })
  })

  describe('category filtering', () => {
    test('filters by category and returns correct window', async () => {
      await createRecord({
        id: 'img-1',
        name: 'photo1.jpg',
        createdAt: base,
        type: 'image/jpeg',
      })
      await createRecord({
        id: 'vid-1',
        name: 'video1.mp4',
        createdAt: base + 10,
        type: 'video/mp4',
      })
      await createRecord({
        id: 'img-2',
        name: 'photo2.jpg',
        createdAt: base + 20,
        type: 'image/jpeg',
      })
      await createRecord({
        id: 'vid-2',
        name: 'video2.mp4',
        createdAt: base + 30,
        type: 'video/mp4',
      })
      await createRecord({
        id: 'img-3',
        name: 'photo3.jpg',
        createdAt: base + 40,
        type: 'image/jpeg',
      })

      const result = await fetchFileCarouselWindow({
        initialId: 'img-2',
        neighborsPerSide: 2,
        sortBy: 'DATE',
        sortDir: 'DESC',
        categories: ['Image'],
        searchQuery: '',
      })

      expect(result.files.map((f) => f.id)).toEqual(['img-3', 'img-2', 'img-1'])
      expect(result.hasPrevious).toBe(false)
      expect(result.hasNext).toBe(false)
    })
  })

  describe('edge cases', () => {
    test('returns empty result when anchor not found', async () => {
      await seedDateRecords()

      const result = await fetchFileCarouselWindow({
        initialId: 'nonexistent',
        neighborsPerSide: 2,
        sortBy: 'DATE',
        sortDir: 'DESC',
        categories: [],
        searchQuery: '',
      })

      expect(result.files).toEqual([])
      expect(result.hasPrevious).toBe(false)
      expect(result.hasNext).toBe(false)
      expect(result.anchorId).toBeNull()
    })

    test('returns empty when anchor filtered out by category', async () => {
      await createRecord({
        id: 'img-1',
        name: 'photo.jpg',
        createdAt: base,
        type: 'image/jpeg',
      })

      const result = await fetchFileCarouselWindow({
        initialId: 'img-1',
        neighborsPerSide: 2,
        sortBy: 'DATE',
        sortDir: 'DESC',
        categories: ['Video'],
        searchQuery: '',
      })

      expect(result.files).toEqual([])
      expect(result.anchorId).toBeNull()
    })

    test('handles single file', async () => {
      await createRecord({ id: 'only-file', name: 'solo.jpg', createdAt: base })

      const result = await fetchFileCarouselWindow({
        initialId: 'only-file',
        neighborsPerSide: 2,
        sortBy: 'DATE',
        sortDir: 'DESC',
        categories: [],
        searchQuery: '',
      })

      expect(result.files.map((f) => f.id)).toEqual(['only-file'])
      expect(result.hasPrevious).toBe(false)
      expect(result.hasNext).toBe(false)
    })

    test('respects neighborsPerSide of 1', async () => {
      await seedDateRecords()

      const result = await fetchFileCarouselWindow({
        initialId: 'file-c',
        neighborsPerSide: 1,
        sortBy: 'DATE',
        sortDir: 'DESC',
        categories: [],
        searchQuery: '',
      })

      expect(result.files.map((f) => f.id)).toEqual(['file-d', 'file-c', 'file-b'])
      expect(result.hasPrevious).toBe(true)
      expect(result.hasNext).toBe(true)
    })
  })
})

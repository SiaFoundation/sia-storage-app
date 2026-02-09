import { act, renderHook, waitFor } from '@testing-library/react-native'
import { db, initializeDB, resetDb } from '../db'
import {
  fetchFilePosition,
  fetchFilesByIDs,
  fetchSortedFileIds,
  fetchTotalCount,
  useFileCarousel,
} from './fileCarousel'
import { createFileRecord } from './files'
import type { Category } from './library'

const mockChangeCallbacks = new Map<string, () => void>()

jest.mock('./librarySwr', () => ({
  librarySwr: {
    triggerChange: jest.fn(() => {
      mockChangeCallbacks.forEach((callback) => callback())
    }),
    addChangeCallback: jest.fn((key: string, callback: () => void) => {
      mockChangeCallbacks.set(key, callback)
    }),
    removeChangeCallback: jest.fn((key: string) => {
      mockChangeCallbacks.delete(key)
    }),
    getKey: jest.fn((key: string) => key),
  },
}))

jest.mock('./library', () => {
  const actual = jest.requireActual('./library')
  return {
    ...actual,
    useLibrary: () => ({
      sortBy: 'DATE',
      sortDir: 'DESC',
      selectedCategories: new Set(),
      searchQuery: '',
    }),
  }
})

describe('fileCarousel virtual list functions', () => {
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

  const defaultParams = {
    sortBy: 'DATE' as const,
    sortDir: 'DESC' as const,
    categories: [] as Category[],
    searchQuery: '',
  }

  describe('fetchTotalCount', () => {
    test('returns correct count with no filters', async () => {
      await seedDateRecords()
      const count = await fetchTotalCount(defaultParams)
      expect(count).toBe(5)
    })

    test('returns 0 for empty database', async () => {
      const count = await fetchTotalCount(defaultParams)
      expect(count).toBe(0)
    })

    test('filters by category', async () => {
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

      const imageCount = await fetchTotalCount({
        ...defaultParams,
        categories: ['Image'],
      })
      expect(imageCount).toBe(2)

      const videoCount = await fetchTotalCount({
        ...defaultParams,
        categories: ['Video'],
      })
      expect(videoCount).toBe(1)
    })
  })

  describe('fetchFilePosition', () => {
    describe('DATE sorting (DESC)', () => {
      test('returns correct position for middle file', async () => {
        await seedDateRecords()
        // DESC order: file-e(0), file-d(1), file-c(2), file-b(3), file-a(4)
        const position = await fetchFilePosition('file-c', defaultParams)
        expect(position).toBe(2)
      })

      test('returns 0 for first file', async () => {
        await seedDateRecords()
        const position = await fetchFilePosition('file-e', defaultParams)
        expect(position).toBe(0)
      })

      test('returns last position for last file', async () => {
        await seedDateRecords()
        const position = await fetchFilePosition('file-a', defaultParams)
        expect(position).toBe(4)
      })

      test('returns 0 for nonexistent file', async () => {
        await seedDateRecords()
        const position = await fetchFilePosition('nonexistent', defaultParams)
        expect(position).toBe(0)
      })
    })

    describe('DATE sorting (ASC)', () => {
      test('returns correct position in ascending order', async () => {
        await seedDateRecords()
        // ASC order: file-a(0), file-b(1), file-c(2), file-d(3), file-e(4)
        const position = await fetchFilePosition('file-c', {
          ...defaultParams,
          sortDir: 'ASC',
        })
        expect(position).toBe(2)
      })

      test('returns 0 for first file in ASC', async () => {
        await seedDateRecords()
        const position = await fetchFilePosition('file-a', {
          ...defaultParams,
          sortDir: 'ASC',
        })
        expect(position).toBe(0)
      })
    })

    describe('NAME sorting (ASC)', () => {
      test('returns correct position in alphabetical order', async () => {
        await seedNameRecords()
        // NAME ASC order: a.jpg(id-3), b.jpg(id-1), c.jpg(id-5), d.jpg(id-2), e.jpg(id-4)
        const position = await fetchFilePosition('id-5', {
          ...defaultParams,
          sortBy: 'NAME',
          sortDir: 'ASC',
        })
        expect(position).toBe(2)
      })

      test('returns 0 for first alphabetical file', async () => {
        await seedNameRecords()
        const position = await fetchFilePosition('id-3', {
          ...defaultParams,
          sortBy: 'NAME',
          sortDir: 'ASC',
        })
        expect(position).toBe(0)
      })
    })

    describe('NAME sorting (DESC)', () => {
      test('returns correct position in reverse alphabetical order', async () => {
        await seedNameRecords()
        // NAME DESC order: e.jpg(id-4), d.jpg(id-2), c.jpg(id-5), b.jpg(id-1), a.jpg(id-3)
        const position = await fetchFilePosition('id-5', {
          ...defaultParams,
          sortBy: 'NAME',
          sortDir: 'DESC',
        })
        expect(position).toBe(2)
      })
    })

    describe('tie-breaking by ID', () => {
      test('breaks DATE ties using ID', async () => {
        await createRecord({ id: 'file-c', name: 'c.jpg', createdAt: base })
        await createRecord({ id: 'file-a', name: 'a.jpg', createdAt: base })
        await createRecord({ id: 'file-b', name: 'b.jpg', createdAt: base })

        // DESC with same date, order by ID DESC: file-c(0), file-b(1), file-a(2)
        const positionC = await fetchFilePosition('file-c', defaultParams)
        const positionB = await fetchFilePosition('file-b', defaultParams)
        const positionA = await fetchFilePosition('file-a', defaultParams)

        expect(positionC).toBe(0)
        expect(positionB).toBe(1)
        expect(positionA).toBe(2)
      })

      test('breaks NAME ties using ID', async () => {
        await createRecord({ id: 'file-c', name: 'same.jpg', createdAt: base })
        await createRecord({
          id: 'file-a',
          name: 'same.jpg',
          createdAt: base + 10,
        })
        await createRecord({
          id: 'file-b',
          name: 'same.jpg',
          createdAt: base + 20,
        })

        // NAME ASC with same name, order by ID ASC: file-a(0), file-b(1), file-c(2)
        const params = {
          ...defaultParams,
          sortBy: 'NAME' as const,
          sortDir: 'ASC' as const,
        }
        const positionA = await fetchFilePosition('file-a', params)
        const positionB = await fetchFilePosition('file-b', params)
        const positionC = await fetchFilePosition('file-c', params)

        expect(positionA).toBe(0)
        expect(positionB).toBe(1)
        expect(positionC).toBe(2)
      })
    })

    describe('category filtering', () => {
      test('returns correct position with category filter', async () => {
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

        // Images only DESC: img-3(0), img-2(1), img-1(2)
        const position = await fetchFilePosition('img-2', {
          ...defaultParams,
          categories: ['Image'],
        })
        expect(position).toBe(1)
      })

      test('returns 0 when file filtered out by category', async () => {
        await createRecord({
          id: 'img-1',
          name: 'photo.jpg',
          createdAt: base,
          type: 'image/jpeg',
        })

        const position = await fetchFilePosition('img-1', {
          ...defaultParams,
          categories: ['Video'],
        })
        expect(position).toBe(0)
      })
    })
  })

  describe('fetchSortedFileIds', () => {
    test('returns IDs in sort order', async () => {
      await seedDateRecords()
      // DESC order: file-e, file-d, file-c, file-b, file-a
      const ids = await fetchSortedFileIds(defaultParams, 5, 0)
      expect(ids).toEqual(['file-e', 'file-d', 'file-c', 'file-b', 'file-a'])
    })

    test('respects limit and offset', async () => {
      await seedDateRecords()
      const ids = await fetchSortedFileIds(defaultParams, 2, 1)
      expect(ids).toEqual(['file-d', 'file-c'])
    })

    test('returns empty array for empty database', async () => {
      const ids = await fetchSortedFileIds(defaultParams, 10, 0)
      expect(ids).toEqual([])
    })
  })

  describe('fetchFilesByIDs', () => {
    test('returns files keyed by ID', async () => {
      await seedDateRecords()
      const files = await fetchFilesByIDs(['file-a', 'file-c', 'file-e'])
      expect(files.size).toBe(3)
      expect(files.get('file-a')?.name).toBe('a.jpg')
      expect(files.get('file-c')?.name).toBe('c.jpg')
      expect(files.get('file-e')?.name).toBe('e.jpg')
    })

    test('returns empty map for empty ID list', async () => {
      const files = await fetchFilesByIDs([])
      expect(files.size).toBe(0)
    })

    test('skips nonexistent IDs', async () => {
      await seedDateRecords()
      const files = await fetchFilesByIDs(['file-a', 'nonexistent'])
      expect(files.size).toBe(1)
      expect(files.get('file-a')?.id).toBe('file-a')
    })
  })

  describe('edge cases', () => {
    test('handles single file', async () => {
      await createRecord({ id: 'only-file', name: 'solo.jpg', createdAt: base })

      const count = await fetchTotalCount(defaultParams)
      const position = await fetchFilePosition('only-file', defaultParams)
      const files = await fetchFilesByIDs(['only-file'])

      expect(count).toBe(1)
      expect(position).toBe(0)
      expect(files.get('only-file')?.id).toBe('only-file')
    })

    test('handles files with null names', async () => {
      await createRecord({ id: 'file-null', name: null, createdAt: base })
      await createRecord({
        id: 'file-named',
        name: 'named.jpg',
        createdAt: base + 10,
      })

      const count = await fetchTotalCount({
        ...defaultParams,
        sortBy: 'NAME',
        sortDir: 'ASC',
      })
      expect(count).toBe(2)

      const files = await fetchFilesByIDs(['file-null', 'file-named'])
      expect(files.size).toBe(2)
    })
  })
})

describe('useFileCarousel hook', () => {
  const base = 2_000

  beforeEach(async () => {
    await initializeDB()
    mockChangeCallbacks.clear()
  })

  afterEach(async () => {
    await resetDb()
    jest.clearAllMocks()
    mockChangeCallbacks.clear()
  })

  async function createRecord(params: {
    id: string
    name: string
    createdAt: number
  }) {
    await createFileRecord({
      id: params.id,
      name: params.name,
      type: 'image/jpeg',
      size: 100,
      hash: `hash-${params.id}`,
      createdAt: params.createdAt,
      updatedAt: params.createdAt,
      localId: null,
      addedAt: params.createdAt,
    })
  }

  async function deleteRecord(id: string) {
    await db().runAsync('DELETE FROM files WHERE id = ?', id)
  }

  function triggerSyncChange() {
    mockChangeCallbacks.forEach((callback) => callback())
  }

  describe('sync event handling', () => {
    test('calls onDeleted when current file is deleted', async () => {
      await createRecord({ id: 'file-1', name: 'a.jpg', createdAt: base })
      await createRecord({ id: 'file-2', name: 'b.jpg', createdAt: base + 10 })

      const onDeleted = jest.fn()
      const { result } = renderHook(() =>
        useFileCarousel({
          initialId: 'file-2',
          onDeleted,
        }),
      )

      // Wait for hook to initialize
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.currentFile?.id).toBe('file-2')

      // Delete the current file and trigger sync
      await deleteRecord('file-2')
      await act(async () => {
        triggerSyncChange()
        // Give the async handler time to run
        await new Promise((r) => setTimeout(r, 50))
      })

      expect(onDeleted).toHaveBeenCalled()
    })

    test('keeps frozen position when other files are deleted', async () => {
      await createRecord({ id: 'file-1', name: 'a.jpg', createdAt: base })
      await createRecord({ id: 'file-2', name: 'b.jpg', createdAt: base + 10 })
      await createRecord({ id: 'file-3', name: 'c.jpg', createdAt: base + 20 })

      const { result } = renderHook(() =>
        useFileCarousel({
          initialId: 'file-2',
        }),
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // file-2 is at position 1 (DESC: file-3, file-2, file-1)
      expect(result.current.totalCount).toBe(3)
      expect(result.current.currentIndex).toBe(1)
      expect(result.current.currentFile?.id).toBe('file-2')

      // Delete file-3 — position map is frozen, so index stays at 1
      await deleteRecord('file-3')
      await act(async () => {
        triggerSyncChange()
        await new Promise((r) => setTimeout(r, 50))
      })

      // Position and count stay frozen
      expect(result.current.currentIndex).toBe(1)
      expect(result.current.totalCount).toBe(3)
      expect(result.current.currentFile).not.toBeNull()
      expect(result.current.currentFile?.id).toBe('file-2')
    })

    test('currentFile ID never changes during sync storm', async () => {
      await createRecord({ id: 'file-1', name: 'a.jpg', createdAt: base })
      await createRecord({ id: 'file-2', name: 'b.jpg', createdAt: base + 10 })
      await createRecord({ id: 'file-3', name: 'c.jpg', createdAt: base + 20 })

      const renders: {
        currentFile: { id: string } | null
        isLoading: boolean
      }[] = []
      const { result } = renderHook(() => {
        const hook = useFileCarousel({ initialId: 'file-2' })
        renders.push({
          currentFile: hook.currentFile ? { id: hook.currentFile.id } : null,
          isLoading: hook.isLoading,
        })
        return hook
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      const initDoneIndex = renders.findIndex((r) => !r.isLoading)
      expect(initDoneIndex).toBeGreaterThanOrEqual(0)

      // Add DB delays to simulate real async behavior
      const database = db()
      const origFirst = database.getFirstAsync.bind(database)
      const origAll = database.getAllAsync.bind(database)
      jest
        .spyOn(database, 'getFirstAsync')
        .mockImplementation(async (...args: Parameters<typeof origFirst>) => {
          await new Promise((r) => setTimeout(r, 5))
          return origFirst(...args)
        })
      jest
        .spyOn(database, 'getAllAsync')
        .mockImplementation(async (...args: Parameters<typeof origAll>) => {
          await new Promise((r) => setTimeout(r, 5))
          return origAll(...args)
        })

      // Simulate a sync storm: add files one at a time, firing sync after each
      for (let i = 4; i <= 10; i++) {
        await createRecord({
          id: `file-${i}`,
          name: `${String.fromCharCode(96 + i)}.jpg`,
          createdAt: base + i * 10,
        })
        await act(async () => {
          triggerSyncChange()
          await new Promise((r) => setTimeout(r, 30))
        })
      }

      // Wait for everything to settle
      await act(async () => {
        await new Promise((r) => setTimeout(r, 200))
      })

      // Every render after init completed must have currentFile non-null
      // and always showing the same file ID (frozen positions)
      const postInitRenders = renders.slice(initDoneIndex)
      const nullRenders = postInitRenders.filter((r) => r.currentFile === null)
      expect(nullRenders).toEqual([])

      const wrongFileRenders = postInitRenders.filter(
        (r) => r.currentFile?.id !== 'file-2',
      )
      expect(wrongFileRenders).toEqual([])

      // Position and count stay frozen at init values
      expect(result.current.currentFile?.id).toBe('file-2')
      expect(result.current.currentIndex).toBe(1)
      expect(result.current.totalCount).toBe(3)

      jest.restoreAllMocks()
    })

    test('preserves current file when rapid sync events interleave', async () => {
      await createRecord({ id: 'file-1', name: 'a.jpg', createdAt: base })
      await createRecord({ id: 'file-2', name: 'b.jpg', createdAt: base + 10 })
      await createRecord({ id: 'file-3', name: 'c.jpg', createdAt: base + 20 })

      const { result } = renderHook(() =>
        useFileCarousel({
          initialId: 'file-2',
        }),
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.currentIndex).toBe(1)
      expect(result.current.currentFile?.id).toBe('file-2')

      // Add async delays to DB methods to simulate real expo-sqlite behavior.
      const database = db()
      const origFirst = database.getFirstAsync.bind(database)
      const origAll = database.getAllAsync.bind(database)
      jest
        .spyOn(database, 'getFirstAsync')
        .mockImplementation(async (...args: Parameters<typeof origFirst>) => {
          await new Promise((r) => setTimeout(r, 5))
          return origFirst(...args)
        })
      jest
        .spyOn(database, 'getAllAsync')
        .mockImplementation(async (...args: Parameters<typeof origAll>) => {
          await new Promise((r) => setTimeout(r, 5))
          return origAll(...args)
        })

      // Add two files that would shift file-2's position in DB, then fire
      // two sync events. With frozen positions, nothing should change.
      await createRecord({ id: 'file-4', name: 'd.jpg', createdAt: base + 30 })
      await createRecord({ id: 'file-5', name: 'e.jpg', createdAt: base + 40 })
      await act(async () => {
        triggerSyncChange()
        triggerSyncChange()
        await new Promise((r) => setTimeout(r, 200))
      })

      // Position and count stay frozen
      expect(result.current.currentIndex).toBe(1)
      expect(result.current.totalCount).toBe(3)
      expect(result.current.currentFile).not.toBeNull()
      expect(result.current.currentFile?.id).toBe('file-2')

      jest.restoreAllMocks()
    })
  })

  describe('cache duplicate bug - opening file at position N', () => {
    test('opening 3rd file and navigating back shows unique files', async () => {
      // DESC order: file-6(0), file-5(1), file-4(2), file-3(3), file-2(4), file-1(5)
      await createRecord({ id: 'file-1', name: 'a.jpg', createdAt: base })
      await createRecord({ id: 'file-2', name: 'b.jpg', createdAt: base + 10 })
      await createRecord({ id: 'file-3', name: 'c.jpg', createdAt: base + 20 })
      await createRecord({ id: 'file-4', name: 'd.jpg', createdAt: base + 30 })
      await createRecord({ id: 'file-5', name: 'e.jpg', createdAt: base + 40 })
      await createRecord({ id: 'file-6', name: 'f.jpg', createdAt: base + 50 })

      const initialFile = {
        id: 'file-3',
        name: 'c.jpg',
        type: 'image/jpeg',
        size: 100,
        hash: 'hash-file-3',
        createdAt: base + 20,
        updatedAt: base + 20,
        localId: null,
        addedAt: base + 20,
        thumbForHash: undefined,
        thumbSize: undefined,
        objects: {},
        objectsHash: '',
      }

      // file-3 is at position 3, prefetchRadius: 1 means positions 2-4 are fetched
      const { result } = renderHook(() =>
        useFileCarousel({
          initialId: 'file-3',
          initialFile,
          prefetchRadius: 1,
        }),
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
        expect(result.current.currentIndex).toBe(3)
      })

      expect(result.current.currentFile?.id).toBe('file-3')
      expect(result.current.totalCount).toBe(6)

      // Position 0 should not have a cached file (not in prefetch range)
      const file0 = result.current.getFileAtIndex(0)
      expect(file0).toBeNull()
    })

    test('opening 5th file shows unique files across all positions', async () => {
      await createRecord({ id: 'file-1', name: 'a.jpg', createdAt: base })
      await createRecord({ id: 'file-2', name: 'b.jpg', createdAt: base + 10 })
      await createRecord({ id: 'file-3', name: 'c.jpg', createdAt: base + 20 })
      await createRecord({ id: 'file-4', name: 'd.jpg', createdAt: base + 30 })
      await createRecord({ id: 'file-5', name: 'e.jpg', createdAt: base + 40 })
      await createRecord({ id: 'file-6', name: 'f.jpg', createdAt: base + 50 })

      // User taps on file-2 (which is at position 4 in DESC order)
      const { result } = renderHook(() =>
        useFileCarousel({
          initialId: 'file-2',
          prefetchRadius: 5,
        }),
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.currentIndex).toBe(4)

      // Get all files
      const files = []
      for (let i = 0; i < 6; i++) {
        files.push(result.current.getFileAtIndex(i))
      }

      // All 6 positions should have unique files
      const ids = files.map((f) => f?.id).filter(Boolean)
      expect(new Set(ids).size).toBe(6)

      // Verify correct order (DESC by createdAt)
      expect(files[0]?.id).toBe('file-6')
      expect(files[1]?.id).toBe('file-5')
      expect(files[2]?.id).toBe('file-4')
      expect(files[3]?.id).toBe('file-3')
      expect(files[4]?.id).toBe('file-2')
      expect(files[5]?.id).toBe('file-1')
    })

    test('opening first file (position 0) keeps file at index 0', async () => {
      await createRecord({ id: 'file-1', name: 'a.jpg', createdAt: base })
      await createRecord({ id: 'file-2', name: 'b.jpg', createdAt: base + 10 })
      await createRecord({ id: 'file-3', name: 'c.jpg', createdAt: base + 20 })

      // User taps on file-3 (which is at position 0 in DESC order)
      const { result } = renderHook(() =>
        useFileCarousel({
          initialId: 'file-3',
          prefetchRadius: 2,
        }),
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.currentIndex).toBe(0)
      expect(result.current.getFileAtIndex(0)?.id).toBe('file-3')
      expect(result.current.getFileAtIndex(1)?.id).toBe('file-2')
      expect(result.current.getFileAtIndex(2)?.id).toBe('file-1')
    })
  })
})

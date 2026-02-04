import { act, renderHook, waitFor } from '@testing-library/react-native'
import { db, initializeDB, resetDb } from '../db'
import {
  fetchFilePosition,
  fetchFilesAtIndices,
  fetchTotalCount,
  useVirtualFileList,
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

  describe('fetchFilesAtIndices', () => {
    test('fetches files at specified indices', async () => {
      await seedDateRecords()
      // DESC order: file-e(0), file-d(1), file-c(2), file-b(3), file-a(4)

      const files = await fetchFilesAtIndices([0, 2, 4], defaultParams)

      expect(files.size).toBe(3)
      expect(files.get(0)?.id).toBe('file-e')
      expect(files.get(2)?.id).toBe('file-c')
      expect(files.get(4)?.id).toBe('file-a')
    })

    test('returns empty map for empty indices array', async () => {
      await seedDateRecords()
      const files = await fetchFilesAtIndices([], defaultParams)
      expect(files.size).toBe(0)
    })

    test('skips out-of-bounds indices', async () => {
      await seedDateRecords()
      const files = await fetchFilesAtIndices([0, 10, 100], defaultParams)
      expect(files.size).toBe(1)
      expect(files.get(0)?.id).toBe('file-e')
    })

    test('fetches contiguous range', async () => {
      await seedDateRecords()
      const files = await fetchFilesAtIndices([1, 2, 3], defaultParams)

      expect(files.size).toBe(3)
      expect(files.get(1)?.id).toBe('file-d')
      expect(files.get(2)?.id).toBe('file-c')
      expect(files.get(3)?.id).toBe('file-b')
    })

    test('respects category filter', async () => {
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

      const files = await fetchFilesAtIndices([0, 1], {
        ...defaultParams,
        categories: ['Image'],
      })

      // Images only DESC: img-2(0), img-1(1)
      expect(files.size).toBe(2)
      expect(files.get(0)?.id).toBe('img-2')
      expect(files.get(1)?.id).toBe('img-1')
    })

    test('respects sort order', async () => {
      await seedDateRecords()

      const ascFiles = await fetchFilesAtIndices([0, 1, 2], {
        ...defaultParams,
        sortDir: 'ASC',
      })

      // ASC order: file-a(0), file-b(1), file-c(2)
      expect(ascFiles.get(0)?.id).toBe('file-a')
      expect(ascFiles.get(1)?.id).toBe('file-b')
      expect(ascFiles.get(2)?.id).toBe('file-c')
    })
  })

  describe('edge cases', () => {
    test('handles single file', async () => {
      await createRecord({ id: 'only-file', name: 'solo.jpg', createdAt: base })

      const count = await fetchTotalCount(defaultParams)
      const position = await fetchFilePosition('only-file', defaultParams)
      const files = await fetchFilesAtIndices([0], defaultParams)

      expect(count).toBe(1)
      expect(position).toBe(0)
      expect(files.get(0)?.id).toBe('only-file')
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

      // NAME ASC: null names sort first (or last depending on impl), then alphabetical
      const files = await fetchFilesAtIndices([0, 1], {
        ...defaultParams,
        sortBy: 'NAME',
        sortDir: 'ASC',
      })
      expect(files.size).toBe(2)
    })
  })
})

describe('useVirtualFileList hook', () => {
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

  async function updateRecord(
    id: string,
    updates: { name?: string; updatedAt?: number },
  ) {
    const setClauses: string[] = []
    const params: (string | number)[] = []
    if (updates.name !== undefined) {
      setClauses.push('name = ?')
      params.push(updates.name)
    }
    if (updates.updatedAt !== undefined) {
      setClauses.push('updatedAt = ?')
      params.push(updates.updatedAt)
    }
    params.push(id)
    await db().runAsync(
      `UPDATE files SET ${setClauses.join(', ')} WHERE id = ?`,
      ...params,
    )
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
        useVirtualFileList({
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

    test('calls onUpdated when file metadata changes', async () => {
      await createRecord({
        id: 'file-1',
        name: 'original.jpg',
        createdAt: base,
      })

      const onUpdated = jest.fn()
      const { result } = renderHook(() =>
        useVirtualFileList({
          initialId: 'file-1',
          onUpdated,
        }),
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.currentFile?.name).toBe('original.jpg')

      // Update the file's name and trigger sync
      await updateRecord('file-1', {
        name: 'renamed.jpg',
        updatedAt: base + 100,
      })
      await act(async () => {
        triggerSyncChange()
        await new Promise((r) => setTimeout(r, 50))
      })

      expect(onUpdated).toHaveBeenCalledWith('File renamed')
    })

    test('updates position when total count changes', async () => {
      await createRecord({ id: 'file-1', name: 'a.jpg', createdAt: base })
      await createRecord({ id: 'file-2', name: 'b.jpg', createdAt: base + 10 })
      await createRecord({ id: 'file-3', name: 'c.jpg', createdAt: base + 20 })

      const { result } = renderHook(() =>
        useVirtualFileList({
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

      // Delete file-3 (the one before file-2), so file-2 moves to position 0
      await deleteRecord('file-3')
      await act(async () => {
        triggerSyncChange()
        await new Promise((r) => setTimeout(r, 50))
      })

      await waitFor(() => {
        expect(result.current.totalCount).toBe(2)
      })
      expect(result.current.currentIndex).toBe(0)
      // Current file should remain available (not null) after position change
      expect(result.current.currentFile).not.toBeNull()
      expect(result.current.currentFile?.id).toBe('file-2')
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
        useVirtualFileList({
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
        useVirtualFileList({
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
        useVirtualFileList({
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

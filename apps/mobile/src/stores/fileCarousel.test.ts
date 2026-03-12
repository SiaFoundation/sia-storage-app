import { act, renderHook, waitFor } from '@testing-library/react-native'
import { database, db, initializeDB, resetDb } from '../db'
import { fetchFilesByIDs, useFileCarousel } from './fileCarousel'
import { createFileRecord } from './files'

import { invalidateCacheLibraryLists } from './librarySwr'

describe('fetchFilesByIDs', () => {
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
    name: string
    createdAt: number
  }) {
    await createFileRecord({
      id: params.id,
      name: params.name,
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: `hash-${params.id}`,
      createdAt: params.createdAt,
      updatedAt: params.createdAt,
      localId: null,
      addedAt: params.createdAt,
      trashedAt: null,
      deletedAt: null,
    })
  }

  test('returns files keyed by ID', async () => {
    await createRecord({ id: 'file-a', name: 'a.jpg', createdAt: base })
    await createRecord({ id: 'file-c', name: 'c.jpg', createdAt: base + 20 })
    await createRecord({ id: 'file-e', name: 'e.jpg', createdAt: base + 40 })
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
    await createRecord({ id: 'file-a', name: 'a.jpg', createdAt: base })
    const files = await fetchFilesByIDs(['file-a', 'nonexistent'])
    expect(files.size).toBe(1)
    expect(files.get('file-a')?.id).toBe('file-a')
  })
})

describe('useFileCarousel hook', () => {
  const base = 2_000

  beforeEach(async () => {
    await initializeDB()
  })

  afterEach(async () => {
    await resetDb()
    jest.clearAllMocks()
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
      kind: 'file',
      size: 100,
      hash: `hash-${params.id}`,
      createdAt: params.createdAt,
      updatedAt: params.createdAt,
      localId: null,
      addedAt: params.createdAt,
      trashedAt: null,
      deletedAt: null,
    })
  }

  async function deleteRecord(id: string) {
    await db().runAsync('DELETE FROM files WHERE id = ?', id)
  }

  function triggerSyncChange() {
    invalidateCacheLibraryLists()
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
        await new Promise((r) => setTimeout(r, 300))
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
        await new Promise((r) => setTimeout(r, 300))
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
        await act(async () => {
          await createRecord({
            id: `file-${i}`,
            name: `${String.fromCharCode(96 + i)}.jpg`,
            createdAt: base + i * 10,
          })
          triggerSyncChange()
          await new Promise((r) => setTimeout(r, 30))
        })
      }

      // Wait for everything to settle (including 200ms debounce on invalidation)
      await act(async () => {
        await new Promise((r) => setTimeout(r, 500))
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
      await act(async () => {
        await createRecord({
          id: 'file-4',
          name: 'd.jpg',
          createdAt: base + 30,
        })
        await createRecord({
          id: 'file-5',
          name: 'e.jpg',
          createdAt: base + 40,
        })
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
        kind: 'file' as const,
        size: 100,
        hash: 'hash-file-3',
        createdAt: base + 20,
        updatedAt: base + 20,
        localId: null,
        addedAt: base + 20,
        thumbForId: undefined,
        thumbSize: undefined,
        trashedAt: null,
        deletedAt: null,
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

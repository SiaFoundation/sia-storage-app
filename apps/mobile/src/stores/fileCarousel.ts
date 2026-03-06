import type { Category, SortBy, SortDir } from '@siastorage/core/db/operations'
import * as ops from '@siastorage/core/db/operations'
import type { FileRecord } from '@siastorage/core/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { db } from '../db'
import { useOnLibraryListChange } from './librarySwr'

type VirtualListQueryParams = {
  sortBy: SortBy
  sortDir: SortDir
  categories: Category[]
  directoryId?: string
  tags?: string[]
  query?: string
}

export async function fetchTotalCount(
  params: VirtualListQueryParams,
): Promise<number> {
  return ops.queryFileCountWithFilters(db(), params)
}

export async function fetchFilePosition(
  fileId: string,
  params: VirtualListQueryParams,
): Promise<number> {
  return ops.queryFilePositionInSortedList(db(), fileId, params)
}

export async function fetchSortedFileIds(
  params: VirtualListQueryParams,
  limit: number,
  offset: number,
): Promise<string[]> {
  return ops.querySortedFileIds(db(), params, limit, offset)
}

export async function fetchFilesByIDs(
  ids: string[],
): Promise<Map<string, FileRecord>> {
  const result = new Map<string, FileRecord>()
  if (ids.length === 0) return result

  const files = await ops.readFileRecordsByIds(db(), ids)
  for (const file of files) {
    result.set(file.id, file)
  }
  return result
}

type UseFileCarouselParams = {
  initialId: string
  initialFile?: FileRecord
  sortBy?: SortBy
  sortDir?: SortDir
  categories?: Category[]
  directoryId?: string
  tags?: string[]
  query?: string
  prefetchRadius?: number
  maxCacheSize?: number
  onDeleted?: () => void
}

type UseFileCarouselReturn = {
  totalCount: number
  currentIndex: number
  currentFile: FileRecord | null
  getFileAtIndex: (index: number) => FileRecord | null
  setCurrentIndex: (index: number) => void
  isLoading: boolean
}

function windowIndices(
  center: number,
  count: number,
  radius: number,
): number[] {
  const indices: number[] = []
  for (
    let i = Math.max(0, center - radius);
    i <= Math.min(count - 1, center + radius);
    i++
  ) {
    indices.push(i)
  }
  return indices
}

const ID_WINDOW_SIZE = 201
const ID_WINDOW_HALF = Math.floor(ID_WINDOW_SIZE / 2)

/**
 * Hook for file browsing in the carousel.
 *
 * Uses a frozen ID window to prevent flickering and position shifts during sync:
 * 1. At open time, captures ~201 sorted file IDs centered on the opened file.
 * 2. Index→ID mappings are immutable for the session (append-only, never cleared).
 * 3. Sync only monitors the current file for deletion.
 * 4. File cache preserves references when data is identical (updatedAt + object count).
 */
export function useFileCarousel({
  initialId,
  initialFile,
  sortBy: sortByParam = 'DATE',
  sortDir: sortDirParam,
  categories: categoriesParam = [],
  directoryId,
  tags,
  query,
  prefetchRadius = 3,
  maxCacheSize = 50,
  onDeleted,
}: UseFileCarouselParams): UseFileCarouselReturn {
  const sortBy = sortByParam
  const sortingDir: SortDir =
    sortDirParam ?? (sortBy === 'NAME' ? 'ASC' : 'DESC')

  const [currentIndex, _setCurrentIndex] = useState(0)
  const [totalCount, setTotalCount] = useState(initialFile ? 1 : 0)
  const [isLoading, setIsLoading] = useState(!initialFile)
  const [cacheVersion, setCacheVersion] = useState(0)

  // File data keyed by ID — persists across position changes
  const fileCacheRef = useRef<Map<string, FileRecord>>(
    initialFile ? new Map([[initialFile.id, initialFile]]) : new Map(),
  )

  // Index → file ID mapping — frozen at open time, append-only
  const positionMapRef = useRef<Map<number, string>>(
    initialFile ? new Map([[0, initialFile.id]]) : new Map(),
  )

  const currentFileIdRef = useRef(initialId)
  const initialFileRef = useRef(initialFile)

  const categoriesKey = useMemo(
    () => categoriesParam.slice().sort().join(','),
    [categoriesParam],
  )

  const tagsKey = useMemo(
    () => (tags ? tags.slice().sort().join(',') : ''),
    [tags],
  )

  const queryParams = useMemo<VirtualListQueryParams>(
    () => ({
      sortBy,
      sortDir: sortingDir,
      categories: categoriesKey ? (categoriesKey.split(',') as Category[]) : [],
      directoryId,
      tags: tagsKey ? tagsKey.split(',') : undefined,
      query,
    }),
    [sortBy, sortingDir, categoriesKey, directoryId, tagsKey, query],
  )

  const populateCaches = useCallback(
    (indexToFile: Map<number, FileRecord>): boolean => {
      let changed = false
      indexToFile.forEach((file, index) => {
        positionMapRef.current.set(index, file.id)
        const existing = fileCacheRef.current.get(file.id)
        if (
          existing &&
          existing.updatedAt === file.updatedAt &&
          Object.keys(existing.objects).length ===
            Object.keys(file.objects).length
        ) {
          return
        }
        fileCacheRef.current.set(file.id, file)
        changed = true
      })
      return changed
    },
    [],
  )

  const evictDistant = useCallback(
    (centerIndex: number) => {
      if (fileCacheRef.current.size <= maxCacheSize) return

      const posEntries = Array.from(positionMapRef.current.entries())
      posEntries.sort(
        (a, b) => Math.abs(a[0] - centerIndex) - Math.abs(b[0] - centerIndex),
      )
      const keepIds = new Set(
        posEntries.slice(0, maxCacheSize).map(([, id]) => id),
      )
      keepIds.add(currentFileIdRef.current)
      for (const id of [...fileCacheRef.current.keys()]) {
        if (!keepIds.has(id)) {
          fileCacheRef.current.delete(id)
        }
      }
    },
    [maxCacheSize],
  )

  // Initialize: capture frozen ID window centered on the opened file
  useEffect(() => {
    let cancelled = false

    async function init() {
      if (!initialFileRef.current) {
        setIsLoading(true)
      }

      try {
        const position = await fetchFilePosition(initialId, queryParams)
        if (cancelled) return

        const windowOffset = Math.max(0, position - ID_WINDOW_HALF)
        const ids = await fetchSortedFileIds(
          queryParams,
          ID_WINDOW_SIZE,
          windowOffset,
        )

        if (cancelled) return

        const relativePosition = position - windowOffset

        for (let i = 0; i < ids.length; i++) {
          positionMapRef.current.set(i, ids[i])
        }

        // When initialFile is provided, skip fetching visible files here.
        // The prefetch effect runs immediately after and handles it.
        if (!initialFileRef.current) {
          const visibleIndices = windowIndices(
            relativePosition,
            ids.length,
            prefetchRadius,
          )
          const visibleIds = visibleIndices
            .map((i) => positionMapRef.current.get(i))
            .filter((id): id is string => !!id && !fileCacheRef.current.has(id))

          if (visibleIds.length > 0) {
            const fileMap = await fetchFilesByIDs(visibleIds)
            if (cancelled) return
            const indexToFile = new Map<number, FileRecord>()
            for (const i of visibleIndices) {
              const id = positionMapRef.current.get(i)
              if (id) {
                const file = fileMap.get(id)
                if (file) indexToFile.set(i, file)
              }
            }
            populateCaches(indexToFile)
          }
        }

        currentFileIdRef.current = initialId
        setTotalCount(ids.length)
        _setCurrentIndex(relativePosition)
        setCacheVersion((v) => v + 1)
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    init()

    return () => {
      cancelled = true
    }
  }, [initialId, queryParams, prefetchRadius, populateCaches])

  // Prefetch: as the user swipes, fetch nearby files by ID
  useEffect(() => {
    if (isLoading || totalCount === 0) return

    let cancelled = false

    async function prefetch() {
      const indices = windowIndices(currentIndex, totalCount, prefetchRadius)
      const idsToFetch = indices
        .map((i) => positionMapRef.current.get(i))
        .filter((id): id is string => !!id && !fileCacheRef.current.has(id))

      if (idsToFetch.length === 0) return

      const fileMap = await fetchFilesByIDs(idsToFetch)

      if (cancelled) return

      const indexToFile = new Map<number, FileRecord>()
      for (const i of indices) {
        const id = positionMapRef.current.get(i)
        if (id) {
          const file = fileMap.get(id)
          if (file) indexToFile.set(i, file)
        }
      }

      const changed = populateCaches(indexToFile)
      evictDistant(currentIndex)
      if (changed) {
        setCacheVersion((v) => v + 1)
      }
    }

    prefetch()

    return () => {
      cancelled = true
    }
  }, [
    currentIndex,
    totalCount,
    isLoading,
    prefetchRadius,
    evictDistant,
    populateCaches,
  ])

  useOnLibraryListChange(() => {
    if (isLoading) return
    const currentFileID = currentFileIdRef.current
    if (!currentFileID) return

    ops
      .queryFileExists(db(), currentFileID)
      .then((exists) => {
        if (!exists) {
          onDeleted?.()
        }
      })
      .catch(() => {})
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: cacheVersion forces new function reference when caches update
  const getFileAtIndex = useCallback(
    (index: number): FileRecord | null => {
      const fileId = positionMapRef.current.get(index)
      if (!fileId) return null
      return fileCacheRef.current.get(fileId) ?? null
    },
    [cacheVersion],
  )

  const setCurrentIndex = useCallback(
    (index: number) => {
      if (index >= 0 && index < totalCount) {
        _setCurrentIndex(index)
        const fileId = positionMapRef.current.get(index)
        if (fileId) currentFileIdRef.current = fileId
      }
    },
    [totalCount],
  )

  const currentFile = getFileAtIndex(currentIndex)

  return {
    totalCount,
    currentIndex,
    currentFile,
    getFileAtIndex,
    setCurrentIndex,
    isLoading,
  }
}

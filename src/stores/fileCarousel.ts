import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { db } from '../db'
import { type FileRecord, type FileRecordRow, transformRow } from './files'
import {
  buildLibraryQueryParts,
  type Category,
  type SortBy,
  type SortDir,
  useLibrary,
} from './library'
import { librarySwr } from './librarySwr'
import { readLocalObjectsForFiles } from './localObjects'

const FILE_COLUMNS =
  'f.id, f.name, f.size, f.createdAt, f.updatedAt, f.addedAt, f.type, f.localId, f.hash, f.thumbForHash, f.thumbSize'

// Cursor-based pagination helpers. These build WHERE clauses that find rows
// "before" or "after" a given anchor row in the sort order. Used by
// fetchFilePosition to count how many rows come before a specific file.

function buildDateCursorClause(
  dir: SortDir,
  direction: 'before' | 'after',
  alias: string,
  anchorValue: number,
  anchorId: string,
) {
  const isBefore = direction === 'before'
  const op = dir === 'ASC' ? (isBefore ? '<' : '>') : isBefore ? '>' : '<'
  const orderDirection = isBefore ? (dir === 'ASC' ? 'DESC' : 'ASC') : dir
  return {
    clause: `(${alias}.createdAt ${op} ?) OR (${alias}.createdAt = ? AND ${alias}.id ${op} ?)`,
    params: [anchorValue, anchorValue, anchorId],
    orderDirection,
  }
}

function buildNameCursorClause(
  dir: SortDir,
  direction: 'before' | 'after',
  alias: string,
  anchorName: string | null,
  anchorId: string,
) {
  const nullExpr = `${alias}.name IS NULL`
  const nameExpr = `${alias}.name COLLATE NOCASE`
  const anchorNull = anchorName === null ? 1 : 0
  const isBefore = direction === 'before'

  const nameOp = dir === 'ASC' ? '<' : '>'
  const afterNameOp = dir === 'ASC' ? '>' : '<'
  const idOpBefore = dir === 'ASC' ? '<' : '>'
  const idOpAfter = dir === 'ASC' ? '>' : '<'
  const orderDirection = isBefore ? (dir === 'ASC' ? 'DESC' : 'ASC') : dir

  if (anchorName === null) {
    return {
      clause: `(${nullExpr} ${
        isBefore ? '<' : '>'
      } ?) OR (${nullExpr} = ? AND ${alias}.id ${
        isBefore ? idOpBefore : idOpAfter
      } ?)`,
      params: [anchorNull, anchorNull, anchorId],
      orderDirection,
    }
  }

  if (isBefore) {
    return {
      clause: `(${nullExpr} < ?) OR (${nullExpr} = ? AND (${nameExpr} ${nameOp} ? OR (${nameExpr} = ? AND ${alias}.id ${idOpBefore} ?)))`,
      params: [anchorNull, anchorNull, anchorName, anchorName, anchorId],
      orderDirection,
    }
  }

  return {
    clause: `(${nullExpr} > ?) OR (${nullExpr} = ? AND (${nameExpr} ${afterNameOp} ? OR (${nameExpr} = ? AND ${alias}.id ${idOpAfter} ?)))`,
    params: [anchorNull, anchorNull, anchorName, anchorName, anchorId],
    orderDirection,
  }
}

async function hydrateRows(rows: FileRecordRow[]): Promise<FileRecord[]> {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const objectsById = await readLocalObjectsForFiles(ids)
  return rows.map((row) => transformRow(row, objectsById[row.id]))
}

type VirtualListQueryParams = {
  sortBy: SortBy
  sortDir: SortDir
  categories: Category[]
  searchQuery: string
}

function buildOrderExpr(sortBy: SortBy, sortDir: SortDir, alias: string = 'f') {
  return sortBy === 'NAME'
    ? `(${alias}.name IS NULL) ASC, ${alias}.name COLLATE NOCASE ${sortDir}, ${alias}.id ${sortDir}`
    : `${alias}.createdAt ${sortDir}, ${alias}.id ${sortDir}`
}

// Returns the total number of files matching the current filters.
export async function fetchTotalCount(
  params: VirtualListQueryParams,
): Promise<number> {
  const { where, params: queryParams } = buildLibraryQueryParts({
    sortBy: params.sortBy,
    sortDir: params.sortDir,
    categories: params.categories,
    query: params.searchQuery,
    tableAlias: 'f',
  })

  const result = await db().getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM files f ${where ?? ''}`,
    ...queryParams,
  )

  return result?.count ?? 0
}

// Given a file ID, returns its position (0-indexed) in the sorted list.
// Used to determine where to start the carousel when opening a specific file.
export async function fetchFilePosition(
  fileId: string,
  params: VirtualListQueryParams,
): Promise<number> {
  const { where, params: queryParams } = buildLibraryQueryParts({
    sortBy: params.sortBy,
    sortDir: params.sortDir,
    categories: params.categories,
    query: params.searchQuery,
    tableAlias: 'f',
  })

  const anchorRow = await db().getFirstAsync<FileRecordRow>(
    `SELECT ${FILE_COLUMNS} FROM files f ${
      where ? `${where} AND f.id = ?` : 'WHERE f.id = ?'
    } LIMIT 1`,
    ...queryParams,
    fileId,
  )

  if (!anchorRow) {
    return 0
  }

  const beforeCursor =
    params.sortBy === 'NAME'
      ? buildNameCursorClause(
          params.sortDir,
          'before',
          'f',
          anchorRow.name ?? null,
          anchorRow.id,
        )
      : buildDateCursorClause(
          params.sortDir,
          'before',
          'f',
          anchorRow.createdAt,
          anchorRow.id,
        )

  const result = await db().getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM files f ${
      where
        ? `${where} AND (${beforeCursor.clause})`
        : `WHERE ${beforeCursor.clause}`
    }`,
    ...queryParams,
    ...beforeCursor.params,
  )

  return result?.count ?? 0
}

// Fetches files at the given indices by querying the contiguous range they span.
export async function fetchFilesAtIndices(
  indices: number[],
  params: VirtualListQueryParams,
): Promise<Map<number, FileRecord>> {
  const result = new Map<number, FileRecord>()
  if (indices.length === 0) {
    return result
  }

  const { where, params: queryParams } = buildLibraryQueryParts({
    sortBy: params.sortBy,
    sortDir: params.sortDir,
    categories: params.categories,
    query: params.searchQuery,
    tableAlias: 'f',
  })

  const orderExpr = buildOrderExpr(params.sortBy, params.sortDir)

  // Find the range of indices we need
  const minIndex = Math.min(...indices)
  const maxIndex = Math.max(...indices)
  const rangeSize = maxIndex - minIndex + 1

  // Single query: fetch the entire range with one LIMIT/OFFSET
  // This is O(n) instead of O(n*m) for m indices
  const sql = `SELECT ${FILE_COLUMNS} FROM files f ${where ?? ''} ORDER BY ${orderExpr} LIMIT ? OFFSET ?`
  const rows = await db().getAllAsync<FileRecordRow>(
    sql,
    ...queryParams,
    rangeSize,
    minIndex,
  )

  // Hydrate all rows in one batch
  const hydratedFiles = await hydrateRows(rows)

  // Map each file to its absolute index
  const indicesSet = new Set(indices)
  for (let i = 0; i < hydratedFiles.length; i++) {
    const absoluteIndex = minIndex + i
    if (indicesSet.has(absoluteIndex)) {
      result.set(absoluteIndex, hydratedFiles[i])
    }
  }

  return result
}

// The carousel can't hold thousands of files in memory, so we give it placeholder
// indices and fetch the actual file data as the user swipes nearby.

async function fetchFileByID(fileID: string): Promise<FileRecord | null> {
  const row = await db().getFirstAsync<FileRecordRow>(
    `SELECT ${FILE_COLUMNS} FROM files f WHERE f.id = ? LIMIT 1`,
    fileID,
  )

  if (!row) return null

  const [file] = await hydrateRows([row])
  return file ?? null
}

async function fileExists(fileID: string): Promise<boolean> {
  const result = await db().getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM files WHERE id = ?`,
    fileID,
  )
  return (result?.count ?? 0) > 0
}

type UseVirtualFileListParams = {
  initialId: string
  initialFile?: FileRecord
  prefetchRadius?: number
  maxCacheSize?: number
  onDeleted?: () => void
  onUpdated?: (message: string) => void
}

type UseVirtualFileListReturn = {
  totalCount: number
  currentIndex: number
  currentFile: FileRecord | null
  getFileAtIndex: (index: number) => FileRecord | null
  setCurrentIndex: (index: number) => void
  isLoading: boolean
}

/**
 * Hook for virtualized file browsing in the carousel.
 *
 * Instead of loading all files into memory, this maintains a sparse cache
 * and fetches files on-demand as the user swipes. The carousel receives
 * placeholder indices and calls getFileAtIndex to get actual file data.
 *
 * @param initialId - The file ID to start viewing
 * @param initialFile - Optional pre-loaded file to avoid a flash of loading state
 * @param prefetchRadius - How many files to prefetch in each direction (default: 3)
 * @param maxCacheSize - Maximum files to keep in memory (default: 50)
 */
export function useVirtualFileList({
  initialId,
  initialFile,
  prefetchRadius = 3,
  maxCacheSize = 50,
  onDeleted,
  onUpdated,
}: UseVirtualFileListParams): UseVirtualFileListReturn {
  const { sortBy, sortDir, selectedCategories, searchQuery } = useLibrary()
  const sortingDir: SortDir = sortDir ?? (sortBy === 'NAME' ? 'ASC' : 'DESC')

  const [currentIndex, setCurrentIndexState] = useState<number>(0)
  const [totalCount, setTotalCount] = useState<number>(initialFile ? 1 : 0)
  const [isLoading, setIsLoading] = useState(!initialFile)

  const cacheRef = useRef<Map<number, FileRecord>>(
    initialFile ? new Map([[0, initialFile]]) : new Map(),
  )
  const fetchingRef = useRef<Set<number>>(new Set())
  const [cacheVersion, setCacheVersion] = useState(0)

  const initialFileRef = useRef(initialFile)

  const categoriesKey = useMemo(
    () =>
      Array.from(selectedCategories ?? new Set())
        .sort()
        .join(','),
    [selectedCategories],
  )

  const queryParams = useMemo<VirtualListQueryParams>(
    () => ({
      sortBy,
      sortDir: sortingDir,
      categories: categoriesKey ? (categoriesKey.split(',') as Category[]) : [],
      searchQuery: searchQuery ?? '',
    }),
    [sortBy, sortingDir, categoriesKey, searchQuery],
  )

  // Initialize: find the starting position and prefetch nearby files
  useEffect(() => {
    let cancelled = false

    async function init() {
      // If we have initialFile, don't show loading state - render immediately
      // while we fetch position/count in the background
      if (!initialFileRef.current) {
        setIsLoading(true)
        cacheRef.current.clear()
      }
      fetchingRef.current.clear()

      try {
        const [count, position] = await Promise.all([
          fetchTotalCount(queryParams),
          fetchFilePosition(initialId, queryParams),
        ])

        if (cancelled) return

        // Move initialFile from index 0 to its actual position.
        if (initialFileRef.current) {
          if (position !== 0) {
            cacheRef.current.delete(0)
          }
          cacheRef.current.set(position, initialFileRef.current)
        }

        setTotalCount(count)
        setCurrentIndexState(position)

        const indicesToFetch: number[] = []
        for (
          let i = Math.max(0, position - prefetchRadius);
          i <= Math.min(count - 1, position + prefetchRadius);
          i++
        ) {
          indicesToFetch.push(i)
        }

        const fetched = await fetchFilesAtIndices(
          indicesToFetch.filter((i) => !cacheRef.current.has(i)),
          queryParams,
        )

        if (cancelled) return

        fetched.forEach((file, index) => {
          cacheRef.current.set(index, file)
        })

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
  }, [initialId, queryParams, prefetchRadius])

  // Prefetch: as the user swipes, fetch nearby files and evict distant ones
  useEffect(() => {
    if (isLoading || totalCount === 0) return

    let cancelled = false

    async function prefetch() {
      const indicesToFetch: number[] = []

      for (
        let i = Math.max(0, currentIndex - prefetchRadius);
        i <= Math.min(totalCount - 1, currentIndex + prefetchRadius);
        i++
      ) {
        if (!cacheRef.current.has(i) && !fetchingRef.current.has(i)) {
          indicesToFetch.push(i)
          fetchingRef.current.add(i)
        }
      }

      if (indicesToFetch.length === 0) return

      try {
        const fetched = await fetchFilesAtIndices(indicesToFetch, queryParams)

        if (cancelled) return

        fetched.forEach((file, index) => {
          cacheRef.current.set(index, file)
        })

        // Evict files furthest from current position to stay under maxCacheSize
        if (cacheRef.current.size > maxCacheSize) {
          const entries = Array.from(cacheRef.current.entries())
          entries.sort(
            (a, b) =>
              Math.abs(a[0] - currentIndex) - Math.abs(b[0] - currentIndex),
          )
          const toKeep = new Set(
            entries.slice(0, maxCacheSize).map(([idx]) => idx),
          )
          for (const [idx] of entries) {
            if (!toKeep.has(idx)) {
              cacheRef.current.delete(idx)
            }
          }
        }

        setCacheVersion((v) => v + 1)
      } finally {
        indicesToFetch.forEach((i) => fetchingRef.current.delete(i))
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
    queryParams,
    prefetchRadius,
    maxCacheSize,
  ])

  const currentFileIDRef = useRef<string | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: cacheVersion forces re-run when cache updates
  useEffect(() => {
    const file = cacheRef.current.get(currentIndex)
    currentFileIDRef.current = file?.id ?? null
  }, [currentIndex, cacheVersion])

  const handleLibraryChange = useCallback(async () => {
    if (isLoading) return

    const currentFileID = currentFileIDRef.current
    if (!currentFileID) return

    try {
      const exists = await fileExists(currentFileID)
      if (!exists) {
        onDeleted?.()
        return
      }

      const [newCount, newPosition] = await Promise.all([
        fetchTotalCount(queryParams),
        fetchFilePosition(currentFileID, queryParams),
      ])

      // Clear cache when position or count changes
      const positionChanged =
        newCount !== totalCount || newPosition !== currentIndex
      if (positionChanged) {
        // Preserve the current file to avoid a flash or loading state.
        const currentFile = cacheRef.current.get(currentIndex)

        setTotalCount(newCount)
        setCurrentIndexState(newPosition)
        cacheRef.current.clear()
        fetchingRef.current.clear()

        if (currentFile) {
          cacheRef.current.set(newPosition, currentFile)
        }

        setCacheVersion((v) => v + 1)
      }

      // Use newPosition for cache lookups when position changed, since
      // state updates are async and currentIndex is stale in this callback.
      const effectiveIndex = positionChanged ? newPosition : currentIndex

      const cachedFile = cacheRef.current.get(effectiveIndex)
      if (cachedFile && cachedFile.id === currentFileID) {
        const freshFile = await fetchFileByID(currentFileID)
        if (freshFile) {
          const nameChanged = cachedFile.name !== freshFile.name
          const metadataChanged =
            nameChanged ||
            cachedFile.updatedAt !== freshFile.updatedAt ||
            cachedFile.size !== freshFile.size ||
            cachedFile.type !== freshFile.type

          if (metadataChanged) {
            cacheRef.current.set(effectiveIndex, freshFile)
            setCacheVersion((v) => v + 1)

            const message = nameChanged ? 'File renamed' : 'File info updated'
            onUpdated?.(message)

            if (nameChanged && sortBy === 'NAME') {
              const updatedPosition = await fetchFilePosition(
                currentFileID,
                queryParams,
              )
              if (updatedPosition !== effectiveIndex) {
                setCurrentIndexState(updatedPosition)
                cacheRef.current.clear()
                fetchingRef.current.clear()
                setCacheVersion((v) => v + 1)
              }
            }
          }
        }
      }
    } catch (_e) {
      // Silently ignore errors during sync handling.
    }
  }, [
    isLoading,
    onDeleted,
    queryParams,
    totalCount,
    currentIndex,
    sortBy,
    onUpdated,
  ])

  useEffect(() => {
    librarySwr.addChangeCallback('carousel', handleLibraryChange)
    return () => {
      librarySwr.removeChangeCallback('carousel')
    }
  }, [handleLibraryChange])

  // biome-ignore lint/correctness/useExhaustiveDependencies: cacheVersion forces new function reference when cache updates
  const getFileAtIndex = useCallback(
    (index: number): FileRecord | null => {
      return cacheRef.current.get(index) ?? null
    },
    [cacheVersion],
  )

  const setCurrentIndex = useCallback(
    (index: number) => {
      if (index >= 0 && index < totalCount) {
        setCurrentIndexState(index)
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

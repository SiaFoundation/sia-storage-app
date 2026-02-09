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

export async function fetchSortedFileIds(
  params: VirtualListQueryParams,
  limit: number,
  offset: number,
): Promise<string[]> {
  const { where, params: queryParams } = buildLibraryQueryParts({
    sortBy: params.sortBy,
    sortDir: params.sortDir,
    categories: params.categories,
    query: params.searchQuery,
    tableAlias: 'f',
  })

  const orderExpr = buildOrderExpr(params.sortBy, params.sortDir)
  const rows = await db().getAllAsync<{ id: string }>(
    `SELECT f.id FROM files f ${where ?? ''} ORDER BY ${orderExpr} LIMIT ? OFFSET ?`,
    ...queryParams,
    limit,
    offset,
  )
  return rows.map((r) => r.id)
}

export async function fetchFilesByIDs(
  ids: string[],
): Promise<Map<string, FileRecord>> {
  const result = new Map<string, FileRecord>()
  if (ids.length === 0) return result

  const placeholders = ids.map(() => '?').join(',')
  const rows = await db().getAllAsync<FileRecordRow>(
    `SELECT ${FILE_COLUMNS} FROM files f WHERE f.id IN (${placeholders})`,
    ...ids,
  )
  const hydrated = await hydrateRows(rows)
  for (const file of hydrated) {
    result.set(file.id, file)
  }
  return result
}

type UseFileCarouselParams = {
  initialId: string
  initialFile?: FileRecord
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
  prefetchRadius = 3,
  maxCacheSize = 50,
  onDeleted,
}: UseFileCarouselParams): UseFileCarouselReturn {
  const { sortBy, sortDir, selectedCategories, searchQuery } = useLibrary()
  const sortingDir: SortDir = sortDir ?? (sortBy === 'NAME' ? 'ASC' : 'DESC')

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

  const handleLibraryChange = useCallback(async () => {
    if (isLoading) return

    const currentFileID = currentFileIdRef.current
    if (!currentFileID) return

    try {
      const row = await db().getFirstAsync<{ id: string }>(
        'SELECT id FROM files WHERE id = ? LIMIT 1',
        currentFileID,
      )
      if (!row) {
        onDeleted?.()
      }
    } catch (_e) {
      // Silently ignore errors during sync handling.
    }
  }, [isLoading, onDeleted])

  useEffect(() => {
    librarySwr.addChangeCallback('carousel', handleLibraryChange)
    return () => {
      librarySwr.removeChangeCallback('carousel')
    }
  }, [handleLibraryChange])

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

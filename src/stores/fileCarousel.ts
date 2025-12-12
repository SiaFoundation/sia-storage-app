import { useMemo, useState, useEffect } from 'react'
import useSWR from 'swr'

import { db } from '../db'
import { FileRecord, FileRecordRow, transformRow } from './files'
import { readLocalObjectsForFiles } from './localObjects'
import {
  SortBy,
  SortDir,
  Category,
  useLibrary,
  buildLibraryQueryParts,
} from './library'
import { logger } from '../lib/logger'

export type WindowResult = {
  files: FileRecord[]
  hasPrevious: boolean
  hasNext: boolean
  anchorId: string | null
}

export type FetchFileCarouselWindowParams = {
  initialId: string
  neighborsPerSide: number
  sortBy: SortBy
  sortDir: SortDir
  categories: Category[]
  searchQuery: string
}

const FILE_COLUMNS =
  'f.id, f.name, f.size, f.createdAt, f.updatedAt, f.addedAt, f.type, f.localId, f.hash, f.thumbForHash, f.thumbSize'

function buildDateCursorClause(
  dir: SortDir,
  direction: 'before' | 'after',
  alias: string,
  anchorValue: number,
  anchorId: string
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
  anchorId: string
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

export async function fetchFileCarouselWindow(
  params: FetchFileCarouselWindowParams
): Promise<WindowResult> {
  const {
    initialId,
    neighborsPerSide,
    sortBy,
    sortDir: sortingDir,
    categories,
    searchQuery,
  } = params

  const { where, params: queryParams } = buildLibraryQueryParts({
    sortBy,
    sortDir: sortingDir,
    categories,
    query: searchQuery,
    tableAlias: 'f',
  })

  const anchorRow = await db().getFirstAsync<FileRecordRow>(
    `SELECT ${FILE_COLUMNS}
     FROM files f
     ${where ? `${where} AND f.id = ?` : 'WHERE f.id = ?'}
     LIMIT 1`,
    ...queryParams,
    initialId
  )

  if (!anchorRow) {
    return { files: [], hasPrevious: false, hasNext: false, anchorId: null }
  }

  const buildOrderExpr = (dir: SortDir) =>
    sortBy === 'NAME'
      ? `(f.name IS NULL) ASC, f.name COLLATE NOCASE ${dir}, f.id ${dir}`
      : `f.createdAt ${dir}, f.id ${dir}`

  const beforeCursor =
    sortBy === 'NAME'
      ? buildNameCursorClause(
          sortingDir,
          'before',
          'f',
          anchorRow.name ?? null,
          anchorRow.id
        )
      : buildDateCursorClause(
          sortingDir,
          'before',
          'f',
          anchorRow.createdAt,
          anchorRow.id
        )

  const afterCursor =
    sortBy === 'NAME'
      ? buildNameCursorClause(
          sortingDir,
          'after',
          'f',
          anchorRow.name ?? null,
          anchorRow.id
        )
      : buildDateCursorClause(
          sortingDir,
          'after',
          'f',
          anchorRow.createdAt,
          anchorRow.id
        )

  const beforeRows = await db().getAllAsync<FileRecordRow>(
    `SELECT ${FILE_COLUMNS}
     FROM files f
     ${
       where
         ? `${where} AND (${beforeCursor.clause})`
         : `WHERE ${beforeCursor.clause}`
     }
     ORDER BY ${buildOrderExpr(beforeCursor.orderDirection)}
     LIMIT ${neighborsPerSide | 0}`,
    ...queryParams,
    ...beforeCursor.params
  )

  const afterRows = await db().getAllAsync<FileRecordRow>(
    `SELECT ${FILE_COLUMNS}
     FROM files f
     ${
       where
         ? `${where} AND (${afterCursor.clause})`
         : `WHERE ${afterCursor.clause}`
     }
     ORDER BY ${buildOrderExpr(afterCursor.orderDirection)}
     LIMIT ${neighborsPerSide | 0}`,
    ...queryParams,
    ...afterCursor.params
  )

  const orderedBeforeRows = [...beforeRows].reverse()
  const allRows = [...orderedBeforeRows, anchorRow, ...afterRows]
  const records = await hydrateRows(allRows)

  return {
    files: records,
    hasPrevious: beforeRows.length === neighborsPerSide,
    hasNext: afterRows.length === neighborsPerSide,
    anchorId: anchorRow.id,
  }
}

type UseFileCarouselWindowParams = {
  initialId: string
  initialFile?: FileRecord
  windowSize: number
}

type UseFileCarouselWindowReturn = {
  currentFile: FileRecord | null
  prevFile: FileRecord | undefined
  nextFile: FileRecord | undefined
  setCurrentFile: (file: FileRecord) => void
  isValidating: boolean
}

/**
 * Hook for managing the file carousel window (current file + neighbors).
 * Handles fetching the file list window, managing current file state,
 * and extracting prev/next files for navigation.
 */
export function useFileCarouselWindow({
  initialId,
  initialFile,
  windowSize,
}: UseFileCarouselWindowParams): UseFileCarouselWindowReturn {
  const { sortBy, sortDir, selectedCategories, searchQuery } = useLibrary()
  const sortingDir: SortDir = sortDir ?? (sortBy === 'NAME' ? 'ASC' : 'DESC')

  const [currentFile, setCurrentFile] = useState<FileRecord | null>(
    initialFile ?? null
  )

  // Build SWR key based on current file ID and library filters
  const swrKey = useMemo(() => {
    const fileId = currentFile?.id ?? initialId
    const cats = Array.from(selectedCategories ?? new Set())
      .slice()
      .sort()
      .join(',')
    return `viewer:${sortBy}:${sortingDir}:${cats}:${
      searchQuery ?? ''
    }:${fileId}:${windowSize}`
  }, [
    selectedCategories,
    sortBy,
    sortingDir,
    searchQuery,
    currentFile?.id,
    initialId,
    windowSize,
  ])

  // Fetch the windowed file list centered around the current file
  const { data, isValidating } = useSWR<WindowResult>(
    swrKey,
    () => {
      const fileId = currentFile?.id ?? initialId
      logger.debug('useFileCarouselWindow', `Fetching window for ${fileId}`)
      return fetchFileCarouselWindow({
        initialId: fileId,
        neighborsPerSide: windowSize,
        sortBy,
        sortDir: sortingDir,
        categories: Array.from(selectedCategories ?? new Set()),
        searchQuery: searchQuery ?? '',
      })
    },
    {
      revalidateOnFocus: false,
      keepPreviousData: true,
    }
  )

  // Initialize and update currentFile state based on data changes
  useEffect(() => {
    if (!data?.files?.length) return

    // If no current file, initialize with the target file or first in list
    if (!currentFile) {
      const initial =
        data.files.find((f) => f.id === initialId) ?? data.files[0]
      logger.debug(
        'useFileCarouselWindow',
        `Initializing with file ${initial.id}`
      )
      setCurrentFile(initial)
      return
    }

    // Update current file if it exists in the new data and has changed
    const updatedFile = data.files.find((f) => f.id === currentFile.id)
    if (!updatedFile) return

    // Only update if the file has actually changed (by updatedAt timestamp)
    if (updatedFile.updatedAt === currentFile.updatedAt) return

    logger.debug(
      'useFileCarouselWindow',
      `Updating file ${currentFile.id} (updatedAt changed)`
    )
    setCurrentFile(updatedFile)
  }, [data, initialId, currentFile])

  // Extract prev and next files from the window
  const { prevFile, nextFile } = useMemo(() => {
    if (!data?.files?.length || !currentFile) {
      return { prevFile: undefined, nextFile: undefined }
    }

    const idx = data.files.findIndex((f) => f.id === currentFile.id)
    if (idx === -1) {
      return { prevFile: undefined, nextFile: undefined }
    }

    const previousFile =
      idx > 0 && data.hasPrevious ? data.files[idx - 1] : undefined
    const nextFileItem =
      idx < data.files.length - 1 && data.hasNext
        ? data.files[idx + 1]
        : undefined

    return { prevFile: previousFile, nextFile: nextFileItem }
  }, [data, currentFile])

  return {
    currentFile,
    prevFile,
    nextFile,
    setCurrentFile,
    isValidating,
  }
}

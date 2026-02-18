import { useMemo } from 'react'
import useSWR from 'swr'
import useSWRInfinite from 'swr/infinite'
import { create } from 'zustand'
import { db } from '../db'
import { type FileRecord, type FileRecordRow, transformRow } from './files'
import { libraryStats, useOnLibraryListChange } from './librarySwr'
import { readLocalObjectsForFiles } from './localObjects'

type MediaCategory = 'Video' | 'Image' | 'Audio'
const MEDIA_PREFIXES: Record<MediaCategory, string> = {
  Video: 'video/',
  Image: 'image/',
  Audio: 'audio/',
}

type FileOrderParams = {
  sortBy?: SortBy
  sortDir?: SortDir
  categories?: Category[]
  query?: string
  limit?: number
  offset?: number
}

async function readOrderedFileRecords(
  opts?: FileOrderParams,
): Promise<FileRecord[]> {
  const {
    sortBy = 'DATE',
    sortDir,
    categories = [],
    query,
    limit,
    offset,
  } = opts ?? {}
  const dir: SortDir = sortDir ?? (sortBy === 'NAME' ? 'ASC' : 'DESC')

  const { where, params, orderExpr } = buildLibraryQueryParts({
    sortBy,
    sortDir: dir,
    categories,
    query,
    tableAlias: 'files',
  })

  let pageClause = ''
  if (limit != null && offset != null) {
    pageClause = ` LIMIT ${limit | 0} OFFSET ${offset | 0}`
  }

  const rows = await db().getAllAsync<FileRecordRow>(
    `SELECT id, name, size, createdAt, updatedAt, type, localId, hash
     FROM files
     ${where}
     ORDER BY ${orderExpr}${pageClause}`,
    ...params,
  )

  const fileIds = rows.map((r) => r.id)
  const objectsByFile = await readLocalObjectsForFiles(fileIds)
  return rows.map((row) => transformRow(row, objectsByFile[row.id]))
}

const PAGE_SIZE = 40

export function useFileList() {
  const { sortBy, sortDir, selectedCategories, searchQuery } = useLibrary()
  const sortingDir = sortDir ?? (sortBy === 'NAME' ? 'ASC' : 'DESC')
  const categories = Array.from(selectedCategories ?? new Set())
  const categoriesKey = categories.length
    ? categories.slice().sort().join(',')
    : ''

  const base = `library/list:${sortBy}:${sortingDir}:${categoriesKey}:${searchQuery ?? ''}`

  const fetcher = async (key: string) => {
    const pageIndex = Number(key.split('|page=').pop() ?? '0')
    const items = await readOrderedFileRecords({
      sortBy,
      sortDir: sortingDir,
      categories: categories.length ? categories : undefined,
      query: searchQuery?.trim().length ? searchQuery : undefined,
      limit: PAGE_SIZE,
      offset: pageIndex * PAGE_SIZE,
    })
    return items
  }

  const swr = useSWRInfinite<FileRecord[]>(
    (pageIndex, prevPage) => {
      if (pageIndex > 0 && (!prevPage || prevPage.length < PAGE_SIZE))
        return null
      return `${base}|page=${pageIndex}`
    },
    fetcher,
    { revalidateOnFocus: false, revalidateAll: true },
  )

  useOnLibraryListChange(() => swr.mutate())

  const pages = swr.data

  const flat = useMemo(() => {
    return pages ? pages.flat() : undefined
  }, [pages])

  const lastPage = pages?.[pages.length - 1]
  const hasMore = !!lastPage && lastPage.length === PAGE_SIZE

  return {
    ...swr,
    data: flat,
    hasMore,
  }
}

// Count of library files excluding thumbnails.
export function useLibraryCount() {
  return useSWR(libraryStats.key('countNoThumbs'), async () => {
    const row = await db().getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM files WHERE kind = 'file'`,
    )
    return row?.count ?? 0
  })
}

// File View Store
export type SortBy = 'NAME' | 'DATE'
export type SortDir = 'ASC' | 'DESC'
export type Category = 'Video' | 'Image' | 'Audio' | 'Files'
export const categories = ['Video', 'Image', 'Audio', 'Files'] as const

export function buildLibraryQueryParts(
  opts: {
    sortBy?: SortBy
    sortDir?: SortDir
    categories?: Category[]
    query?: string
    tableAlias?: string
  } = {},
): {
  where: string
  params: (string | number)[]
  orderExpr: string
} {
  const {
    sortBy = 'DATE',
    sortDir,
    categories = [],
    query,
    tableAlias = 'files',
  } = opts
  const dir: SortDir = sortDir ?? (sortBy === 'NAME' ? 'ASC' : 'DESC')

  const mediaCategories = categories.filter(
    (c): c is MediaCategory => c in MEDIA_PREFIXES,
  )
  const includesFiles = categories.includes('Files')
  const hasQuery = typeof query === 'string' && query.trim().length > 0

  // If all 4 categories selected, no filter needed
  const allSelected = mediaCategories.length === 3 && includesFiles

  const whereParts: string[] = []
  const params: (string | number)[] = []
  // Exclude thumbnails from library lists.
  whereParts.push(`${tableAlias}.kind = 'file'`)

  if (!allSelected && (mediaCategories.length > 0 || includesFiles)) {
    const categoryConditions: string[] = []

    // Add LIKE conditions for selected media categories
    for (const cat of mediaCategories) {
      categoryConditions.push(`${tableAlias}.type LIKE ?`)
      params.push(`${MEDIA_PREFIXES[cat]}%`)
    }

    // Add NOT LIKE conditions for Files (everything not video/image/audio)
    if (includesFiles) {
      const notLikeClauses = Object.values(MEDIA_PREFIXES)
        .map(() => `${tableAlias}.type NOT LIKE ?`)
        .join(' AND ')
      categoryConditions.push(`(${notLikeClauses})`)
      params.push(...Object.values(MEDIA_PREFIXES).map((p) => `${p}%`))
    }

    whereParts.push(`(${categoryConditions.join(' OR ')})`)
  }
  if (hasQuery) {
    whereParts.push(`${tableAlias}.name LIKE ? COLLATE NOCASE ESCAPE "\\"`)
    const escaped = (query ?? '').replace(/[%_\\]/g, (m) => `\\${m}`)
    params.push(`%${escaped}%`)
  }
  const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : ''

  const orderExpr =
    sortBy === 'NAME'
      ? `(${tableAlias}.name IS NULL) ASC, ${tableAlias}.name COLLATE NOCASE ${dir}, ${tableAlias}.id ${dir}`
      : `${tableAlias}.createdAt ${dir}, ${tableAlias}.id ${dir}`

  return { where, params, orderExpr }
}

type LibraryState = {
  sortBy: SortBy
  sortDir: SortDir
  selectedCategories: Set<Category>
  searchQuery: string
}

export const useLibrary = create<LibraryState>(() => ({
  sortBy: 'DATE',
  sortDir: 'DESC',
  selectedCategories: new Set<Category>(),
  searchQuery: '',
}))

const { setState } = useLibrary

export function setSortCategory(sortBy: SortBy) {
  setState(() => {
    return { sortBy }
  })
}

export function toggleDir() {
  setState((state) => {
    return { sortDir: state.sortDir === 'ASC' ? 'DESC' : 'ASC' }
  })
}

export function toggleCategory(c: Category) {
  setState((state) => {
    const next = new Set(state.selectedCategories)
    next.has(c) ? next.delete(c) : next.add(c)
    return { selectedCategories: next }
  })
}

export function clearCategories() {
  setState(() => {
    return { selectedCategories: new Set() }
  })
}

export function setSearchQuery(searchQuery: string) {
  setState(() => {
    return { searchQuery }
  })
}

export function clearSearchQuery() {
  setState(() => {
    return { searchQuery: '' }
  })
}

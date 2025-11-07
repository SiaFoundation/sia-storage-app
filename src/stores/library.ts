import { db } from '../db'
import { create } from 'zustand'
import useSWRInfinite from 'swr/infinite'
import { FileRecord, FileRecordRow, transformRow } from './files'
import { readLocalObjectsForFiles } from './localObjects'
import { buildSWRHelpers } from '../lib/swr'
import useSWR from 'swr'

export const librarySwr = buildSWRHelpers('library')

const CATEGORY_TO_PREFIX: Record<Category, string> = {
  Video: 'video/',
  Image: 'image/',
  Audio: 'audio/',
  Files: 'application/',
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
  opts?: FileOrderParams
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

  const prefixes = categories.map((c) => CATEGORY_TO_PREFIX[c])
  const hasCategories = prefixes.length > 0
  const hasQuery = typeof query === 'string' && query.trim().length > 0

  const whereParts: string[] = []
  const params: (string | number | null)[] = []
  // Exclude thumbnails from library lists.
  whereParts.push('thumbForHash IS NULL')
  if (hasCategories) {
    whereParts.push(prefixes.map(() => 'type LIKE ?').join(' OR '))
    params.push(...prefixes.map((p) => `${p}%`))
  }
  if (hasQuery) {
    whereParts.push('name LIKE ? COLLATE NOCASE ESCAPE "\\"')
    const escaped = (query ?? '').replace(/[%_\\]/g, (m) => `\\${m}`)
    params.push(`%${escaped}%`)
  }
  const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : ''

  const orderExpr =
    sortBy === 'NAME'
      ? `(name IS NULL) ASC, name COLLATE NOCASE ${dir}, id ${dir}`
      : `createdAt ${dir}, id ${dir}`

  let pageClause = ''
  if (limit != null && offset != null) {
    pageClause = ` LIMIT ${limit | 0} OFFSET ${offset | 0}`
  }

  const rows = await db().getAllAsync<FileRecordRow>(
    `SELECT id, name, size, createdAt, updatedAt, type, localId, hash
     FROM files
     ${where}
     ORDER BY ${orderExpr}${pageClause}`,
    ...params
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

  const base = librarySwr.getKey(
    `list:${sortBy}:${sortingDir}:${categoriesKey}:${searchQuery ?? ''}`
  )

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
    { revalidateOnFocus: false, revalidateAll: true }
  )

  librarySwr.addChangeCallback('infiniteList', swr.mutate)

  const pages = swr.data
  const flat = pages ? pages.flat() : undefined

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
  return useSWR(librarySwr.getKey('countWithoutThumbs'), async () => {
    const row = await db().getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM files WHERE thumbForHash IS NULL`
    )
    return row?.count ?? 0
  })
}

// File View Store
export type SortBy = 'NAME' | 'DATE'
export type SortDir = 'ASC' | 'DESC'
export type Category = 'Video' | 'Image' | 'Audio' | 'Files'
export const categories = ['Video', 'Image', 'Audio', 'Files'] as const

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

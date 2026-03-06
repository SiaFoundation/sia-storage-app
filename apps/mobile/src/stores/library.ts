import type { Category, SortBy, SortDir } from '@siastorage/core/db/operations'
import * as ops from '@siastorage/core/db/operations'
import type { FileRecord, FileRecordRow } from '@siastorage/core/types'
import { useMemo } from 'react'
import useSWR from 'swr'
import useSWRInfinite from 'swr/infinite'
import { db } from '../db'
import { libraryStats, useOnLibraryListChange } from './librarySwr'
import { readLocalObjectsForFiles } from './localObjects'

type FileOrderParams = {
  sortBy?: SortBy
  sortDir?: SortDir
  categories?: Category[]
  query?: string
  tags?: string[]
  directoryId?: string
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
    tags = [],
    directoryId,
    limit,
    offset,
  } = opts ?? {}
  const dir: SortDir = sortDir ?? (sortBy === 'NAME' ? 'ASC' : 'DESC')

  const { where, params, orderExpr } = ops.buildLibraryQueryParts({
    sortBy,
    sortDir: dir,
    categories,
    query,
    tags,
    directoryId,
    tableAlias: 'files',
  })

  let pageClause = ''
  if (limit != null && offset != null) {
    pageClause = ` LIMIT ${limit | 0} OFFSET ${offset | 0}`
  }

  const rows = await db().getAllAsync<FileRecordRow>(
    `SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt, thumbForId, thumbSize, trashedAt, deletedAt
     FROM files
     ${where}
     ORDER BY ${orderExpr}${pageClause}`,
    ...params,
  )

  const fileIds = rows.map((r) => r.id)
  const objectsByFile = await readLocalObjectsForFiles(fileIds)
  return rows.map((row) => ops.transformRow(row, objectsByFile[row.id]))
}

const PAGE_SIZE = 40

export type FileListParams = {
  scope: string
  sortBy?: SortBy
  sortDir?: SortDir
  categories?: Category[]
  query?: string
  tags?: string[]
  directoryId?: string
}

export function useFileList(params: FileListParams) {
  const {
    scope,
    sortBy = 'DATE',
    sortDir: sortDirParam,
    categories = [],
    query,
    tags = [],
    directoryId,
  } = params
  const sortingDir = sortDirParam ?? (sortBy === 'NAME' ? 'ASC' : 'DESC')

  const categoriesKey = categories.length
    ? categories.slice().sort().join(',')
    : ''

  const tagsKey = tags.length ? tags.slice().sort().join(',') : ''

  const base = `library/${scope}:list:${sortBy}:${sortingDir}:${categoriesKey}:${tagsKey}:${directoryId ?? ''}:${query ?? ''}`

  const fetcher = async (key: string) => {
    const pageIndex = Number(key.split('|page=').pop() ?? '0')
    const items = await readOrderedFileRecords({
      sortBy,
      sortDir: sortingDir,
      categories: categories.length ? categories : undefined,
      query: query?.trim().length ? query : undefined,
      tags: tags.length ? tags : undefined,
      directoryId,
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

export function useLibraryCount() {
  return useSWR(libraryStats.key('countNoThumbs'), () =>
    ops.queryLibraryFileCount(db()),
  )
}

export function useMediaCount() {
  return useSWR(libraryStats.key('mediaCount'), () =>
    ops.queryMediaFileCount(db()),
  )
}

export function useTagFileCount(tagId: string) {
  return useSWR(libraryStats.key(`tagCount:${tagId}`), () =>
    ops.queryTagFileCount(db(), tagId),
  )
}

export function useDirectoryFileCount(directoryId: string) {
  return useSWR(libraryStats.key(`dirCount:${directoryId}`), () =>
    ops.queryDirectoryFileCount(db(), directoryId),
  )
}

export function useUnfiledFileCount() {
  return useSWR(libraryStats.key('unfiledCount'), () =>
    ops.queryUnfiledFileCount(db()),
  )
}

export const categories = ['Video', 'Image', 'Audio', 'Files'] as const

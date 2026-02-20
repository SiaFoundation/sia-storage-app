import { useMemo } from 'react'
import useSWR from 'swr'
import useSWRInfinite from 'swr/infinite'
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

  const { where, params, orderExpr } = buildLibraryQueryParts({
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
    `SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt, thumbForId, thumbSize
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

// Count of library files excluding thumbnails.
export function useLibraryCount() {
  return useSWR(libraryStats.key('countNoThumbs'), async () => {
    const row = await db().getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM files WHERE kind = 'file'`,
    )
    return row?.count ?? 0
  })
}

// Count of media files (image, video, audio) excluding thumbnails.
export function useMediaCount() {
  return useSWR(libraryStats.key('mediaCount'), async () => {
    const row = await db().getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM files
       WHERE kind = 'file'
         AND (type LIKE 'image/%' OR type LIKE 'video/%' OR type LIKE 'audio/%')`,
    )
    return row?.count ?? 0
  })
}

// Count of files with a specific tag, excluding thumbnails.
export function useTagFileCount(tagId: string) {
  return useSWR(libraryStats.key(`tagCount:${tagId}`), async () => {
    const row = await db().getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM files f
       INNER JOIN file_tags ft ON ft.fileId = f.id
       WHERE ft.tagId = ? AND f.kind = 'file'`,
      tagId,
    )
    return row?.count ?? 0
  })
}

// Count of files in a specific directory, excluding thumbnails.
export function useDirectoryFileCount(directoryId: string) {
  return useSWR(libraryStats.key(`dirCount:${directoryId}`), async () => {
    const row = await db().getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM files
       WHERE directoryId = ? AND kind = 'file'`,
      directoryId,
    )
    return row?.count ?? 0
  })
}

// File View Store
export type SortBy = 'NAME' | 'DATE' | 'ADDED' | 'SIZE'
export type SortDir = 'ASC' | 'DESC'
export type Category = 'Video' | 'Image' | 'Audio' | 'Files'
export const categories = ['Video', 'Image', 'Audio', 'Files'] as const

export function buildLibraryQueryParts(
  opts: {
    sortBy?: SortBy
    sortDir?: SortDir
    categories?: Category[]
    query?: string
    tags?: string[]
    directoryId?: string
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
    tags = [],
    directoryId,
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
    whereParts.push(`${tableAlias}.name LIKE ? COLLATE NOCASE ESCAPE '\\'`)
    const escaped = (query ?? '').replace(/[%_\\]/g, (m) => `\\${m}`)
    params.push(`%${escaped}%`)
  }
  // Tag filtering: file must have ALL selected tags (AND logic).
  if (tags.length > 0) {
    const placeholders = tags.map(() => '?').join(',')
    whereParts.push(`
      ${tableAlias}.id IN (
        SELECT ft.fileId FROM file_tags ft
        WHERE ft.tagId IN (${placeholders})
        GROUP BY ft.fileId
        HAVING COUNT(DISTINCT ft.tagId) = ?
      )
    `)
    params.push(...tags, tags.length)
  }
  // Directory filtering.
  if (directoryId) {
    whereParts.push(`${tableAlias}.directoryId = ?`)
    params.push(directoryId)
  }
  const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : ''

  let orderExpr: string
  switch (sortBy) {
    case 'NAME':
      orderExpr = `(${tableAlias}.name IS NULL) ASC, ${tableAlias}.name COLLATE NOCASE ${dir}, ${tableAlias}.id ${dir}`
      break
    case 'ADDED':
      orderExpr = `${tableAlias}.addedAt ${dir}, ${tableAlias}.id ${dir}`
      break
    case 'SIZE':
      orderExpr = `${tableAlias}.size ${dir}, ${tableAlias}.id ${dir}`
      break
    default:
      orderExpr = `${tableAlias}.createdAt ${dir}, ${tableAlias}.id ${dir}`
      break
  }

  return { where, params, orderExpr }
}

import type { DatabaseAdapter } from '../../adapters/db'

export type SortBy = 'NAME' | 'DATE' | 'ADDED' | 'SIZE'
export type SortDir = 'ASC' | 'DESC'
export type Category = 'Video' | 'Image' | 'Audio' | 'Files'

type MediaCategory = 'Video' | 'Image' | 'Audio'
const MEDIA_PREFIXES: Record<MediaCategory, string> = {
  Video: 'video/',
  Image: 'image/',
  Audio: 'audio/',
}

export const UNFILED_DIRECTORY_ID = '__unfiled__'

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

  const allSelected = mediaCategories.length === 3 && includesFiles

  const whereParts: string[] = []
  const params: (string | number)[] = []
  whereParts.push(`${tableAlias}.kind = 'file'`)
  whereParts.push(`${tableAlias}.trashedAt IS NULL`)
  whereParts.push(`${tableAlias}.deletedAt IS NULL`)

  if (!allSelected && (mediaCategories.length > 0 || includesFiles)) {
    const categoryConditions: string[] = []

    for (const cat of mediaCategories) {
      categoryConditions.push(`${tableAlias}.type LIKE ?`)
      params.push(`${MEDIA_PREFIXES[cat]}%`)
    }

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
  if (directoryId === UNFILED_DIRECTORY_ID) {
    whereParts.push(`${tableAlias}.directoryId IS NULL`)
  } else if (directoryId) {
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

export type LibraryQueryParams = {
  sortBy?: SortBy
  sortDir?: SortDir
  categories?: Category[]
  query?: string
  tags?: string[]
  directoryId?: string
}

export async function queryLibraryFileCount(
  db: DatabaseAdapter,
): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM files WHERE kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL`,
  )
  return row?.count ?? 0
}

export async function queryMediaFileCount(
  db: DatabaseAdapter,
): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM files
     WHERE kind = 'file'
       AND trashedAt IS NULL AND deletedAt IS NULL
       AND (type LIKE 'image/%' OR type LIKE 'video/%' OR type LIKE 'audio/%')`,
  )
  return row?.count ?? 0
}

export async function queryTagFileCount(
  db: DatabaseAdapter,
  tagId: string,
): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM files f
     INNER JOIN file_tags ft ON ft.fileId = f.id
     WHERE ft.tagId = ? AND f.kind = 'file' AND f.trashedAt IS NULL AND f.deletedAt IS NULL`,
    tagId,
  )
  return row?.count ?? 0
}

export async function queryDirectoryFileCount(
  db: DatabaseAdapter,
  directoryId: string,
): Promise<number> {
  if (directoryId === UNFILED_DIRECTORY_ID) {
    return queryUnfiledFileCount(db)
  }
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM files
     WHERE directoryId = ? AND kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL`,
    directoryId,
  )
  return row?.count ?? 0
}

export async function queryUnfiledFileCount(
  db: DatabaseAdapter,
): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM files
     WHERE directoryId IS NULL AND kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL`,
  )
  return row?.count ?? 0
}

export async function queryFileCountWithFilters(
  db: DatabaseAdapter,
  opts: LibraryQueryParams,
): Promise<number> {
  const { where, params } = buildLibraryQueryParts({
    ...opts,
    tableAlias: 'f',
  })

  const result = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM files f ${where ?? ''}`,
    ...params,
  )

  return result?.count ?? 0
}

export async function queryFilePositionInSortedList(
  db: DatabaseAdapter,
  fileId: string,
  opts: LibraryQueryParams & { sortBy: SortBy; sortDir: SortDir },
): Promise<number> {
  const { where, params: queryParams } = buildLibraryQueryParts({
    ...opts,
    tableAlias: 'f',
  })

  const anchorRow = await db.getFirstAsync<{
    id: string
    name: string | null
    size: number
    createdAt: number
    addedAt: number
  }>(
    `SELECT f.id, f.name, f.size, f.createdAt, f.addedAt FROM files f ${
      where ? `${where} AND f.id = ?` : 'WHERE f.id = ?'
    } LIMIT 1`,
    ...queryParams,
    fileId,
  )

  if (!anchorRow) {
    return 0
  }

  let beforeCursor: { clause: string; params: (string | number)[] }

  if (opts.sortBy === 'NAME') {
    beforeCursor = buildNameBeforeCursor(
      opts.sortDir,
      'f',
      anchorRow.name ?? null,
      anchorRow.id,
    )
  } else {
    const columnMap = {
      ADDED: { column: 'addedAt', value: anchorRow.addedAt },
      SIZE: { column: 'size', value: anchorRow.size },
      DATE: { column: 'createdAt', value: anchorRow.createdAt },
    } as const
    const { column, value } = columnMap[opts.sortBy] ?? columnMap.DATE
    beforeCursor = buildDateBeforeCursor(
      opts.sortDir,
      'f',
      value,
      anchorRow.id,
      column,
    )
  }

  const result = await db.getFirstAsync<{ count: number }>(
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

export async function querySortedFileIds(
  db: DatabaseAdapter,
  opts: LibraryQueryParams,
  limit: number,
  offset: number,
): Promise<string[]> {
  const {
    where,
    params: queryParams,
    orderExpr,
  } = buildLibraryQueryParts({
    ...opts,
    tableAlias: 'f',
  })

  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT f.id FROM files f ${where ?? ''} ORDER BY ${orderExpr} LIMIT ? OFFSET ?`,
    ...queryParams,
    limit,
    offset,
  )
  return rows.map((r) => r.id)
}

export async function queryFileExists(
  db: DatabaseAdapter,
  fileId: string,
): Promise<boolean> {
  const row = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM files WHERE id = ? LIMIT 1',
    fileId,
  )
  return !!row
}

function buildDateBeforeCursor(
  dir: SortDir,
  alias: string,
  anchorValue: number,
  anchorId: string,
  column: string = 'createdAt',
): { clause: string; params: (string | number)[] } {
  const op = dir === 'ASC' ? '<' : '>'
  return {
    clause: `(${alias}.${column} ${op} ?) OR (${alias}.${column} = ? AND ${alias}.id ${op} ?)`,
    params: [anchorValue, anchorValue, anchorId],
  }
}

function buildNameBeforeCursor(
  dir: SortDir,
  alias: string,
  anchorName: string | null,
  anchorId: string,
): { clause: string; params: (string | number)[] } {
  const nullExpr = `${alias}.name IS NULL`
  const nameExpr = `${alias}.name COLLATE NOCASE`
  const anchorNull = anchorName === null ? 1 : 0
  const nameOp = dir === 'ASC' ? '<' : '>'
  const idOp = dir === 'ASC' ? '<' : '>'

  if (anchorName === null) {
    return {
      clause: `(${nullExpr} < ?) OR (${nullExpr} = ? AND ${alias}.id ${idOp} ?)`,
      params: [anchorNull, anchorNull, anchorId],
    }
  }

  return {
    clause: `(${nullExpr} < ?) OR (${nullExpr} = ? AND (${nameExpr} ${nameOp} ? OR (${nameExpr} = ? AND ${alias}.id ${idOp} ?)))`,
    params: [anchorNull, anchorNull, anchorName, anchorName, anchorId],
  }
}

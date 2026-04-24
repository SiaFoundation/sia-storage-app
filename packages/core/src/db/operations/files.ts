import { logger } from '@siastorage/logger'
import type { DatabaseAdapter } from '../../adapters/db'
import type { LocalObject, LocalObjectRef, LocalObjectRefRow } from '../../encoding/localObject'
import { localObjectRefFromStorageRow } from '../../encoding/localObject'
import { naturalSortKey } from '../../lib/naturalSortKey'
import type { FileRecord, FileRecordRow } from '../../types/files'
import * as sql from '../sql'
import { buildRecordFilter } from './library'
import { insertObject, queryObjectRefsForFile, queryObjectsForFile } from './localObjects'
import { trashFilesAndThumbnails } from './trash'

export async function recalculateCurrentForGroup(
  db: DatabaseAdapter,
  name: string,
  directoryId: string | null,
): Promise<void> {
  const dirCondition = directoryId === null ? 'directoryId IS NULL' : 'directoryId = ?'
  const dirParams = directoryId === null ? [name] : [name, directoryId]

  await db.runAsync(
    `UPDATE files SET current = 0
     WHERE name = ? AND ${dirCondition} AND kind = 'file'
       AND trashedAt IS NULL AND deletedAt IS NULL AND current = 1`,
    ...dirParams,
  )
  await db.runAsync(
    `UPDATE files SET current = 1 WHERE id = (
       SELECT id FROM files
       WHERE name = ? AND ${dirCondition} AND kind = 'file'
         AND trashedAt IS NULL AND deletedAt IS NULL
       ORDER BY updatedAt DESC, id DESC LIMIT 1
     )`,
    ...dirParams,
  )
}

export async function recalculateCurrentForGroups(
  db: DatabaseAdapter,
  groups: { name: string; directoryId: string | null }[],
): Promise<void> {
  const seen = new Set<string>()
  for (const { name, directoryId } of groups) {
    const key = `${name}\0${directoryId ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    await recalculateCurrentForGroup(db, name, directoryId)
  }
}

export async function recalculateCurrentForFileIds(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<void> {
  if (fileIds.length === 0) return
  const ph = fileIds.map(() => '?').join(',')
  const groupsCte = `SELECT DISTINCT name, directoryId FROM files WHERE id IN (${ph}) AND kind = 'file'`
  await db.runAsync(
    `UPDATE files SET current = 0
     WHERE current = 1 AND kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL
       AND id IN (
         SELECT f2.id FROM files f2
         INNER JOIN (${groupsCte}) g
           ON f2.name = g.name AND f2.directoryId IS g.directoryId
         WHERE f2.kind = 'file' AND f2.trashedAt IS NULL AND f2.deletedAt IS NULL
       )`,
    ...fileIds,
  )
  await db.runAsync(
    `UPDATE files SET current = 1
     WHERE id IN (
       SELECT id FROM (
         SELECT f2.id, ROW_NUMBER() OVER (
           PARTITION BY f2.name, f2.directoryId
           ORDER BY f2.updatedAt DESC, f2.id DESC
         ) AS rn
         FROM files f2
         INNER JOIN (${groupsCte}) g
           ON f2.name = g.name AND f2.directoryId IS g.directoryId
         WHERE f2.kind = 'file' AND f2.trashedAt IS NULL AND f2.deletedAt IS NULL
       ) sub WHERE sub.rn = 1
     )`,
    ...fileIds,
  )
}

const FILE_ROW_COLUMNS =
  'id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt, thumbForId, thumbSize, trashedAt, deletedAt, lostReason'

export async function queryFilesByIds(
  db: DatabaseAdapter,
  ids: string[],
): Promise<Map<string, FileRecordRow>> {
  const result = new Map<string, FileRecordRow>()
  if (ids.length === 0) return result
  const ph = ids.map(() => '?').join(',')
  const rows = await db.getAllAsync<FileRecordRow>(
    `SELECT ${FILE_ROW_COLUMNS} FROM files WHERE id IN (${ph})`,
    ...ids,
  )
  for (const row of rows) {
    result.set(row.id, row)
  }
  return result
}

export async function queryFilesByObjectIds(
  db: DatabaseAdapter,
  objectIds: string[],
  indexerURL: string,
): Promise<Map<string, FileRecordRow>> {
  const result = new Map<string, FileRecordRow>()
  if (objectIds.length === 0) return result
  const ph = objectIds.map(() => '?').join(',')
  const rows = await db.getAllAsync<FileRecordRow & { objectId: string }>(
    `SELECT o.id AS objectId, f.${FILE_ROW_COLUMNS.split(', ').join(', f.')}
     FROM objects o
     JOIN files f ON f.id = o.fileId
     WHERE o.indexerURL = ? AND o.id IN (${ph})`,
    indexerURL,
    ...objectIds,
  )
  for (const row of rows) {
    result.set(row.objectId, row)
  }
  return result
}

export function transformRow<T extends LocalObjectRef = LocalObjectRef>(
  row: FileRecordRow,
  objects?: T[],
): FileRecordRow & { objects: Record<string, T> } {
  const objectsMap: Record<string, T> = {}
  for (const o of objects || []) {
    objectsMap[o.indexerURL] = o
  }
  return {
    id: row.id,
    name: row.name,
    size: row.size,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    addedAt: row.addedAt,
    type: row.type,
    kind: row.kind ?? 'file',
    localId: row.localId,
    hash: row.hash,
    thumbForId: row.thumbForId ?? undefined,
    thumbSize: row.thumbSize ?? undefined,
    trashedAt: row.trashedAt ?? null,
    deletedAt: row.deletedAt ?? null,
    lostReason: row.lostReason ?? null,
    objects: objectsMap,
  }
}

export async function insertFile(
  db: DatabaseAdapter,
  fileRecord: Omit<FileRecord, 'objects'>,
  options?: { skipCurrentRecalc?: boolean },
): Promise<void> {
  const {
    id,
    name,
    size,
    createdAt,
    updatedAt,
    type,
    kind,
    localId,
    hash,
    addedAt,
    thumbForId,
    thumbSize,
    trashedAt,
    deletedAt,
    lostReason,
  } = fileRecord
  await sql.insert(db, 'files', {
    id,
    name,
    nameSortKey: naturalSortKey(name),
    size,
    createdAt,
    updatedAt,
    type,
    kind,
    localId,
    hash,
    addedAt,
    thumbForId,
    thumbSize,
    trashedAt,
    deletedAt,
    lostReason,
  })
  if (kind === 'file' && !options?.skipCurrentRecalc) {
    const row = await db.getFirstAsync<{ directoryId: string | null }>(
      'SELECT directoryId FROM files WHERE id = ?',
      id,
    )
    await recalculateCurrentForGroup(db, name, row?.directoryId ?? null)
  }
}

type FileRecordCursorColumn = 'createdAt' | 'updatedAt' | 'addedAt'

export type FileQueryOpts = {
  limit?: number
  after?: { value: number; id: string }
  order: 'ASC' | 'DESC'
  orderBy?: FileRecordCursorColumn
  pinned?: {
    indexerURL: string
    isPinned: boolean
  }
  fileExistsLocally?: boolean
  excludeIds?: string[]
  /** Include kind='thumb' rows. Default: only kind='file'. */
  includeThumbnails?: boolean
  /** Include superseded versions (current=0). Default: current version only. */
  includeOldVersions?: boolean
  /** Include trashed rows. Default: excluded. */
  includeTrashed?: boolean
  /** Include tombstoned rows. Default: excluded. */
  includeDeleted?: boolean
  hashEmpty?: boolean
  hashNotEmpty?: boolean
}

function buildFileRecordsQuery(
  opts: FileQueryOpts,
  tableAlias: string = 'files',
): {
  where: string
  params: (string | number)[]
  orderExpr: string
  limitExpr: string
} {
  const {
    limit,
    after,
    order,
    pinned,
    orderBy,
    fileExistsLocally,
    excludeIds,
    includeThumbnails,
    includeOldVersions,
    includeTrashed,
    includeDeleted,
    hashEmpty,
    hashNotEmpty,
  } = opts
  const sortColumn: FileRecordCursorColumn = orderBy ?? 'createdAt'

  const params: (string | number)[] = []

  const whereClauses: string[] = [
    buildRecordFilter(tableAlias, {
      includeThumbnails,
      includeOldVersions,
      includeTrashed,
      includeDeleted,
    }),
  ]

  if (hashEmpty) {
    whereClauses.push(`${tableAlias}.hash = ''`)
  }

  if (hashNotEmpty) {
    whereClauses.push(`${tableAlias}.hash != ''`)
  }

  if (after) {
    if (order === 'ASC') {
      whereClauses.push(
        `((${tableAlias}.${sortColumn} > ?) OR (${tableAlias}.${sortColumn} = ? AND ${tableAlias}.id > ?))`,
      )
    } else {
      whereClauses.push(
        `((${tableAlias}.${sortColumn} < ?) OR (${tableAlias}.${sortColumn} = ? AND ${tableAlias}.id < ?))`,
      )
    }
    params.push(after.value, after.value, after.id)
  }

  if (pinned) {
    const existsExpr = pinned.isPinned
      ? `EXISTS (SELECT 1 FROM objects s WHERE s.fileId = ${tableAlias}.id AND s.indexerURL = ?)`
      : `NOT EXISTS (SELECT 1 FROM objects s WHERE s.fileId = ${tableAlias}.id AND s.indexerURL = ?)`
    whereClauses.push(existsExpr)
    params.push(pinned.indexerURL)
  }

  if (fileExistsLocally !== undefined) {
    if (fileExistsLocally) {
      whereClauses.push(`EXISTS (SELECT 1 FROM fs fsMeta WHERE fsMeta.fileId = ${tableAlias}.id)`)
    } else {
      whereClauses.push(
        `NOT EXISTS (SELECT 1 FROM fs fsMeta WHERE fsMeta.fileId = ${tableAlias}.id)`,
      )
    }
  }

  if (excludeIds && excludeIds.length > 0) {
    const placeholders = excludeIds.map(() => '?').join(', ')
    whereClauses.push(`${tableAlias}.id NOT IN (${placeholders})`)
    params.push(...excludeIds)
  }

  const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

  const orderExpr = `${tableAlias}.${sortColumn} ${order}, ${tableAlias}.id ${order}`
  const limitExpr = limit !== undefined && Number.isFinite(limit) ? ` LIMIT ${limit | 0}` : ''

  return {
    where,
    params,
    orderExpr,
    limitExpr,
  }
}

export async function queryFileCount(db: DatabaseAdapter, opts: FileQueryOpts): Promise<number> {
  const { where, params, orderExpr, limitExpr } = buildFileRecordsQuery(opts)
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM files ${where} ORDER BY ${orderExpr}${limitExpr}`,
    ...params,
  )
  return row?.count ?? 0
}

export async function queryFileStats(
  db: DatabaseAdapter,
  opts: FileQueryOpts,
): Promise<{ count: number; totalBytes: number }> {
  const { where, params, orderExpr, limitExpr } = buildFileRecordsQuery(opts)
  const row = await db.getFirstAsync<{ count: number; totalBytes: number }>(
    `SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as totalBytes FROM files ${where} ORDER BY ${orderExpr}${limitExpr}`,
    ...params,
  )
  return { count: row?.count ?? 0, totalBytes: row?.totalBytes ?? 0 }
}

export async function queryFiles(db: DatabaseAdapter, opts: FileQueryOpts): Promise<FileRecord[]> {
  const { where, params, orderExpr, limitExpr } = buildFileRecordsQuery(opts, 'f')

  const joined = await db.getAllAsync<
    FileRecordRow &
      LocalObjectRefRow & {
        objectId: string
        objectCreatedAt: number
        objectUpdatedAt: number
      }
  >(
    `SELECT f.id, f.name, f.size, f.createdAt, f.updatedAt, f.type, f.kind, f.localId, f.hash, f.addedAt, f.thumbForId, f.thumbSize, f.trashedAt, f.deletedAt, f.lostReason,
            o.fileId as fileId, o.indexerURL as indexerURL, o.id as objectId,
            o.createdAt as objectCreatedAt, o.updatedAt as objectUpdatedAt
     FROM files f
     LEFT JOIN objects o ON o.fileId = f.id
     ${where}
     ORDER BY ${orderExpr}${limitExpr}`,
    ...params,
  )

  const byId: Map<string, FileRecordRow> = new Map()
  const objectsById: Map<string, LocalObjectRef[]> = new Map()

  for (const r of joined) {
    if (!byId.has(r.id)) {
      byId.set(r.id, r)
    }
    if (r.fileId && r.indexerURL) {
      const arr = objectsById.get(r.id) || []
      arr.push(
        localObjectRefFromStorageRow({
          ...r,
          id: r.objectId,
          createdAt: r.objectCreatedAt,
          updatedAt: r.objectUpdatedAt,
        }),
      )
      objectsById.set(r.id, arr)
    }
  }

  return Array.from(byId.values()).map((row) => {
    return transformRow(row, objectsById.get(row.id))
  })
}

export async function queryFileByObjectId(
  db: DatabaseAdapter,
  objectId: string,
  indexerURL: string,
): Promise<FileRecordRow | null> {
  return db.getFirstAsync<FileRecordRow>(
    `SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt, thumbForId, thumbSize, trashedAt, deletedAt, lostReason FROM files WHERE id IN (SELECT fileId FROM objects WHERE id = ? AND indexerURL = ?) LIMIT 1`,
    objectId,
    indexerURL,
  )
}

export async function queryFilesByLocalIds(
  db: DatabaseAdapter,
  localIds: string[],
): Promise<FileRecordRow[]> {
  if (localIds.length === 0) return []
  const ph = localIds.map(() => '?').join(',')
  return db.getAllAsync<FileRecordRow>(
    `SELECT ${FILE_ROW_COLUMNS} FROM files WHERE deletedAt IS NULL AND trashedAt IS NULL AND localId IN (${ph})`,
    ...localIds,
  )
}

export async function queryFilesByContentHashes(
  db: DatabaseAdapter,
  contentHashes: string[],
): Promise<FileRecordRow[]> {
  if (contentHashes.length === 0) return []
  const ph = contentHashes.map(() => '?').join(',')
  return db.getAllAsync<FileRecordRow>(
    `SELECT ${FILE_ROW_COLUMNS} FROM files WHERE deletedAt IS NULL AND trashedAt IS NULL AND hash IN (${ph})`,
    ...contentHashes,
  )
}

export async function queryFileByContentHash(
  db: DatabaseAdapter,
  hash: string,
): Promise<FileRecordRow | null> {
  const row = await db.getFirstAsync<FileRecordRow>(
    'SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt, thumbForId, thumbSize, trashedAt, deletedAt, lostReason FROM files WHERE deletedAt IS NULL AND trashedAt IS NULL AND hash = ?',
    hash,
  )
  if (!row) {
    logger.debug('db', 'file_not_found_by_hash', { hash })
  }
  return row
}

export async function queryFileById(
  db: DatabaseAdapter,
  id: string,
): Promise<FileRecordRow | null> {
  const row = await db.getFirstAsync<FileRecordRow>(
    'SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt, thumbForId, thumbSize, trashedAt, deletedAt, lostReason FROM files WHERE id = ?',
    id,
  )
  if (!row) {
    logger.debug('db', 'file_not_found', { id })
  }
  return row
}

export async function updateFile(
  db: DatabaseAdapter,
  update: Partial<FileRecordRow> & { id: string },
  options: {
    includeUpdatedAt?: boolean
    skipCurrentRecalc?: boolean
  } = { includeUpdatedAt: false },
): Promise<void> {
  const { id } = update
  const assignments: Record<string, string | number | boolean | null> = {}
  const updatableFields: (keyof Omit<FileRecordRow, 'tags'>)[] = [
    'name',
    'type',
    'kind',
    'size',
    'hash',
    'createdAt',
    'thumbForId',
    'thumbSize',
    'localId',
    'trashedAt',
    'deletedAt',
    'lostReason',
  ]
  if (options.includeUpdatedAt) {
    updatableFields.push('updatedAt')
  }
  for (const field of updatableFields) {
    const value = update[field]
    if (value === undefined) {
      continue
    }
    assignments[field] = value
  }

  if (update.name !== undefined) {
    assignments.nameSortKey = naturalSortKey(update.name)
  }

  if (!options.includeUpdatedAt) {
    assignments.updatedAt = Date.now()
  }

  if (!Object.keys(assignments).length) {
    return
  }

  const needsRecalc =
    !options.skipCurrentRecalc &&
    (update.name !== undefined ||
      update.trashedAt !== undefined ||
      update.deletedAt !== undefined ||
      update.updatedAt !== undefined)

  let oldRow: { name: string; directoryId: string | null } | null = null
  if (needsRecalc) {
    oldRow = await db.getFirstAsync<{
      name: string
      directoryId: string | null
    }>('SELECT name, directoryId FROM files WHERE id = ?', id)
  }

  await sql.update(db, 'files', assignments, { id })

  if (oldRow) {
    await recalculateCurrentForGroup(db, oldRow.name, oldRow.directoryId)
    if (update.name !== undefined && update.name !== oldRow.name) {
      await recalculateCurrentForGroup(db, update.name, oldRow.directoryId)
    }
  }
}

export async function updateFileDirectory(
  db: DatabaseAdapter,
  fileId: string,
  dirId: string,
): Promise<void> {
  const row = await db.getFirstAsync<{
    name: string
    directoryId: string | null
  }>('SELECT name, directoryId FROM files WHERE id = ?', fileId)
  const now = Date.now()
  await sql.update(db, 'files', { directoryId: dirId, updatedAt: now }, { id: fileId })
  if (row) {
    await recalculateCurrentForGroup(db, row.name, row.directoryId)
    await recalculateCurrentForGroup(db, row.name, dirId)
  }
}

export async function deleteFileById(db: DatabaseAdapter, id: string): Promise<void> {
  await sql.del(db, 'files', { id })
}

export async function tombstoneFiles(
  db: DatabaseAdapter,
  fileIds: string[],
  now: number,
): Promise<void> {
  if (fileIds.length === 0) return
  const ph = fileIds.map(() => '?').join(',')
  await db.runAsync(
    `UPDATE files SET deletedAt = ?, trashedAt = COALESCE(trashedAt, ?), updatedAt = ?
     WHERE id IN (${ph}) AND deletedAt IS NULL`,
    now,
    now,
    now,
    ...fileIds,
  )
}

export async function deleteThumbnailsByFileId(
  db: DatabaseAdapter,
  thumbForId: string,
): Promise<void> {
  await sql.del(db, 'files', { thumbForId })
}

export async function deleteFileAndThumbnails(db: DatabaseAdapter, id: string): Promise<void> {
  const row = await db.getFirstAsync<{
    name: string
    directoryId: string | null
    kind: string
  }>('SELECT name, directoryId, kind FROM files WHERE id = ?', id)
  await db.withTransactionAsync(async () => {
    await sql.del(db, 'files', { thumbForId: id })
    await sql.del(db, 'files', { id })
  })
  if (row?.kind === 'file') {
    await recalculateCurrentForGroup(db, row.name, row.directoryId)
  }
}

export async function deleteFilesAndThumbnails(db: DatabaseAdapter, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const ph = ids.map(() => '?').join(',')
  const rows = await db.getAllAsync<{
    name: string
    directoryId: string | null
  }>(`SELECT DISTINCT name, directoryId FROM files WHERE id IN (${ph}) AND kind = 'file'`, ...ids)
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM files WHERE thumbForId IN (${ph})`, ...ids)
    await db.runAsync(`DELETE FROM files WHERE id IN (${ph})`, ...ids)
  })
  await recalculateCurrentForGroups(db, rows)
}

export async function deleteAllFiles(db: DatabaseAdapter): Promise<void> {
  await sql.del(db, 'files')
}

export async function readFile(db: DatabaseAdapter, id: string): Promise<FileRecord | null> {
  const row = await queryFileById(db, id)
  if (!row) return null
  const objects = await queryObjectRefsForFile(db, id)
  return transformRow(row, objects)
}

export async function readFileWithObjects(
  db: DatabaseAdapter,
  id: string,
): Promise<(FileRecordRow & { objects: Record<string, LocalObject> }) | null> {
  const row = await queryFileById(db, id)
  if (!row) return null
  const objects = await queryObjectsForFile(db, id)
  return transformRow(row, objects)
}

export async function readFileByObjectId(
  db: DatabaseAdapter,
  objectId: string,
  indexerURL: string,
): Promise<FileRecord | null> {
  const row = await queryFileByObjectId(db, objectId, indexerURL)
  if (!row) return null
  const objects = await queryObjectRefsForFile(db, row.id)
  return transformRow(row, objects)
}

export async function readFileByContentHash(
  db: DatabaseAdapter,
  hash: string,
): Promise<FileRecord | null> {
  const row = await queryFileByContentHash(db, hash)
  if (!row) return null
  const objects = await queryObjectRefsForFile(db, row.id)
  return transformRow(row, objects)
}

export async function readFilesByLocalIds(
  db: DatabaseAdapter,
  localIds: string[],
): Promise<(FileRecord & { localId: string })[]> {
  const rows = await queryFilesByLocalIds(db, localIds)
  return rows.map((row) => transformRow(row)) as (FileRecord & {
    localId: string
  })[]
}

export async function readFilesByContentHashes(
  db: DatabaseAdapter,
  contentHashes: string[],
): Promise<(FileRecord & { hash: string })[]> {
  const rows = await queryFilesByContentHashes(db, contentHashes)
  return rows.map((row) => transformRow(row)) as (FileRecord & {
    hash: string
  })[]
}

export async function queryLocalOnlyFiles(
  db: DatabaseAdapter,
  indexerURL: string,
  opts: {
    limit?: number
    order?: 'ASC' | 'DESC'
    excludeIds?: string[]
  } = {},
): Promise<FileRecord[]> {
  return queryFiles(db, {
    limit: opts.limit,
    order: opts.order ?? 'ASC',
    pinned: { indexerURL, isPinned: false },
    fileExistsLocally: true,
    excludeIds: opts.excludeIds,
    includeThumbnails: true,
    includeOldVersions: true,
  })
}

export async function createFileWithLocalObject(
  db: DatabaseAdapter,
  record: Omit<FileRecord, 'objects'>,
  localObject: LocalObject,
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await insertFile(db, record)
    await insertObject(db, localObject)
  })
}

export async function updateFileWithLocalObject(
  db: DatabaseAdapter,
  update: Partial<FileRecordRow> & { id: string },
  localObject: LocalObject,
  options?: { includeUpdatedAt?: boolean },
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await updateFile(db, update, options)
    await insertObject(db, localObject)
  })
}

export async function queryLostFileCount(db: DatabaseAdapter, indexerURL: string): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM files f
     WHERE ${buildRecordFilter('f')}
     AND (
       (NOT EXISTS (SELECT 1 FROM objects s WHERE s.fileId = f.id AND s.indexerURL = ?)
        AND NOT EXISTS (SELECT 1 FROM fs fsMeta WHERE fsMeta.fileId = f.id)
        AND f.hash != '')
       OR f.lostReason IS NOT NULL
     )`,
    indexerURL,
  )
  return row?.count ?? 0
}

export async function queryLostFileStats(
  db: DatabaseAdapter,
  indexerURL: string,
): Promise<{ count: number; totalBytes: number }> {
  const row = await db.getFirstAsync<{ count: number; totalBytes: number }>(
    `SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as totalBytes FROM files f
     WHERE ${buildRecordFilter('f')}
     AND (
       (NOT EXISTS (SELECT 1 FROM objects s WHERE s.fileId = f.id AND s.indexerURL = ?)
        AND NOT EXISTS (SELECT 1 FROM fs fsMeta WHERE fsMeta.fileId = f.id)
        AND f.hash != '')
       OR f.lostReason IS NOT NULL
     )`,
    indexerURL,
  )
  return { count: row?.count ?? 0, totalBytes: row?.totalBytes ?? 0 }
}

export async function queryLostFiles(
  db: DatabaseAdapter,
  indexerURL: string,
): Promise<FileRecordRow[]> {
  return db.getAllAsync<FileRecordRow>(
    `SELECT ${FILE_ROW_COLUMNS} FROM files f
     WHERE ${buildRecordFilter('f')}
     AND (
       f.lostReason IS NOT NULL
       OR (NOT EXISTS (SELECT 1 FROM objects s WHERE s.fileId = f.id AND s.indexerURL = ?)
           AND NOT EXISTS (SELECT 1 FROM fs fsMeta WHERE fsMeta.fileId = f.id)
           AND f.hash != '')
     )
     ORDER BY f.addedAt DESC`,
    indexerURL,
  )
}

export async function queryLocalFileCount(
  db: DatabaseAdapter,
  indexerURL: string,
  localOnly: boolean,
): Promise<number> {
  return queryFileCount(db, {
    order: 'ASC',
    pinned: { indexerURL, isPinned: !localOnly },
    fileExistsLocally: true,
    includeThumbnails: true,
    includeOldVersions: true,
  })
}

export async function queryLocalFileStats(
  db: DatabaseAdapter,
  indexerURL: string,
  localOnly: boolean,
): Promise<{ count: number; totalBytes: number }> {
  return queryFileStats(db, {
    order: 'ASC',
    pinned: { indexerURL, isPinned: !localOnly },
    fileExistsLocally: true,
    includeThumbnails: true,
    includeOldVersions: true,
  })
}

export async function readFilesByIds(db: DatabaseAdapter, ids: string[]): Promise<FileRecord[]> {
  if (ids.length === 0) return []

  const byId: Map<string, FileRecordRow> = new Map()
  const objectsById: Map<string, LocalObjectRef[]> = new Map()

  const ph = ids.map(() => '?').join(',')
  const joined = await db.getAllAsync<
    FileRecordRow &
      LocalObjectRefRow & {
        objectId: string
        objectCreatedAt: number
        objectUpdatedAt: number
      }
  >(
    `SELECT f.id, f.name, f.size, f.createdAt, f.updatedAt, f.type, f.kind, f.localId, f.hash, f.addedAt, f.thumbForId, f.thumbSize, f.trashedAt, f.deletedAt, f.lostReason,
            o.fileId as fileId, o.indexerURL as indexerURL, o.id as objectId,
            o.createdAt as objectCreatedAt, o.updatedAt as objectUpdatedAt
     FROM files f
     LEFT JOIN objects o ON o.fileId = f.id
     WHERE f.id IN (${ph})`,
    ...ids,
  )

  for (const r of joined) {
    if (!byId.has(r.id)) {
      byId.set(r.id, r)
    }
    if (r.fileId && r.indexerURL) {
      const arr = objectsById.get(r.id) || []
      arr.push(
        localObjectRefFromStorageRow({
          ...r,
          id: r.objectId,
          createdAt: r.objectCreatedAt,
          updatedAt: r.objectUpdatedAt,
        }),
      )
      objectsById.set(r.id, arr)
    }
  }

  return Array.from(byId.values()).map((row) => {
    return transformRow(row, objectsById.get(row.id))
  })
}

export async function insertManyFiles(
  db: DatabaseAdapter,
  records: Omit<FileRecord, 'objects'>[],
  options?: sql.InsertOptions & { skipCurrentRecalc?: boolean },
): Promise<void> {
  if (records.length === 0) return
  await sql.insertMany(
    db,
    'files',
    records.map((r) => ({
      id: r.id,
      name: r.name,
      nameSortKey: naturalSortKey(r.name),
      size: r.size,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      type: r.type,
      kind: r.kind,
      localId: r.localId,
      hash: r.hash,
      addedAt: r.addedAt,
      thumbForId: r.thumbForId,
      thumbSize: r.thumbSize,
      trashedAt: r.trashedAt,
      deletedAt: r.deletedAt,
      lostReason: r.lostReason,
    })),
    options,
  )
  if (options?.skipCurrentRecalc) return
  const fileIds = records.filter((r) => r.kind === 'file').map((r) => r.id)
  if (fileIds.length > 0) {
    const ph = fileIds.map(() => '?').join(',')
    const groups = await db.getAllAsync<{
      name: string
      directoryId: string | null
    }>(
      `SELECT DISTINCT name, directoryId FROM files WHERE id IN (${ph}) AND kind = 'file'`,
      ...fileIds,
    )
    await recalculateCurrentForGroups(db, groups)
  }
}

const FILE_UPSERT_UPDATE_COLUMNS = [
  'name',
  'nameSortKey',
  'size',
  'type',
  'kind',
  'hash',
  'createdAt',
  'updatedAt',
  'thumbForId',
  'thumbSize',
  'trashedAt',
]

export async function upsertManyFiles(
  db: DatabaseAdapter,
  records: Omit<FileRecord, 'objects'>[],
  options?: { skipCurrentRecalc?: boolean },
): Promise<void> {
  if (records.length === 0) return
  await sql.upsertMany(
    db,
    'files',
    records.map((r) => ({
      id: r.id,
      name: r.name,
      nameSortKey: naturalSortKey(r.name),
      size: r.size,
      type: r.type,
      kind: r.kind,
      hash: r.hash,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      localId: r.localId,
      addedAt: r.addedAt,
      thumbForId: r.thumbForId,
      thumbSize: r.thumbSize,
      trashedAt: r.trashedAt,
      deletedAt: r.deletedAt,
      lostReason: r.lostReason,
    })),
    {
      conflictColumn: 'id',
      updateColumns: FILE_UPSERT_UPDATE_COLUMNS,
    },
  )
  if (options?.skipCurrentRecalc) return
  const fileIds = records.filter((r) => r.kind === 'file').map((r) => r.id)
  if (fileIds.length > 0) {
    const ph = fileIds.map(() => '?').join(',')
    const groups = await db.getAllAsync<{
      name: string
      directoryId: string | null
    }>(
      `SELECT DISTINCT name, directoryId FROM files WHERE id IN (${ph}) AND kind = 'file'`,
      ...fileIds,
    )
    await recalculateCurrentForGroups(db, groups)
  }
}

export async function updateManyFiles(
  db: DatabaseAdapter,
  updates: (Partial<FileRecordRow> & { id: string })[],
  options: {
    includeUpdatedAt?: boolean
    skipCurrentRecalc?: boolean
  } = { includeUpdatedAt: false },
): Promise<void> {
  if (updates.length === 0) return
  await db.withTransactionAsync(async () => {
    for (const update of updates) {
      await updateFile(db, update, options)
    }
  })
}

export async function deleteManyFilesByIds(db: DatabaseAdapter, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const ph = ids.map(() => '?').join(',')
  const groups = await db.getAllAsync<{
    name: string
    directoryId: string | null
  }>(`SELECT DISTINCT name, directoryId FROM files WHERE id IN (${ph}) AND kind = 'file'`, ...ids)
  await db.runAsync(`DELETE FROM files WHERE id IN (${ph})`, ...ids)
  await recalculateCurrentForGroups(db, groups)
}

export async function queryFileByName(
  db: DatabaseAdapter,
  name: string,
): Promise<FileRecordRow | null> {
  return db.getFirstAsync<FileRecordRow>(
    `SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt, thumbForId, thumbSize, trashedAt, deletedAt, lostReason
     FROM files f WHERE f.name = ? AND ${buildRecordFilter('f')}
     ORDER BY f.updatedAt DESC, f.id DESC`,
    name,
  )
}

export async function readFileByName(
  db: DatabaseAdapter,
  name: string,
): Promise<FileRecord | null> {
  const row = await queryFileByName(db, name)
  if (!row) return null
  const objects = await queryObjectRefsForFile(db, row.id)
  return transformRow(row, objects)
}

export async function queryUnuploadedFileCount(db: DatabaseAdapter): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM files f
     WHERE ${buildRecordFilter('f')}
       AND NOT EXISTS (SELECT 1 FROM objects o WHERE o.fileId = f.id)`,
  )
  return row?.count ?? 0
}

export async function queryUnuploadedFiles(
  db: DatabaseAdapter,
): Promise<{ id: string; name: string; type: string; size: number }[]> {
  return db.getAllAsync<{
    id: string
    name: string
    type: string
    size: number
  }>(
    `SELECT f.id, f.name, f.type, f.size FROM files f
     WHERE ${buildRecordFilter('f')}
       AND NOT EXISTS (SELECT 1 FROM objects o WHERE o.fileId = f.id)
     ORDER BY f.addedAt DESC`,
  )
}

export async function queryActiveFileSummaries(
  db: DatabaseAdapter,
): Promise<{ id: string; kind: string; type: string; size: number }[]> {
  return db.getAllAsync<{
    id: string
    kind: string
    type: string
    size: number
  }>(`SELECT f.id, f.kind, f.type, f.size FROM files f WHERE ${buildRecordFilter('f')}`)
}

export async function queryUploadedFileIds(
  db: DatabaseAdapter,
  indexerURL: string,
): Promise<string[]> {
  const rows = await db.getAllAsync<{ fileId: string }>(
    'SELECT DISTINCT fileId FROM objects WHERE indexerURL = ?',
    indexerURL,
  )
  return rows.map((r) => r.fileId)
}

export async function deleteLostFilesAndThumbnails(
  db: DatabaseAdapter,
  indexerURL: string,
): Promise<number> {
  return sql.processInBatches<{ id: string }>(
    db,
    `SELECT f.id FROM files f
     WHERE f.kind = 'file' AND ${buildRecordFilter('f', { includeOldVersions: true })}
     AND (
       (NOT EXISTS (SELECT 1 FROM objects s WHERE s.fileId = f.id AND s.indexerURL = ?)
        AND NOT EXISTS (SELECT 1 FROM fs fsMeta WHERE fsMeta.fileId = f.id)
        AND f.hash != '')
       OR f.lostReason IS NOT NULL
     )`,
    [indexerURL],
    500,
    async (rows) => {
      await deleteFilesAndThumbnails(
        db,
        rows.map((r) => r.id),
      )
    },
  )
}

export async function queryFileVersions(
  db: DatabaseAdapter,
  name: string,
  directoryId: string | null,
): Promise<FileRecordRow[]> {
  if (directoryId === null) {
    return db.getAllAsync<FileRecordRow>(
      `SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt, thumbForId, thumbSize, trashedAt, deletedAt, lostReason
       FROM files
       WHERE name = ?
         AND directoryId IS NULL
         AND kind = 'file'
         AND trashedAt IS NULL AND deletedAt IS NULL
       ORDER BY updatedAt DESC, id DESC`,
      name,
    )
  }
  return db.getAllAsync<FileRecordRow>(
    `SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt, thumbForId, thumbSize, trashedAt, deletedAt, lostReason
     FROM files
     WHERE name = ?
       AND directoryId = ?
       AND kind = 'file'
       AND trashedAt IS NULL AND deletedAt IS NULL
     ORDER BY updatedAt DESC, id DESC`,
    name,
    directoryId,
  )
}

/**
 * Renames all versions of a file (all records sharing the same name and
 * directory). Uses staggered updatedAt timestamps to preserve version
 * ordering: the current version gets `now`, the next gets `now - 1ms`, etc.
 * This bumps all timestamps (triggering sync-up) while keeping relative order.
 */
export async function renameAllFileVersions(
  db: DatabaseAdapter,
  currentName: string,
  directoryId: string | null,
  newName: string,
): Promise<string[]> {
  const versions = await queryFileVersions(db, currentName, directoryId)
  if (versions.length === 0) return []
  const now = Date.now()
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < versions.length; i++) {
      await db.runAsync(
        'UPDATE files SET name = ?, nameSortKey = ?, updatedAt = ? WHERE id = ?',
        newName,
        naturalSortKey(newName),
        now - i,
        versions[i].id,
      )
    }
  })
  await recalculateCurrentForGroup(db, newName, directoryId)
  return versions.map((v) => v.id)
}

/**
 * Moves all versions of a file to a new directory. Uses staggered updatedAt
 * timestamps to preserve version ordering (see renameAllFileVersions).
 */
export async function moveAllFileVersions(
  db: DatabaseAdapter,
  name: string,
  fromDirectoryId: string | null,
  toDirectoryId: string | null,
): Promise<string[]> {
  const versions = await queryFileVersions(db, name, fromDirectoryId)
  if (versions.length === 0) return []
  const now = Date.now()
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < versions.length; i++) {
      await db.runAsync(
        'UPDATE files SET directoryId = ?, updatedAt = ? WHERE id = ?',
        toDirectoryId,
        now - i,
        versions[i].id,
      )
    }
  })
  await recalculateCurrentForGroup(db, name, toDirectoryId)
  return versions.map((v) => v.id)
}

export async function trashAllFileVersions(
  db: DatabaseAdapter,
  name: string,
  directoryId: string | null,
): Promise<string[]> {
  const versions = await queryFileVersions(db, name, directoryId)
  if (versions.length === 0) return []
  await trashFilesAndThumbnails(
    db,
    versions.map((v) => v.id),
  )
  return versions.map((v) => v.id)
}

import { logger } from '@siastorage/logger'
import type { DatabaseAdapter } from '../../adapters/db'
import type { LocalObject, LocalObjectRow } from '../../encoding/localObject'
import { localObjectFromStorageRow } from '../../encoding/localObject'
import { naturalSortKey } from '../../lib/naturalSortKey'
import type { FileRecord, FileRecordRow } from '../../types/files'
import * as sql from '../sql'
import { buildLatestVersionFilter } from './library'
import { insertLocalObject, queryLocalObjectsForFile } from './localObjects'
import { trashFiles } from './trash'

export async function recalculateCurrentForGroup(
  db: DatabaseAdapter,
  name: string,
  directoryId: string | null,
): Promise<void> {
  const dirCondition =
    directoryId === null ? 'directoryId IS NULL' : 'directoryId = ?'
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
  const chunkSize = MAX_SQL_VARS
  for (let i = 0; i < fileIds.length; i += chunkSize) {
    const chunk = fileIds.slice(i, i + chunkSize)
    const placeholders = chunk.map(() => '?').join(',')
    const groupsCte = `SELECT DISTINCT name, directoryId FROM files WHERE id IN (${placeholders}) AND kind = 'file'`
    await db.runAsync(
      `UPDATE files SET current = 0
       WHERE current = 1 AND kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL
         AND id IN (
           SELECT f2.id FROM files f2
           INNER JOIN (${groupsCte}) g
             ON f2.name = g.name AND f2.directoryId IS g.directoryId
           WHERE f2.kind = 'file' AND f2.trashedAt IS NULL AND f2.deletedAt IS NULL
         )`,
      ...chunk,
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
      ...chunk,
    )
  }
}

const FILE_ROW_COLUMNS =
  'id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt, thumbForId, thumbSize, trashedAt, deletedAt, lostReason'

const MAX_SQL_VARS = 999

export async function queryFileRecordRowsByIds(
  db: DatabaseAdapter,
  ids: string[],
): Promise<Map<string, FileRecordRow>> {
  const result = new Map<string, FileRecordRow>()
  if (ids.length === 0) return result
  for (let i = 0; i < ids.length; i += MAX_SQL_VARS) {
    const chunk = ids.slice(i, i + MAX_SQL_VARS)
    const placeholders = chunk.map(() => '?').join(',')
    const rows = await db.getAllAsync<FileRecordRow>(
      `SELECT ${FILE_ROW_COLUMNS} FROM files WHERE id IN (${placeholders})`,
      ...chunk,
    )
    for (const row of rows) {
      result.set(row.id, row)
    }
  }
  return result
}

export async function queryFileRecordRowsByObjectIds(
  db: DatabaseAdapter,
  objectIds: string[],
  indexerURL: string,
): Promise<Map<string, FileRecordRow>> {
  const result = new Map<string, FileRecordRow>()
  if (objectIds.length === 0) return result
  const chunkSize = MAX_SQL_VARS - 1
  for (let i = 0; i < objectIds.length; i += chunkSize) {
    const chunk = objectIds.slice(i, i + chunkSize)
    const placeholders = chunk.map(() => '?').join(',')
    const rows = await db.getAllAsync<FileRecordRow & { objectId: string }>(
      `SELECT o.id AS objectId, f.${FILE_ROW_COLUMNS.split(', ').join(', f.')}
       FROM objects o
       JOIN files f ON f.id = o.fileId
       WHERE o.indexerURL = ? AND o.id IN (${placeholders})`,
      indexerURL,
      ...chunk,
    )
    for (const row of rows) {
      result.set(row.objectId, row)
    }
  }
  return result
}

export function transformRow(
  row: FileRecordRow,
  objects?: LocalObject[],
): FileRecord {
  const objectsMap: Record<string, LocalObject> = {}
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

export async function insertFileRecord(
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

export type FileRecordsQueryOpts = {
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
  activeOnly?: boolean
  hashEmpty?: boolean
  hashNotEmpty?: boolean
}

function buildFileRecordsQuery(
  opts: FileRecordsQueryOpts,
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
    activeOnly,
    hashEmpty,
    hashNotEmpty,
  } = opts
  const sortColumn: FileRecordCursorColumn = orderBy ?? 'createdAt'

  const params: (string | number)[] = []

  const whereClauses: string[] = []

  if (activeOnly) {
    whereClauses.push(`${tableAlias}.trashedAt IS NULL`)
    whereClauses.push(`${tableAlias}.deletedAt IS NULL`)
  }

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
      whereClauses.push(
        `EXISTS (SELECT 1 FROM fs fsMeta WHERE fsMeta.fileId = ${tableAlias}.id)`,
      )
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

  const where =
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

  const orderExpr = `${tableAlias}.${sortColumn} ${order}, ${tableAlias}.id ${order}`
  const limitExpr =
    limit !== undefined && Number.isFinite(limit) ? ` LIMIT ${limit | 0}` : ''

  return {
    where,
    params,
    orderExpr,
    limitExpr,
  }
}

export async function queryFileRecordsCount(
  db: DatabaseAdapter,
  opts: FileRecordsQueryOpts,
): Promise<number> {
  const { where, params, orderExpr, limitExpr } = buildFileRecordsQuery(opts)
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM files ${where} ORDER BY ${orderExpr}${limitExpr}`,
    ...params,
  )
  return row?.count ?? 0
}

export async function queryFileRecordsStats(
  db: DatabaseAdapter,
  opts: FileRecordsQueryOpts,
): Promise<{ count: number; totalBytes: number }> {
  const { where, params, orderExpr, limitExpr } = buildFileRecordsQuery(opts)
  const row = await db.getFirstAsync<{ count: number; totalBytes: number }>(
    `SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as totalBytes FROM files ${where} ORDER BY ${orderExpr}${limitExpr}`,
    ...params,
  )
  return { count: row?.count ?? 0, totalBytes: row?.totalBytes ?? 0 }
}

export async function queryFileRecords(
  db: DatabaseAdapter,
  opts: FileRecordsQueryOpts,
): Promise<FileRecord[]> {
  const { where, params, orderExpr, limitExpr } = buildFileRecordsQuery(
    opts,
    'f',
  )

  const joined = await db.getAllAsync<
    FileRecordRow &
      LocalObjectRow & {
        objectId: string
        objectCreatedAt: number
        objectUpdatedAt: number
      }
  >(
    `SELECT f.id, f.name, f.size, f.createdAt, f.updatedAt, f.type, f.kind, f.localId, f.hash, f.addedAt, f.thumbForId, f.thumbSize, f.trashedAt, f.deletedAt, f.lostReason,
            o.fileId as fileId, o.indexerURL as indexerURL, o.id as objectId, o.slabs as slabs,
            o.encryptedDataKey as encryptedDataKey, o.encryptedMetadataKey as encryptedMetadataKey,
            o.encryptedMetadata as encryptedMetadata, o.dataSignature as dataSignature,
            o.metadataSignature as metadataSignature, o.createdAt as objectCreatedAt, o.updatedAt as objectUpdatedAt
     FROM files f
     LEFT JOIN objects o ON o.fileId = f.id
     ${where}
     ORDER BY ${orderExpr}${limitExpr}`,
    ...params,
  )

  const byId: Map<string, FileRecordRow> = new Map()
  const objectsById: Map<string, LocalObject[]> = new Map()

  for (const r of joined) {
    if (!byId.has(r.id)) {
      byId.set(r.id, r)
    }
    if (r.fileId && r.indexerURL) {
      const arr = objectsById.get(r.id) || []
      arr.push(
        localObjectFromStorageRow({
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

export async function queryFileRecordByObjectId(
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

export async function queryFileRecordsByLocalIds(
  db: DatabaseAdapter,
  localIds: string[],
): Promise<FileRecordRow[]> {
  return db.getAllAsync<FileRecordRow>(
    `SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt, thumbForId, thumbSize, trashedAt, deletedAt, lostReason FROM files WHERE deletedAt IS NULL AND trashedAt IS NULL AND localId IN (${localIds
      .map((_) => `?`)
      .join(',')})`,
    ...localIds,
  )
}

export async function queryFileRecordsByContentHashes(
  db: DatabaseAdapter,
  contentHashes: string[],
): Promise<FileRecordRow[]> {
  return db.getAllAsync<FileRecordRow>(
    `SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt, thumbForId, thumbSize, trashedAt, deletedAt, lostReason FROM files WHERE deletedAt IS NULL AND trashedAt IS NULL AND hash IN (${contentHashes
      .map((_) => `?`)
      .join(',')})`,
    ...contentHashes,
  )
}

export async function queryFileRecordByContentHash(
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

export async function queryFileRecordById(
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

export async function updateFileRecordFields(
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
  await sql.update(
    db,
    'files',
    { directoryId: dirId, updatedAt: now },
    { id: fileId },
  )
  if (row) {
    await recalculateCurrentForGroup(db, row.name, row.directoryId)
    await recalculateCurrentForGroup(db, row.name, dirId)
  }
}

export async function deleteFileRecordById(
  db: DatabaseAdapter,
  id: string,
): Promise<void> {
  await sql.del(db, 'files', { id })
}

export async function tombstoneFileRecords(
  db: DatabaseAdapter,
  fileIds: string[],
  now: number,
): Promise<void> {
  if (fileIds.length === 0) return
  const chunkSize = MAX_SQL_VARS - 3
  for (let i = 0; i < fileIds.length; i += chunkSize) {
    const chunk = fileIds.slice(i, i + chunkSize)
    const placeholders = chunk.map(() => '?').join(',')
    await db.runAsync(
      `UPDATE files SET deletedAt = ?, trashedAt = COALESCE(trashedAt, ?), updatedAt = ?
       WHERE id IN (${placeholders}) AND deletedAt IS NULL`,
      now,
      now,
      now,
      ...chunk,
    )
  }
}

export async function deleteFileRecordsByThumbForId(
  db: DatabaseAdapter,
  thumbForId: string,
): Promise<void> {
  await sql.del(db, 'files', { thumbForId })
}

export async function deleteFileRecordAndThumbnails(
  db: DatabaseAdapter,
  id: string,
): Promise<void> {
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

export async function deleteFileRecordsAndThumbnails(
  db: DatabaseAdapter,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return
  const placeholders = ids.map(() => '?').join(',')
  const rows = await db.getAllAsync<{
    name: string
    directoryId: string | null
  }>(
    `SELECT DISTINCT name, directoryId FROM files WHERE id IN (${placeholders}) AND kind = 'file'`,
    ...ids,
  )
  await db.withTransactionAsync(async () => {
    for (const id of ids) {
      await sql.del(db, 'files', { thumbForId: id })
      await sql.del(db, 'files', { id })
    }
  })
  await recalculateCurrentForGroups(db, rows)
}

export async function deleteAllFileRecords(db: DatabaseAdapter): Promise<void> {
  await sql.del(db, 'files')
}

export async function readFileRecord(
  db: DatabaseAdapter,
  id: string,
): Promise<FileRecord | null> {
  const row = await queryFileRecordById(db, id)
  if (!row) return null
  const objects = await queryLocalObjectsForFile(db, id)
  return transformRow(row, objects)
}

export async function readFileRecordByObjectId(
  db: DatabaseAdapter,
  objectId: string,
  indexerURL: string,
): Promise<FileRecord | null> {
  const row = await queryFileRecordByObjectId(db, objectId, indexerURL)
  if (!row) return null
  const objects = await queryLocalObjectsForFile(db, row.id)
  return transformRow(row, objects)
}

export async function readFileRecordByContentHash(
  db: DatabaseAdapter,
  hash: string,
): Promise<FileRecord | null> {
  const row = await queryFileRecordByContentHash(db, hash)
  if (!row) return null
  const objects = await queryLocalObjectsForFile(db, row.id)
  return transformRow(row, objects)
}

export async function readFileRecordsByLocalIds(
  db: DatabaseAdapter,
  localIds: string[],
): Promise<(FileRecord & { localId: string })[]> {
  const rows = await queryFileRecordsByLocalIds(db, localIds)
  return rows.map((row) => transformRow(row)) as (FileRecord & {
    localId: string
  })[]
}

export async function readFileRecordsByContentHashes(
  db: DatabaseAdapter,
  contentHashes: string[],
): Promise<(FileRecord & { hash: string })[]> {
  const rows = await queryFileRecordsByContentHashes(db, contentHashes)
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
  return queryFileRecords(db, {
    limit: opts.limit,
    order: opts.order ?? 'ASC',
    pinned: { indexerURL, isPinned: false },
    fileExistsLocally: true,
    excludeIds: opts.excludeIds,
    activeOnly: true,
  })
}

export async function createFileRecordWithLocalObject(
  db: DatabaseAdapter,
  record: Omit<FileRecord, 'objects'>,
  localObject: LocalObject,
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await insertFileRecord(db, record)
    await insertLocalObject(db, localObject)
  })
}

export async function updateFileRecordWithLocalObject(
  db: DatabaseAdapter,
  update: Partial<FileRecordRow> & { id: string },
  localObject: LocalObject,
  options?: { includeUpdatedAt?: boolean },
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await updateFileRecordFields(db, update, options)
    await insertLocalObject(db, localObject)
  })
}

export async function queryLostFileCount(
  db: DatabaseAdapter,
  indexerURL: string,
): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM files f
     WHERE f.trashedAt IS NULL AND f.deletedAt IS NULL
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
     WHERE f.trashedAt IS NULL AND f.deletedAt IS NULL
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

export async function queryLocalFileCount(
  db: DatabaseAdapter,
  indexerURL: string,
  localOnly: boolean,
): Promise<number> {
  return queryFileRecordsCount(db, {
    order: 'ASC',
    pinned: { indexerURL, isPinned: !localOnly },
    fileExistsLocally: true,
    activeOnly: true,
  })
}

export async function queryLocalFileStats(
  db: DatabaseAdapter,
  indexerURL: string,
  localOnly: boolean,
): Promise<{ count: number; totalBytes: number }> {
  return queryFileRecordsStats(db, {
    order: 'ASC',
    pinned: { indexerURL, isPinned: !localOnly },
    fileExistsLocally: true,
    activeOnly: true,
  })
}

export async function readFileRecordsByIds(
  db: DatabaseAdapter,
  ids: string[],
): Promise<FileRecord[]> {
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(',')
  const joined = await db.getAllAsync<
    FileRecordRow &
      LocalObjectRow & {
        objectId: string
        objectCreatedAt: number
        objectUpdatedAt: number
      }
  >(
    `SELECT f.id, f.name, f.size, f.createdAt, f.updatedAt, f.type, f.kind, f.localId, f.hash, f.addedAt, f.thumbForId, f.thumbSize, f.trashedAt, f.deletedAt, f.lostReason,
            o.fileId as fileId, o.indexerURL as indexerURL, o.id as objectId, o.slabs as slabs,
            o.encryptedDataKey as encryptedDataKey, o.encryptedMetadataKey as encryptedMetadataKey,
            o.encryptedMetadata as encryptedMetadata, o.dataSignature as dataSignature,
            o.metadataSignature as metadataSignature, o.createdAt as objectCreatedAt, o.updatedAt as objectUpdatedAt
     FROM files f
     LEFT JOIN objects o ON o.fileId = f.id
     WHERE f.id IN (${placeholders})`,
    ...ids,
  )

  const byId: Map<string, FileRecordRow> = new Map()
  const objectsById: Map<string, LocalObject[]> = new Map()

  for (const r of joined) {
    if (!byId.has(r.id)) {
      byId.set(r.id, r)
    }
    if (r.fileId && r.indexerURL) {
      const arr = objectsById.get(r.id) || []
      arr.push(
        localObjectFromStorageRow({
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

export async function insertManyFileRecords(
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
    const placeholders = fileIds.map(() => '?').join(',')
    const groups = await db.getAllAsync<{
      name: string
      directoryId: string | null
    }>(
      `SELECT DISTINCT name, directoryId FROM files WHERE id IN (${placeholders}) AND kind = 'file'`,
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

export async function upsertManyFileRecords(
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
    const placeholders = fileIds.map(() => '?').join(',')
    const groups = await db.getAllAsync<{
      name: string
      directoryId: string | null
    }>(
      `SELECT DISTINCT name, directoryId FROM files WHERE id IN (${placeholders}) AND kind = 'file'`,
      ...fileIds,
    )
    await recalculateCurrentForGroups(db, groups)
  }
}

export async function updateManyFileRecordFields(
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
      await updateFileRecordFields(db, update, options)
    }
  })
}

export async function deleteManyFileRecordsByIds(
  db: DatabaseAdapter,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return
  const placeholders = ids.map(() => '?').join(',')
  const groups = await db.getAllAsync<{
    name: string
    directoryId: string | null
  }>(
    `SELECT DISTINCT name, directoryId FROM files WHERE id IN (${placeholders}) AND kind = 'file'`,
    ...ids,
  )
  await db.withTransactionAsync(async () => {
    for (const id of ids) {
      await deleteFileRecordById(db, id)
    }
  })
  await recalculateCurrentForGroups(db, groups)
}

export async function queryFileRecordByName(
  db: DatabaseAdapter,
  name: string,
): Promise<FileRecordRow | null> {
  return db.getFirstAsync<FileRecordRow>(
    `SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt, thumbForId, thumbSize, trashedAt, deletedAt, lostReason
     FROM files f WHERE f.name = ? AND f.kind = 'file' AND f.trashedAt IS NULL AND f.deletedAt IS NULL
       AND ${buildLatestVersionFilter('f')}
     ORDER BY f.updatedAt DESC, f.id DESC`,
    name,
  )
}

export async function readFileRecordByName(
  db: DatabaseAdapter,
  name: string,
): Promise<FileRecord | null> {
  const row = await queryFileRecordByName(db, name)
  if (!row) return null
  const objects = await queryLocalObjectsForFile(db, row.id)
  return transformRow(row, objects)
}

export async function queryUnuploadedFileCount(
  db: DatabaseAdapter,
): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM files f
     WHERE f.kind = 'file'
       AND f.trashedAt IS NULL AND f.deletedAt IS NULL
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
     WHERE f.kind = 'file'
       AND f.trashedAt IS NULL AND f.deletedAt IS NULL
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
  }>(
    'SELECT id, kind, type, size FROM files WHERE trashedAt IS NULL AND deletedAt IS NULL',
  )
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

export async function deleteLostFiles(
  db: DatabaseAdapter,
  indexerURL: string,
): Promise<string[]> {
  const lost = await db.getAllAsync<{ id: string }>(
    `SELECT f.id FROM files f
     WHERE f.trashedAt IS NULL AND f.deletedAt IS NULL
     AND (
       (NOT EXISTS (SELECT 1 FROM objects s WHERE s.fileId = f.id AND s.indexerURL = ?)
        AND NOT EXISTS (SELECT 1 FROM fs fsMeta WHERE fsMeta.fileId = f.id)
        AND f.hash != '')
       OR f.lostReason IS NOT NULL
     )`,
    indexerURL,
  )
  if (lost.length === 0) return []
  const ids = lost.map((f) => f.id)
  await deleteFileRecordsAndThumbnails(db, ids)
  return ids
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
  await trashFiles(
    db,
    versions.map((v) => v.id),
  )
  return versions.map((v) => v.id)
}

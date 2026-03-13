import { logger } from '@siastorage/logger'
import type { DatabaseAdapter } from '../../adapters/db'
import type { LocalObject, LocalObjectRow } from '../../encoding/localObject'
import { localObjectFromStorageRow } from '../../encoding/localObject'
import type { FileRecord, FileRecordRow } from '../../types/files'
import * as sql from '../sql'
import { insertLocalObject, queryLocalObjectsForFile } from './localObjects'

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
    objects: objectsMap,
  }
}

export async function insertFileRecord(
  db: DatabaseAdapter,
  fileRecord: Omit<FileRecord, 'objects'>,
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
  } = fileRecord
  await sql.insert(db, 'files', {
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
  })
}

type FileRecordCursorColumn = 'createdAt' | 'updatedAt'

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
  } = opts
  const sortColumn: FileRecordCursorColumn = orderBy ?? 'createdAt'

  const params: (string | number)[] = []

  const whereClauses: string[] = []

  if (activeOnly) {
    whereClauses.push(`${tableAlias}.trashedAt IS NULL`)
    whereClauses.push(`${tableAlias}.deletedAt IS NULL`)
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
    `SELECT f.id, f.name, f.size, f.createdAt, f.updatedAt, f.type, f.kind, f.localId, f.hash, f.addedAt, f.thumbForId, f.thumbSize, f.trashedAt, f.deletedAt,
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
    `SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt, thumbForId, thumbSize, trashedAt, deletedAt FROM files WHERE id IN (SELECT fileId FROM objects WHERE id = ? AND indexerURL = ?) LIMIT 1`,
    objectId,
    indexerURL,
  )
}

export async function queryFileRecordsByLocalIds(
  db: DatabaseAdapter,
  localIds: string[],
): Promise<FileRecordRow[]> {
  return db.getAllAsync<FileRecordRow>(
    `SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt, thumbForId, thumbSize, trashedAt, deletedAt FROM files WHERE deletedAt IS NULL AND trashedAt IS NULL AND localId IN (${localIds
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
    `SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt, thumbForId, thumbSize, trashedAt, deletedAt FROM files WHERE deletedAt IS NULL AND trashedAt IS NULL AND hash IN (${contentHashes
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
    'SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt, thumbForId, thumbSize, trashedAt, deletedAt FROM files WHERE deletedAt IS NULL AND trashedAt IS NULL AND hash = ?',
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
    'SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt, thumbForId, thumbSize, trashedAt, deletedAt FROM files WHERE id = ?',
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
  options: { includeUpdatedAt?: boolean } = { includeUpdatedAt: false },
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

  if (!options.includeUpdatedAt) {
    assignments.updatedAt = Date.now()
  }

  if (!Object.keys(assignments).length) {
    return
  }

  await sql.update(db, 'files', assignments, { id })
}

export async function updateFileDirectory(
  db: DatabaseAdapter,
  fileId: string,
  dirId: string,
): Promise<void> {
  const now = Date.now()
  await sql.update(
    db,
    'files',
    { directoryId: dirId, updatedAt: now },
    { id: fileId },
  )
}

export async function deleteFileRecordById(
  db: DatabaseAdapter,
  id: string,
): Promise<void> {
  await sql.del(db, 'files', { id })
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
  await db.withTransactionAsync(async () => {
    await sql.del(db, 'files', { thumbForId: id })
    await sql.del(db, 'files', { id })
  })
}

export async function deleteFileRecordsAndThumbnails(
  db: DatabaseAdapter,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return
  await db.withTransactionAsync(async () => {
    for (const id of ids) {
      await sql.del(db, 'files', { thumbForId: id })
      await sql.del(db, 'files', { id })
    }
  })
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
  return queryFileRecordsCount(db, {
    order: 'ASC',
    pinned: { indexerURL, isPinned: false },
    fileExistsLocally: false,
    activeOnly: true,
  })
}

export async function queryLostFileStats(
  db: DatabaseAdapter,
  indexerURL: string,
): Promise<{ count: number; totalBytes: number }> {
  return queryFileRecordsStats(db, {
    order: 'ASC',
    pinned: { indexerURL, isPinned: false },
    fileExistsLocally: false,
    activeOnly: true,
  })
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
    `SELECT f.id, f.name, f.size, f.createdAt, f.updatedAt, f.type, f.kind, f.localId, f.hash, f.addedAt, f.thumbForId, f.thumbSize, f.trashedAt, f.deletedAt,
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
): Promise<void> {
  if (records.length === 0) return
  await db.withTransactionAsync(async () => {
    for (const record of records) {
      await insertFileRecord(db, record)
    }
  })
}

export async function updateManyFileRecordFields(
  db: DatabaseAdapter,
  updates: (Partial<FileRecordRow> & { id: string })[],
  options: { includeUpdatedAt?: boolean } = { includeUpdatedAt: false },
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
  await db.withTransactionAsync(async () => {
    for (const id of ids) {
      await deleteFileRecordById(db, id)
    }
  })
}

export async function queryFileRecordByName(
  db: DatabaseAdapter,
  name: string,
): Promise<FileRecordRow | null> {
  return db.getFirstAsync<FileRecordRow>(
    `SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt, thumbForId, thumbSize, trashedAt, deletedAt
     FROM files WHERE name = ? AND kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL`,
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
  const lost = await queryFileRecords(db, {
    order: 'ASC',
    pinned: { indexerURL, isPinned: false },
    fileExistsLocally: false,
    activeOnly: true,
  })
  if (lost.length === 0) return []
  await deleteFileRecordsAndThumbnails(
    db,
    lost.map((f) => f.id),
  )
  return lost.map((f) => f.id)
}

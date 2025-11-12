import {
  type LocalObject,
  localObjectFromStorageRow,
} from '../encoding/localObject'
import { upsertLocalObject, readLocalObjectsForFile } from './localObjects'
import { logger } from '../lib/logger'
import { db, withTransactionLock } from '../db'
import useSWR from 'swr'
import { createGetterAndSWRHook } from '../lib/selectors'
import { LocalObjectRow } from '../encoding/localObject'
import { getIndexerURL } from './settings'
import { librarySwr } from './library'
import { removeEmptyValues } from '../lib/object'
import { keysOf } from '../lib/types'

/** Valid thumbnail sizes in pixels. */
export type ThumbSize = 64 | 512
export const ThumbSizes: ThumbSize[] = [64, 512]

/** Fields that are stored in both the local database and the indexer metadata. */
export type FileMetadata = {
  name: string
  type: string
  size: number
  hash: string
  // Hash of the original file content this thumbnail is for.
  thumbForHash?: string
  // Size of the thumbnail in pixels.
  thumbSize?: ThumbSize
  createdAt: number
  updatedAt: number
}

export const fileMetadataKeys = keysOf<FileMetadata>()([
  'name',
  'type',
  'size',
  'hash',
  'createdAt',
  'updatedAt',
  'thumbForHash',
  'thumbSize',
])

/** Fields that are stored only in the local database. */
export type FileLocalMetadata = {
  id: string
  localId: string | null
  addedAt: number
}

export const fileLocalMetadataKeys = keysOf<FileLocalMetadata>()([
  'id',
  'localId',
  'addedAt',
])

export type FileRecordRow = FileMetadata & FileLocalMetadata

export const fileRecordRowKeys = keysOf<FileRecordRow>()([
  ...fileMetadataKeys,
  ...fileLocalMetadataKeys,
])

export type FileRecord = FileRecordRow & {
  objects: Record<string, LocalObject>
}

export async function createFileRecord(
  fileRecord: Omit<FileRecord, 'objects'>,
  triggerUpdate: boolean = true
): Promise<void> {
  const {
    id,
    name,
    size,
    createdAt,
    updatedAt,
    type,
    localId,
    hash,
    addedAt,
    thumbForHash,
    thumbSize,
  } = fileRecord
  await db().runAsync(
    'INSERT INTO files (id, name, size, createdAt, updatedAt, type, localId, hash, addedAt, thumbForHash, thumbSize) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    name,
    size,
    createdAt,
    updatedAt,
    type,
    localId,
    hash,
    addedAt,
    thumbForHash ?? null,
    thumbSize ?? null
  )
  if (triggerUpdate) {
    await librarySwr.triggerChange()
  }
}

export async function createManyFileRecords(
  files: FileRecord[]
): Promise<void> {
  await withTransactionLock(async () => {
    for (const fr of files) {
      await createFileRecord(fr, false)
    }
  })
  if (files.length > 0) {
    await librarySwr.triggerChange()
  }
}

type FileRecordCursorColumn = 'createdAt' | 'updatedAt'

type FileRecordsQueryOpts = {
  limit?: number
  after?: { value: number; id: string }
  order: 'ASC' | 'DESC'
  orderBy?: FileRecordCursorColumn
  pinned?: {
    indexerURL: string
    isPinned: boolean
  }
}

function buildFileRecordsQuery(
  opts: FileRecordsQueryOpts,
  tableAlias: string = 'files'
): {
  where: string
  params: (string | number)[]
  orderExpr: string
  limitExpr: string
} {
  const { limit, after, order, pinned, orderBy } = opts
  const sortColumn: FileRecordCursorColumn = orderBy ?? 'createdAt'

  const params: (string | number)[] = []

  let where = ''
  if (after) {
    if (order === 'ASC') {
      where = `WHERE (${tableAlias}.${sortColumn} > ?) OR (${tableAlias}.${sortColumn} = ? AND ${tableAlias}.id > ?)`
    } else {
      where = `WHERE (${tableAlias}.${sortColumn} < ?) OR (${tableAlias}.${sortColumn} = ? AND ${tableAlias}.id < ?)`
    }
    params.push(after.value, after.value, after.id)
  }

  if (pinned) {
    const existsExpr = pinned.isPinned
      ? `EXISTS (SELECT 1 FROM objects s WHERE s.fileId = ${tableAlias}.id AND s.indexerURL = ?)`
      : `NOT EXISTS (SELECT 1 FROM objects s WHERE s.fileId = ${tableAlias}.id AND s.indexerURL = ?)`
    where = where ? `${where} AND ${existsExpr}` : `WHERE ${existsExpr}`
    params.push(pinned.indexerURL)
  }

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

export async function readAllFileRecordsCount(
  opts: FileRecordsQueryOpts
): Promise<number> {
  const { where, params, orderExpr, limitExpr } = buildFileRecordsQuery(opts)

  const row = await db().getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM files ${where} ORDER BY ${orderExpr}${limitExpr}`,
    ...params
  )
  return row?.count ?? 0
}

export async function readAllFileRecords(
  opts: FileRecordsQueryOpts
): Promise<FileRecord[]> {
  const { where, params, orderExpr, limitExpr } = buildFileRecordsQuery(
    opts,
    'f'
  )

  const joined = await db().getAllAsync<
    FileRecordRow &
      LocalObjectRow & {
        objectId: string
        objectCreatedAt: number
        objectUpdatedAt: number
      }
  >(
    `SELECT f.id, f.name, f.size, f.createdAt, f.updatedAt, f.type, f.localId, f.hash, f.addedAt, f.thumbForHash, f.thumbSize,
            o.fileId as fileId, o.indexerURL as indexerURL, o.id as objectId, o.slabs as slabs,
            o.encryptedMasterKey as encryptedMasterKey, o.encryptedMetadata as encryptedMetadata,
            o.signature as signature, o.createdAt as objectCreatedAt, o.updatedAt as objectUpdatedAt
     FROM files f
     LEFT JOIN objects o ON o.fileId = f.id
     ${where}
     ORDER BY ${orderExpr}${limitExpr}`,
    ...params
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
        })
      )
      objectsById.set(r.id, arr)
    }
  }

  return Array.from(byId.values()).map((row) => {
    return transformRow(row, objectsById.get(row.id))
  })
}

export async function readFileRecordByObjectId(
  objectId: string
): Promise<FileRecord | null> {
  const row = await db().getFirstAsync<FileRecordRow>(
    `SELECT id, name, size, createdAt, updatedAt, type, localId, hash FROM files WHERE id IN (SELECT fileId FROM objects WHERE id = ?) LIMIT 1`,
    objectId
  )
  if (!row) return null
  const objects = await readLocalObjectsForFile(row.id)
  return transformRow(row, objects)
}

export async function readFileRecordsByLocalIds(localIds: string[]) {
  const rows = await db().getAllAsync<FileRecordRow>(
    `SELECT id, name, size, createdAt, updatedAt, type, localId, hash FROM files WHERE localId IN (${localIds
      .map((_) => `?`)
      .join(',')})`,
    ...localIds
  )
  return rows.map((row) => transformRow(row)) as (FileRecord & {
    localId: string
  })[]
}

export async function readFileRecordsByContentHashes(contentHashes: string[]) {
  const rows = await db().getAllAsync<FileRecordRow>(
    `SELECT id, name, size, createdAt, updatedAt, type, localId, hash FROM files WHERE hash IN (${contentHashes
      .map((_) => `?`)
      .join(',')})`,
    ...contentHashes
  )
  return rows.map((row) => transformRow(row)) as (FileRecord & {
    hash: string
  })[]
}

export async function readFileRecordByContentHash(hash: string) {
  const row = await db().getFirstAsync<FileRecordRow>(
    'SELECT id, name, size, createdAt, updatedAt, type, localId, hash FROM files WHERE hash = ?',
    hash
  )
  if (!row) {
    logger.log('[db] file not found by hash', hash)
    return null
  }
  const objects = await readLocalObjectsForFile(row.id)
  return transformRow(row, objects)
}

export async function readFileRecord(id: string): Promise<FileRecord | null> {
  const row = await db().getFirstAsync<FileRecordRow>(
    'SELECT id, name, size, createdAt, updatedAt, type, localId, hash, addedAt, thumbForHash, thumbSize FROM files WHERE id = ?',
    id
  )
  if (!row) {
    logger.log('[db] file not found', id)
    return null
  }
  const objects = await readLocalObjectsForFile(id)
  return transformRow(row, objects)
}

/** Updates a file record. Ignores any empty values. */
export async function updateFileRecord(
  update: Partial<FileRecordRow> & { id: string },
  triggerUpdate: boolean = true
): Promise<void> {
  const { id } = update
  const sets: string[] = []
  const params: (string | number | null)[] = []
  const updatableFields: (keyof FileRecordRow)[] = [
    'name',
    'type',
    'size',
    'hash',
    'createdAt',
    'updatedAt',
    'thumbForHash',
    'thumbSize',
    'localId',
  ]
  for (const field of updatableFields) {
    const nonEmptyUpdate = removeEmptyValues(update)
    if (field in nonEmptyUpdate) {
      sets.push(`${field} = ?`)
      params.push(nonEmptyUpdate[field as keyof typeof nonEmptyUpdate] ?? null)
    }
  }

  if (sets.length === 0) {
    return
  }

  if (!sets.includes('updatedAt = ?')) {
    sets.push('updatedAt = ?')
    params.push(Date.now())
  }

  const sql = `UPDATE files SET ${sets.join(', ')} WHERE id = ?`
  await db().runAsync(sql, ...params, id)
  if (triggerUpdate) {
    await librarySwr.triggerChange()
  }
}

export async function updateManyFileRecords(
  updates: Partial<FileRecordRow> & { id: string }[]
): Promise<void> {
  await withTransactionLock(async () => {
    for (const update of updates) {
      await updateFileRecord(update, false)
    }
  })
  if (updates.length > 0) {
    await librarySwr.triggerChange()
  }
}

export async function deleteFileRecord(
  id: string,
  triggerUpdate: boolean = true
): Promise<void> {
  await db().runAsync('DELETE FROM files WHERE id = ?', id)
  if (triggerUpdate) {
    await librarySwr.triggerChange()
  }
}

/** Delete an original file and all its associated thumbnails. */
export async function deleteFileRecordAndThumbnails(id: string): Promise<void> {
  const original = await readFileRecord(id)
  if (!original) return
  const hash = original.hash
  await withTransactionLock(async () => {
    await db().runAsync('DELETE FROM files WHERE thumbForHash = ?', hash)
    await db().runAsync('DELETE FROM files WHERE id = ?', id)
  })
  await librarySwr.triggerChange()
}

export async function deleteAllFileRecords(): Promise<void> {
  await db().runAsync('DELETE FROM files')
}

/** Commit a file record and a local object in a single transaction. */
export async function createFileRecordWithLocalObject(
  fileRecord: Omit<FileRecord, 'objects'>,
  localObject: LocalObject
): Promise<void> {
  try {
    await withTransactionLock(async () => {
      await createFileRecord(fileRecord, false)
      await upsertLocalObject(localObject, false)
    })
    await librarySwr.triggerChange()
  } catch (e) {
    logger.log('[createFileRecordWithLocalObject] error', e)
    throw e
  }
}

/** Update a file record and a local object in a single transaction. */
export async function updateFileRecordWithLocalObject(
  fileRecord: Omit<FileRecord, 'objects'>,
  localObject: LocalObject
): Promise<void> {
  try {
    await withTransactionLock(async () => {
      await updateFileRecord(fileRecord, false)
      await upsertLocalObject(localObject, false)
    })
    await librarySwr.triggerChange()
  } catch (e) {
    logger.log('[updateFileRecordWithLocalObject] error', e)
    throw e
  }
}

export function transformRow(
  row: FileRecordRow,
  objects?: LocalObject[]
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
    localId: row.localId,
    hash: row.hash,
    thumbForHash: row.thumbForHash ?? undefined,
    thumbSize: row.thumbSize ?? undefined,
    objects: objectsMap,
  }
}

export function useFileCountAll() {
  return useSWR(librarySwr.getKey('count'), () =>
    readAllFileRecordsCount({
      limit: undefined,
      after: undefined,
      order: 'ASC',
    })
  )
}

export const [getFilesLocalOnly, useFilesLocalOnly] = createGetterAndSWRHook(
  librarySwr.getKey('localOnly'),
  async ({ limit, order }: { limit?: number; order: 'ASC' | 'DESC' }) => {
    const currentIndexerURL = await getIndexerURL()
    return readAllFileRecords({
      limit,
      after: undefined,
      order,
      pinned: {
        indexerURL: currentIndexerURL,
        isPinned: false,
      },
    })
  }
)

export const [getFileCountLocalOnly, useFileCountLocalOnly] =
  createGetterAndSWRHook(librarySwr.getKey('localOnlyCount'), async () => {
    const currentIndexerURL = await getIndexerURL()
    return readAllFileRecordsCount({
      order: 'ASC',
      pinned: { indexerURL: currentIndexerURL, isPinned: false },
    })
  })

export function useFileDetails(id: string) {
  return useSWR(librarySwr.getKey(id), () => readFileRecord(id))
}

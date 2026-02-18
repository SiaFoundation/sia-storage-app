import useSWR from 'swr'
import { db, withTransactionLock } from '../db'
import { sqlDelete, sqlInsert, sqlUpdate } from '../db/sql'
import {
  type LocalObject,
  type LocalObjectRow,
  localObjectFromStorageRow,
} from '../encoding/localObject'
import { logger } from '../lib/logger'
import { createGetterAndSWRHook } from '../lib/selectors'
import { swrCacheBy } from '../lib/swr'
import { keysOf } from '../lib/types'
import {
  invalidateCacheLibraryAllStats,
  invalidateCacheLibraryLists,
  libraryStats,
} from './librarySwr'
import { readLocalObjectsForFile, upsertLocalObject } from './localObjects'
import { getIndexerURL } from './settings'

/** Single file record keyed by file ID. */
const fileByIdCache = swrCacheBy()

/** Valid thumbnail sizes in pixels. */
export type ThumbSize = 64 | 512
export const ThumbSizes: ThumbSize[] = [64, 512]

export type FileKind = 'file' | 'thumb'

/** Fields that are stored in both the local database and the indexer metadata. */
export type FileMetadata = {
  id: string
  name: string
  type: string
  kind: FileKind
  size: number
  hash: string
  thumbForId?: string
  thumbSize?: ThumbSize
  tags?: string[]
  directory?: string
  createdAt: number
  updatedAt: number
}

// tags and directory are synced via object metadata but stored in separate
// tables locally, not in the files table.
export const fileMetadataKeys = keysOf<
  Omit<FileMetadata, 'tags' | 'directory'>
>()([
  'id',
  'name',
  'type',
  'kind',
  'size',
  'hash',
  'createdAt',
  'updatedAt',
  'thumbForId',
  'thumbSize',
])

/** Fields that are stored only in the local database. */
export type FileLocalMetadata = {
  localId: string | null
  addedAt: number
}

export const fileLocalMetadataKeys = keysOf<FileLocalMetadata>()([
  'localId',
  'addedAt',
])

export type FileRecordRow = Omit<FileMetadata, 'tags' | 'directory'> &
  FileLocalMetadata

export const fileRecordRowKeys = keysOf<FileRecordRow>()([
  ...fileMetadataKeys,
  ...fileLocalMetadataKeys,
])

export type FileRecord = FileRecordRow & {
  objects: Record<string, LocalObject>
}

export async function createFileRecord(
  fileRecord: Omit<FileRecord, 'objects'>,
  triggerUpdate: boolean = true,
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
  } = fileRecord
  await sqlInsert('files', {
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
  })
  if (triggerUpdate) {
    await invalidateCacheLibraryAllStats()
    invalidateCacheLibraryLists()
  }
}

export async function createManyFileRecords(
  files: FileRecord[],
): Promise<void> {
  await withTransactionLock(async () => {
    for (const fr of files) {
      await createFileRecord(fr, false)
    }
  })
  if (files.length > 0) {
    await invalidateCacheLibraryAllStats()
    invalidateCacheLibraryLists()
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
  fileExistsLocally?: boolean
  excludeIds?: string[]
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
  } = opts
  const sortColumn: FileRecordCursorColumn = orderBy ?? 'createdAt'

  const params: (string | number)[] = []

  const whereClauses: string[] = []

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

export async function readAllFileRecordsCount(
  opts: FileRecordsQueryOpts,
): Promise<number> {
  const { where, params, orderExpr, limitExpr } = buildFileRecordsQuery(opts)

  const row = await db().getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM files ${where} ORDER BY ${orderExpr}${limitExpr}`,
    ...params,
  )
  return row?.count ?? 0
}

export async function readAllFileRecordsStats(
  opts: FileRecordsQueryOpts,
): Promise<{ count: number; totalBytes: number }> {
  const { where, params, orderExpr, limitExpr } = buildFileRecordsQuery(opts)

  const row = await db().getFirstAsync<{ count: number; totalBytes: number }>(
    `SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as totalBytes FROM files ${where} ORDER BY ${orderExpr}${limitExpr}`,
    ...params,
  )
  return { count: row?.count ?? 0, totalBytes: row?.totalBytes ?? 0 }
}

export async function readAllFileRecords(
  opts: FileRecordsQueryOpts,
): Promise<FileRecord[]> {
  const { where, params, orderExpr, limitExpr } = buildFileRecordsQuery(
    opts,
    'f',
  )

  const joined = await db().getAllAsync<
    FileRecordRow &
      LocalObjectRow & {
        objectId: string
        objectCreatedAt: number
        objectUpdatedAt: number
      }
  >(
    `SELECT f.id, f.name, f.size, f.createdAt, f.updatedAt, f.type, f.kind, f.localId, f.hash, f.addedAt, f.thumbForId, f.thumbSize,
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

export async function readFileRecordByObjectId(
  objectId: string,
  indexerURL: string,
): Promise<FileRecord | null> {
  const row = await db().getFirstAsync<FileRecordRow>(
    `SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt, thumbForId, thumbSize FROM files WHERE id IN (SELECT fileId FROM objects WHERE id = ? AND indexerURL = ?) LIMIT 1`,
    objectId,
    indexerURL,
  )
  if (!row) return null
  const objects = await readLocalObjectsForFile(row.id)
  return transformRow(row, objects)
}

export async function readFileRecordsByLocalIds(localIds: string[]) {
  const rows = await db().getAllAsync<FileRecordRow>(
    `SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt, thumbForId, thumbSize FROM files WHERE localId IN (${localIds
      .map((_) => `?`)
      .join(',')})`,
    ...localIds,
  )
  return rows.map((row) => transformRow(row)) as (FileRecord & {
    localId: string
  })[]
}

export async function readFileRecordsByContentHashes(contentHashes: string[]) {
  const rows = await db().getAllAsync<FileRecordRow>(
    `SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt, thumbForId, thumbSize FROM files WHERE hash IN (${contentHashes
      .map((_) => `?`)
      .join(',')})`,
    ...contentHashes,
  )
  return rows.map((row) => transformRow(row)) as (FileRecord & {
    hash: string
  })[]
}

export async function readFileRecordByContentHash(hash: string) {
  const row = await db().getFirstAsync<FileRecordRow>(
    'SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt, thumbForId, thumbSize FROM files WHERE hash = ?',
    hash,
  )
  if (!row) {
    logger.debug('db', 'file_not_found_by_hash', { hash })
    return null
  }
  const objects = await readLocalObjectsForFile(row.id)
  return transformRow(row, objects)
}

export async function readFileRecord(id: string): Promise<FileRecord | null> {
  const row = await db().getFirstAsync<FileRecordRow>(
    'SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt, thumbForId, thumbSize FROM files WHERE id = ?',
    id,
  )
  if (!row) {
    logger.debug('db', 'file_not_found', { id })
    return null
  }
  const objects = await readLocalObjectsForFile(id)
  return transformRow(row, objects)
}

/** Updates a file record. Ignores any empty values. */
export async function updateFileRecord(
  update: Partial<FileRecordRow> & { id: string },
  triggerUpdate: boolean = true,
  options: { includeUpdatedAt?: boolean } = { includeUpdatedAt: false },
): Promise<void> {
  const { id } = update
  const assignments: Record<string, string | number | boolean | null> = {}
  const updatableFields: (keyof FileRecordRow)[] = [
    'name',
    'type',
    'kind',
    'size',
    'hash',
    'createdAt',
    'thumbForId',
    'thumbSize',
    'localId',
  ]
  if (options.includeUpdatedAt) {
    updatableFields.push('updatedAt')
  }
  for (const field of updatableFields) {
    const value = update[field]
    if (value === undefined || value === null) {
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

  await sqlUpdate('files', assignments, { id })
  if (triggerUpdate) {
    invalidateCacheLibraryLists()
  }
}

export async function updateManyFileRecords(
  updates: Partial<FileRecordRow> & { id: string }[],
  options: { includeUpdatedAt?: boolean } = { includeUpdatedAt: false },
): Promise<void> {
  await withTransactionLock(async () => {
    for (const update of updates) {
      await updateFileRecord(update, false, options)
    }
  })
  if (updates.length > 0) {
    invalidateCacheLibraryLists()
  }
}

export async function deleteFileRecord(
  id: string,
  triggerUpdate: boolean = true,
): Promise<void> {
  await sqlDelete('files', { id })
  if (triggerUpdate) {
    await invalidateCacheLibraryAllStats()
    invalidateCacheLibraryLists()
  }
}

export async function deleteManyFileRecords(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await withTransactionLock(async () => {
    for (const id of ids) {
      await deleteFileRecord(id, false)
    }
  })
  await invalidateCacheLibraryAllStats()
  invalidateCacheLibraryLists()
}

// TODO: User-initiated file delete should remove the file record and all
// local objects across every indexer. Currently we only connect to a single
// indexer, so this isn't an issue yet. When multi-indexer support is added,
// the delete-file flow needs to iterate all indexers.

/** Delete an original file and all its associated thumbnails. */
export async function deleteFileRecordAndThumbnails(id: string): Promise<void> {
  await withTransactionLock(async () => {
    await sqlDelete('files', { thumbForId: id })
    await sqlDelete('files', { id })
  })
  await invalidateCacheLibraryAllStats()
  invalidateCacheLibraryLists()
}

/** Delete multiple files and all their associated thumbnails. */
export async function deleteManyFileRecordsAndThumbnails(
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return
  await withTransactionLock(async () => {
    for (const id of ids) {
      await sqlDelete('files', { thumbForId: id })
      await sqlDelete('files', { id })
    }
  })
  await invalidateCacheLibraryAllStats()
  invalidateCacheLibraryLists()
}

export async function deleteAllFileRecords(): Promise<void> {
  await sqlDelete('files')
}

/** Commit a file record and a local object in a single transaction. */
export async function createFileRecordWithLocalObject(
  fileRecord: Omit<FileRecord, 'objects'>,
  localObject: LocalObject,
  triggerUpdate: boolean = true,
): Promise<void> {
  try {
    await withTransactionLock(async () => {
      await createFileRecord(fileRecord, false)
      await upsertLocalObject(localObject, false)
    })
    if (triggerUpdate) {
      await invalidateCacheLibraryAllStats()
      invalidateCacheLibraryLists()
    }
  } catch (e) {
    logger.error('db', 'create_file_record_error', { error: e as Error })
    throw e
  }
}

/** Update a file record and a local object in a single transaction. */
export async function updateFileRecordWithLocalObject(
  fileRecord: Omit<FileRecord, 'objects'>,
  localObject: LocalObject,
  options: { includeUpdatedAt?: boolean } = { includeUpdatedAt: false },
  triggerUpdate: boolean = true,
): Promise<void> {
  try {
    await withTransactionLock(async () => {
      await updateFileRecord(fileRecord, false, options)
      await upsertLocalObject(localObject, false)
    })
    if (triggerUpdate) {
      await invalidateCacheLibraryAllStats()
      invalidateCacheLibraryLists()
    }
  } catch (e) {
    logger.error('db', 'update_file_record_error', { error: e as Error })
    throw e
  }
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
    objects: objectsMap,
  }
}

export function useFileCountAll() {
  return useSWR(libraryStats.key('count'), () =>
    readAllFileRecordsCount({
      limit: undefined,
      after: undefined,
      order: 'ASC',
    }),
  )
}

export function useFileStatsAll() {
  return useSWR(libraryStats.key('stats'), () =>
    readAllFileRecordsStats({
      limit: undefined,
      after: undefined,
      order: 'ASC',
    }),
  )
}

export const [getFilesLocalOnly, useFilesLocalOnly] = createGetterAndSWRHook(
  libraryStats.key('localOnly'),
  async ({
    limit,
    order,
    orderBy,
    excludeIds,
  }: {
    limit?: number
    order: 'ASC' | 'DESC'
    orderBy?: FileRecordCursorColumn
    excludeIds?: string[]
  }) => {
    const currentIndexerURL = await getIndexerURL()
    return readAllFileRecords({
      limit,
      after: undefined,
      order,
      orderBy,
      excludeIds,
      pinned: {
        indexerURL: currentIndexerURL,
        isPinned: false,
      },
      fileExistsLocally: true,
    })
  },
)

export const [getFileCountLost, useFileCountLost] = createGetterAndSWRHook(
  libraryStats.key('lostCount'),
  async () => {
    const currentIndexerURL = await getIndexerURL()
    return readAllFileRecordsCount({
      order: 'ASC',
      pinned: {
        indexerURL: currentIndexerURL,
        isPinned: false,
      },
      fileExistsLocally: false,
    })
  },
)

export const [getFileStatsLost, useFileStatsLost] = createGetterAndSWRHook(
  libraryStats.key('lostStats'),
  async () => {
    const currentIndexerURL = await getIndexerURL()
    return readAllFileRecordsStats({
      order: 'ASC',
      pinned: {
        indexerURL: currentIndexerURL,
        isPinned: false,
      },
      fileExistsLocally: false,
    })
  },
)

export const [getFileCountLocal, useFileCountLocal] = createGetterAndSWRHook(
  libraryStats.key('localCount'),
  async ({ localOnly }: { localOnly: boolean }) => {
    const currentIndexerURL = await getIndexerURL()
    return readAllFileRecordsCount({
      order: 'ASC',
      pinned: {
        indexerURL: currentIndexerURL,
        isPinned: !localOnly,
      },
      fileExistsLocally: true,
    })
  },
)

export const [getFileStatsLocal, useFileStatsLocal] = createGetterAndSWRHook(
  libraryStats.key('localStats'),
  async ({ localOnly }: { localOnly: boolean }) => {
    const currentIndexerURL = await getIndexerURL()
    return readAllFileRecordsStats({
      order: 'ASC',
      pinned: {
        indexerURL: currentIndexerURL,
        isPinned: !localOnly,
      },
      fileExistsLocally: true,
    })
  },
)

export function useFileDetails(id: string) {
  return useSWR(fileByIdCache.key(id), () => readFileRecord(id))
}

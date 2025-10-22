import { LocalObject, localObjectFromStorageRow } from '../encoding/localObject'
import { readLocalObjectsForFile } from './localObjects'
import { logger } from '../lib/logger'
import { db } from '../db'
import useSWR from 'swr'
import { createGetterAndSWRHook } from '../lib/selectors'
import { LocalObjectRow } from '../encoding/localObject'
import { getIndexerURL } from './settings'
import { librarySwr } from './library'

export type FileRecordRow = {
  id: string
  fileName: string | null
  fileSize: number | null
  createdAt: number
  updatedAt: number
  fileType: string | null
  localId: string | null
  contentHash: string | null
}

export type FileRecord = FileRecordRow & {
  objects: Record<string, LocalObject>
}

export async function createFileRecord(
  fileRecord: Omit<FileRecord, 'objects'>,
  triggerUpdate: boolean = true
): Promise<void> {
  const {
    id,
    fileName,
    fileSize,
    createdAt,
    updatedAt,
    fileType,
    localId,
    contentHash,
  } = fileRecord
  await db().runAsync(
    'INSERT INTO files (id, fileName, fileSize, createdAt, updatedAt, fileType, localId, contentHash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    fileName,
    fileSize,
    createdAt,
    updatedAt,
    fileType,
    localId,
    contentHash
  )
  if (triggerUpdate) {
    await librarySwr.triggerChange()
  }
}

export async function createManyFileRecords(
  files: FileRecord[]
): Promise<void> {
  await db().withTransactionAsync(async () => {
    for (const fr of files) {
      await createFileRecord(fr, false)
    }
  })
  if (files.length > 0) {
    await librarySwr.triggerChange()
  }
}

function buildFileRecordsQuery(
  opts: {
    limit?: number
    after?: { createdAt: number; id: string }
    order: 'ASC' | 'DESC'
    pinned?: {
      indexerURL: string
      isPinned: boolean
    }
  },
  tableAlias: string = 'files'
): {
  where: string
  params: (string | number)[]
  orderExpr: string
  limitExpr: string
} {
  const { limit, after, order, pinned } = opts

  const params: (string | number)[] = []

  let where = ''
  if (after) {
    if (order === 'ASC') {
      where = `WHERE (${tableAlias}.createdAt > ?) OR (${tableAlias}.createdAt = ? AND ${tableAlias}.id > ?)`
    } else {
      where = `WHERE (${tableAlias}.createdAt < ?) OR (${tableAlias}.createdAt = ? AND ${tableAlias}.id < ?)`
    }
    params.push(after.createdAt, after.createdAt, after.id)
  }

  if (pinned) {
    const existsExpr = pinned.isPinned
      ? `EXISTS (SELECT 1 FROM objects s WHERE s.fileId = ${tableAlias}.id AND s.indexerURL = ?)`
      : `NOT EXISTS (SELECT 1 FROM objects s WHERE s.fileId = ${tableAlias}.id AND s.indexerURL = ?)`
    where = where ? `${where} AND ${existsExpr}` : `WHERE ${existsExpr}`
    params.push(pinned.indexerURL)
  }

  const orderExpr = `${tableAlias}.createdAt ${order}, ${tableAlias}.id ${order}`
  const limitExpr =
    limit !== undefined && Number.isFinite(limit) ? ` LIMIT ${limit | 0}` : ''

  return {
    where,
    params,
    orderExpr,
    limitExpr,
  }
}

export async function readAllFileRecordsCount(opts: {
  limit?: number
  after?: { createdAt: number; id: string }
  order: 'ASC' | 'DESC'
  pinned?: {
    indexerURL: string
    isPinned: boolean
  }
}): Promise<number> {
  const { where, params, orderExpr, limitExpr } = buildFileRecordsQuery(opts)

  const row = await db().getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM files ${where} ORDER BY ${orderExpr}${limitExpr}`,
    ...params
  )
  return row?.count ?? 0
}

export async function readAllFileRecords(opts: {
  limit?: number
  after?: { createdAt: number; id: string }
  order: 'ASC' | 'DESC'
  pinned?: {
    indexerURL: string
    isPinned: boolean
  }
}): Promise<FileRecord[]> {
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
    `SELECT f.id, f.fileName, f.fileSize, f.createdAt, f.updatedAt, f.fileType, f.localId, f.contentHash,
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

  return Array.from(byId.values()).map((row) =>
    transformRow(row, objectsById.get(row.id))
  )
}

export async function readFileRecordByObjectId(
  objectId: string
): Promise<FileRecord | null> {
  const row = await db().getFirstAsync<FileRecordRow>(
    `SELECT id, fileName, fileSize, createdAt, updatedAt, fileType, localId, contentHash FROM files WHERE id IN (SELECT fileId FROM objects WHERE id = ?) LIMIT 1`,
    objectId
  )
  if (!row) return null
  const objects = await readLocalObjectsForFile(row.id)
  return transformRow(row, objects)
}

export async function readFileRecordsByLocalIds(localIds: string[]) {
  const rows = await db().getAllAsync<FileRecordRow>(
    `SELECT id, fileName, fileSize, createdAt, updatedAt, fileType, localId, contentHash FROM files WHERE localId IN (${localIds
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
    `SELECT id, fileName, fileSize, createdAt, updatedAt, fileType, localId, contentHash FROM files WHERE contentHash IN (${contentHashes
      .map((_) => `?`)
      .join(',')})`,
    ...contentHashes
  )
  return rows.map((row) => transformRow(row)) as (FileRecord & {
    contentHash: string
  })[]
}

export async function readFileRecord(id: string): Promise<FileRecord | null> {
  const row = await db().getFirstAsync<FileRecordRow>(
    'SELECT id, fileName, fileSize, createdAt, updatedAt, fileType, localId, contentHash FROM files WHERE id = ?',
    id
  )
  if (!row) {
    logger.log('[db] file not found', id)
    return null
  }
  const objects = await readLocalObjectsForFile(id)
  return transformRow(row, objects)
}

export async function updateFileRecord(
  update: Partial<FileRecordRow> & { id: string },
  triggerUpdate: boolean = true
): Promise<void> {
  const { id } = update
  const sets: string[] = []
  const params: (string | number | null)[] = []
  const updatableFields = [
    'fileName',
    'fileSize',
    'createdAt',
    'updatedAt',
    'fileType',
    'localId',
    'contentHash',
  ]
  for (const field of updatableFields) {
    if (field in update) {
      sets.push(`${field} = ?`)
      params.push(update[field as keyof typeof update] ?? null)
    }
  }

  if (sets.length === 0) {
    return
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
  await db().withTransactionAsync(async () => {
    for (const update of updates) {
      await updateFileRecord(update, false)
    }
  })
  if (updates.length > 0) {
    await librarySwr.triggerChange()
  }
}

export async function deleteFileRecord(id: string): Promise<void> {
  await db().runAsync('DELETE FROM files WHERE id = ?', id)
  await librarySwr.triggerChange()
}

export async function deleteAllFileRecords(): Promise<void> {
  await db().runAsync('DELETE FROM files')
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
    fileName: row.fileName,
    fileSize: row.fileSize,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    fileType: row.fileType,
    localId: row.localId,
    contentHash: row.contentHash,
    objects: objectsMap,
  }
}

export function useFileCount() {
  return useSWR(librarySwr.getKey('count'), () =>
    readAllFileRecordsCount({
      limit: undefined,
      after: undefined,
      order: 'ASC',
    })
  )
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

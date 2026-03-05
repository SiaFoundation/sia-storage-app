import type { DatabaseAdapter } from '../../adapters/db'
import type { LocalObject, LocalObjectRow } from '../../encoding/localObject'
import {
  localObjectFromStorageRow,
  localObjectToStorageRow,
} from '../../encoding/localObject'
import * as sql from '../sql'

export async function queryLocalObjectsForFile(
  db: DatabaseAdapter,
  fileId: string,
): Promise<LocalObject[]> {
  const rows = await db.getAllAsync<LocalObjectRow>(
    `SELECT id, fileId, indexerURL, slabs, encryptedDataKey, encryptedMetadataKey, encryptedMetadata, dataSignature, metadataSignature, createdAt, updatedAt
     FROM objects WHERE fileId = ?`,
    fileId,
  )
  return rows.map(localObjectFromStorageRow)
}

export async function insertLocalObject(
  db: DatabaseAdapter,
  object: LocalObject,
): Promise<void> {
  const e = localObjectToStorageRow(object)
  await sql.insert(
    db,
    'objects',
    {
      fileId: e.fileId,
      indexerURL: e.indexerURL,
      id: e.id,
      slabs: e.slabs,
      encryptedDataKey: e.encryptedDataKey,
      encryptedMetadataKey: e.encryptedMetadataKey,
      encryptedMetadata: e.encryptedMetadata,
      dataSignature: e.dataSignature,
      metadataSignature: e.metadataSignature,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    },
    { conflictClause: 'OR REPLACE' },
  )
}

export async function deleteLocalObjectById(
  db: DatabaseAdapter,
  objectId: string,
  indexerURL: string,
): Promise<void> {
  await sql.del(db, 'objects', { id: objectId, indexerURL })
}

export async function countLocalObjectsForFile(
  db: DatabaseAdapter,
  fileId: string,
): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM objects WHERE fileId = ?',
    fileId,
  )
  return row?.count ?? 0
}

export async function deleteLocalObjectsByFileId(
  db: DatabaseAdapter,
  fileId: string,
): Promise<void> {
  await sql.del(db, 'objects', { fileId })
}

export async function queryLocalObjectsForFiles(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<Record<string, LocalObject[]>> {
  if (fileIds.length === 0) return {}
  const placeholders = fileIds.map(() => '?').join(',')
  const rows = await db.getAllAsync<LocalObjectRow>(
    `SELECT id, fileId, indexerURL, slabs, encryptedDataKey, encryptedMetadataKey, encryptedMetadata, dataSignature, metadataSignature, createdAt, updatedAt
     FROM objects WHERE fileId IN (${placeholders})`,
    ...fileIds,
  )
  const map: Record<string, LocalObject[]> = {}
  for (const r of rows) {
    const lo = localObjectFromStorageRow(r)
    if (!map[r.fileId]) map[r.fileId] = []
    map[r.fileId].push(lo)
  }
  return map
}

export async function deleteManyLocalObjectsByFileIds(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<void> {
  if (fileIds.length === 0) return
  for (const fileId of fileIds) {
    await deleteLocalObjectsByFileId(db, fileId)
  }
}

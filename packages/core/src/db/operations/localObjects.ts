import type { DatabaseAdapter } from '../../adapters/db'
import type { LocalObject, LocalObjectRow } from '../../encoding/localObject'
import { localObjectFromStorageRow, localObjectToStorageRow } from '../../encoding/localObject'
import * as sql from '../sql'

export async function queryObjectsForFile(
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

export async function insertObject(db: DatabaseAdapter, object: LocalObject): Promise<void> {
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

export async function deleteObject(
  db: DatabaseAdapter,
  objectId: string,
  indexerURL: string,
): Promise<void> {
  await sql.del(db, 'objects', { id: objectId, indexerURL })
}

export async function countObjectsForFile(db: DatabaseAdapter, fileId: string): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM objects WHERE fileId = ?',
    fileId,
  )
  return row?.count ?? 0
}

export async function deleteObjectsForFile(db: DatabaseAdapter, fileId: string): Promise<void> {
  await sql.del(db, 'objects', { fileId })
}

export async function queryObjectsForFiles(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<Record<string, LocalObject[]>> {
  if (fileIds.length === 0) return {}
  const ph = fileIds.map(() => '?').join(',')
  const rows = await db.getAllAsync<LocalObjectRow>(
    `SELECT id, fileId, indexerURL, slabs, encryptedDataKey, encryptedMetadataKey, encryptedMetadata, dataSignature, metadataSignature, createdAt, updatedAt
     FROM objects WHERE fileId IN (${ph})`,
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

export async function insertManyObjects(
  db: DatabaseAdapter,
  objects: LocalObject[],
): Promise<void> {
  if (objects.length === 0) return
  const rows = objects.map((o) => {
    const e = localObjectToStorageRow(o)
    return {
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
    }
  })
  await sql.insertMany(db, 'objects', rows, { conflictClause: 'OR REPLACE' })
}

export async function deleteManyObjectsByIds(
  db: DatabaseAdapter,
  objectIds: string[],
  indexerURL: string,
): Promise<void> {
  if (objectIds.length === 0) return
  const ph = objectIds.map(() => '?').join(',')
  await db.runAsync(
    `DELETE FROM objects WHERE indexerURL = ? AND id IN (${ph})`,
    indexerURL,
    ...objectIds,
  )
}

export async function queryFilesWithNoObjects(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<string[]> {
  if (fileIds.length === 0) return []
  const ph = fileIds.map(() => '?').join(',')
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM files WHERE id IN (${ph})
     AND NOT EXISTS (SELECT 1 FROM objects WHERE fileId = files.id)`,
    ...fileIds,
  )
  return rows.map((row) => row.id)
}

export async function deleteManyObjectsForFiles(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<void> {
  if (fileIds.length === 0) return
  for (const fileId of fileIds) {
    await deleteObjectsForFile(db, fileId)
  }
}

import { db } from '../db'
import {
  type LocalObject,
  type LocalObjectRow,
  localObjectFromStorageRow,
  localObjectToStorageRow,
} from '../encoding/localObject'
import { librarySwr } from './library'

export async function readLocalObjectsForFile(
  fileId: string
): Promise<LocalObject[]> {
  const rows = await db().getAllAsync<LocalObjectRow>(
    `SELECT id, fileId, indexerURL, slabs, encryptedMasterKey, encryptedMetadata, signature, createdAt, updatedAt
     FROM objects WHERE fileId = ?`,
    fileId
  )
  return rows.map(localObjectFromStorageRow)
}

export async function upsertLocalObject(
  object: LocalObject,
  triggerUpdate: boolean = true
): Promise<void> {
  const e = localObjectToStorageRow(object)
  await db().runAsync(
    `INSERT OR REPLACE INTO objects (fileId, indexerURL, id, slabs, encryptedMasterKey, encryptedMetadata, signature, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    e.fileId,
    e.indexerURL,
    e.id,
    e.slabs,
    e.encryptedMasterKey,
    e.encryptedMetadata,
    e.signature,
    e.createdAt,
    e.updatedAt
  )
  if (triggerUpdate) {
    await librarySwr.triggerChange()
  }
}

export async function deleteLocalObjects(fileId: string): Promise<void> {
  await db().runAsync(`DELETE FROM objects WHERE fileId = ?`, fileId)
  await librarySwr.triggerChange()
}

export async function readLocalObjectsForFiles(
  fileIds: string[]
): Promise<Record<string, LocalObject[]>> {
  if (fileIds.length === 0) return {}
  const placeholders = fileIds.map(() => '?').join(',')
  const rows = await db().getAllAsync<LocalObjectRow>(
    `SELECT id, fileId, indexerURL, slabs, encryptedMasterKey, encryptedMetadata, signature, createdAt, updatedAt
     FROM objects WHERE fileId IN (${placeholders})`,
    ...fileIds
  )
  const map: Record<string, LocalObject[]> = {}
  for (const r of rows) {
    const lo = localObjectFromStorageRow(r)
    if (!map[r.fileId]) map[r.fileId] = []
    map[r.fileId].push(lo)
  }
  return map
}

import { db } from '../db'
import { sqlDelete, sqlInsert } from '../db/sql'
import {
  type LocalObject,
  type LocalObjectRow,
  localObjectFromStorageRow,
  localObjectToStorageRow,
} from '../encoding/localObject'
import { librarySwr } from './librarySwr'

export async function readLocalObjectsForFile(
  fileId: string,
): Promise<LocalObject[]> {
  const rows = await db().getAllAsync<LocalObjectRow>(
    `SELECT id, fileId, indexerURL, slabs, encryptedDataKey, encryptedMetadataKey, encryptedMetadata, dataSignature, metadataSignature, createdAt, updatedAt
     FROM objects WHERE fileId = ?`,
    fileId,
  )
  return rows.map(localObjectFromStorageRow)
}

export async function upsertLocalObject(
  object: LocalObject,
  triggerUpdate: boolean = true,
): Promise<void> {
  const e = localObjectToStorageRow(object)
  await sqlInsert(
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
  if (triggerUpdate) {
    await librarySwr.triggerChange()
  }
}

export async function deleteLocalObjects(
  fileId: string,
  triggerUpdate: boolean = true,
): Promise<void> {
  await sqlDelete('objects', { fileId })
  if (triggerUpdate) {
    await librarySwr.triggerChange()
  }
}

export async function deleteManyLocalObjects(fileIds: string[]): Promise<void> {
  if (fileIds.length === 0) return
  for (const fileId of fileIds) {
    await deleteLocalObjects(fileId, false)
  }
  await librarySwr.triggerChange()
}

export async function readLocalObjectsForFiles(
  fileIds: string[],
): Promise<Record<string, LocalObject[]>> {
  if (fileIds.length === 0) return {}
  const placeholders = fileIds.map(() => '?').join(',')
  const rows = await db().getAllAsync<LocalObjectRow>(
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

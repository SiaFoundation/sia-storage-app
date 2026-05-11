import type { DatabaseAdapter } from '../../adapters/db'
import type {
  LocalObject,
  LocalObjectRef,
  LocalObjectRefRow,
  LocalObjectRow,
} from '../../encoding/localObject'
import {
  localObjectFromStorageRow,
  localObjectRefFromStorageRow,
  localObjectToStorageRow,
} from '../../encoding/localObject'
import * as sql from '../sql'

const OBJECT_REF_COLUMNS = 'id, fileId, indexerURL, createdAt, updatedAt'

const OBJECT_ALL_COLUMNS = `${OBJECT_REF_COLUMNS}, encryptedDataKey, encryptedMetadataKey, encryptedMetadata, dataSignature, metadataSignature, slabs`

export async function queryObjectRefsForFile(
  db: DatabaseAdapter,
  fileId: string,
): Promise<LocalObjectRef[]> {
  const rows = await db.getAllAsync<LocalObjectRefRow>(
    `SELECT ${OBJECT_REF_COLUMNS} FROM objects WHERE fileId = ?`,
    fileId,
  )
  return rows.map(localObjectRefFromStorageRow)
}

export async function queryObjectsForFile(
  db: DatabaseAdapter,
  fileId: string,
): Promise<LocalObject[]> {
  const rows = await db.getAllAsync<LocalObjectRow>(
    `SELECT ${OBJECT_ALL_COLUMNS} FROM objects WHERE fileId = ?`,
    fileId,
  )
  return rows.map(localObjectFromStorageRow)
}

// Columns updated on a (indexerURL, id) conflict. needsSyncUp is added only when
// the caller sets it (upload); sync-down omits it to preserve a pending flag.
const OBJECT_UPSERT_COLUMNS = [
  'fileId',
  'slabs',
  'encryptedDataKey',
  'encryptedMetadataKey',
  'encryptedMetadata',
  'dataSignature',
  'metadataSignature',
  'createdAt',
  'updatedAt',
]

function objectStorageRow(object: LocalObject, needsSyncUp: 0 | 1) {
  const e = localObjectToStorageRow(object)
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
    needsSyncUp,
  }
}

// Create/re-upload always inserts the object dirty, so the next sync-up pass reconciles it.
export async function insertObject(db: DatabaseAdapter, object: LocalObject): Promise<void> {
  await sql.insert(db, 'objects', objectStorageRow(object, 1), { conflictClause: 'OR REPLACE' })
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

export async function queryObjectRefsForFiles(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<Record<string, LocalObjectRef[]>> {
  if (fileIds.length === 0) return {}
  const ph = fileIds.map(() => '?').join(',')
  const rows = await db.getAllAsync<LocalObjectRefRow>(
    `SELECT ${OBJECT_REF_COLUMNS} FROM objects WHERE fileId IN (${ph})`,
    ...fileIds,
  )
  const map: Record<string, LocalObjectRef[]> = {}
  for (const r of rows) {
    const lo = localObjectRefFromStorageRow(r)
    if (!map[r.fileId]) map[r.fileId] = []
    map[r.fileId].push(lo)
  }
  return map
}

export async function queryObjectsForFiles(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<Record<string, LocalObject[]>> {
  if (fileIds.length === 0) return {}
  const ph = fileIds.map(() => '?').join(',')
  const rows = await db.getAllAsync<LocalObjectRow>(
    `SELECT ${OBJECT_ALL_COLUMNS} FROM objects WHERE fileId IN (${ph})`,
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

/**
 * Upsert objects (metadata refreshed on conflict). `setNeedsSyncUp`: upload passes
 * true; sync-down omits it to preserve a pending dirty flag.
 */
export async function upsertManyObjects(
  db: DatabaseAdapter,
  objects: LocalObject[],
  options?: { setNeedsSyncUp?: boolean },
): Promise<void> {
  if (objects.length === 0) return
  const rows = objects.map((o) => objectStorageRow(o, options?.setNeedsSyncUp ? 1 : 0))
  const updateColumns =
    options?.setNeedsSyncUp === undefined
      ? OBJECT_UPSERT_COLUMNS
      : [...OBJECT_UPSERT_COLUMNS, 'needsSyncUp']
  await sql.upsertMany(db, 'objects', rows, { conflictColumn: 'indexerURL, id', updateColumns })
}

/** Flag every object of the given files dirty (local mutation entry point). */
export async function flagObjectsForFiles(db: DatabaseAdapter, fileIds: string[]): Promise<void> {
  if (fileIds.length === 0) return
  const ph = fileIds.map(() => '?').join(',')
  await db.runAsync(`UPDATE objects SET needsSyncUp = 1 WHERE fileId IN (${ph})`, ...fileIds)
}

/**
 * Compare-and-swap clear: clears the flag only if the file's edit clock
 * (files.updatedAt) still matches the value observed before the sync round-trip,
 * so an edit that landed mid-round-trip keeps the object flagged for the next
 * pass. Resolution is updatedAt's millisecond; a second edit within the same
 * millisecond can clear with that edit unpushed.
 */
export async function clearObjectIfUnchanged(
  db: DatabaseAdapter,
  objectId: string,
  indexerURL: string,
  expectedFileUpdatedAt: number,
): Promise<void> {
  await db.runAsync(
    `UPDATE objects SET needsSyncUp = 0
     WHERE id = ? AND indexerURL = ?
       AND (SELECT updatedAt FROM files WHERE files.id = objects.fileId) = ?`,
    objectId,
    indexerURL,
    expectedFileUpdatedAt,
  )
}

/** Clear the flag on specific objects (sync-down remote-newer winners). */
export async function clearObjectsNeedsSyncUp(
  db: DatabaseAdapter,
  indexerURL: string,
  objectIds: string[],
): Promise<void> {
  if (objectIds.length === 0) return
  const ph = objectIds.map(() => '?').join(',')
  await db.runAsync(
    `UPDATE objects SET needsSyncUp = 0 WHERE indexerURL = ? AND id IN (${ph})`,
    indexerURL,
    ...objectIds,
  )
}

/** Flag every object dirty (the advanced "resync metadata" escape hatch). */
export async function markAllObjectsNeedsSyncUp(db: DatabaseAdapter): Promise<void> {
  await db.runAsync(`UPDATE objects SET needsSyncUp = 1`)
}

export type SyncUpObjectRow = {
  objectId: string
  fileId: string
  fileName: string
  fileUpdatedAt: number
  deletedAt: number | null
}

/**
 * Dirty objects pinned to the given indexer (one row per push target, so LIMIT
 * bounds work items exactly). Carries the file's edit clock for the CAS clear
 * and deletedAt to route delete-vs-push; the metadata payload is read per row
 * via getMetadataForSync.
 */
export async function querySyncUpObjects(
  db: DatabaseAdapter,
  indexerURL: string,
  limit: number,
): Promise<SyncUpObjectRow[]> {
  return db.getAllAsync<SyncUpObjectRow>(
    `SELECT o.id AS objectId, o.fileId AS fileId, f.name AS fileName,
            f.updatedAt AS fileUpdatedAt, f.deletedAt AS deletedAt
     FROM objects o JOIN files f ON f.id = o.fileId
     WHERE o.indexerURL = ? AND o.needsSyncUp = 1
     ORDER BY o.id
     LIMIT ?`,
    indexerURL,
    limit,
  )
}

export async function countSyncUpObjects(db: DatabaseAdapter, indexerURL: string): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM objects WHERE indexerURL = ? AND needsSyncUp = 1`,
    indexerURL,
  )
  return row?.count ?? 0
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

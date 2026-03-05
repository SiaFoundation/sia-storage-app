import type { DatabaseAdapter } from '../../adapters/db'
import * as sql from '../sql'

export type FsMetaRow = {
  fileId: string
  size: number
  addedAt: number
  usedAt: number
}

export async function readFsFileMetadata(
  db: DatabaseAdapter,
  fileId: string,
): Promise<FsMetaRow | null> {
  return db.getFirstAsync<FsMetaRow>(
    'SELECT fileId, size, addedAt, usedAt FROM fs WHERE fileId = ?',
    fileId,
  )
}

export async function upsertFsFileMetadata(
  db: DatabaseAdapter,
  row: FsMetaRow,
): Promise<void> {
  await sql.insert(
    db,
    'fs',
    {
      fileId: row.fileId,
      size: row.size,
      addedAt: row.addedAt,
      usedAt: row.usedAt,
    },
    { conflictClause: 'OR REPLACE' },
  )
}

export async function updateFsFileMetadataUsedAt(
  db: DatabaseAdapter,
  fileId: string,
  usedAt: number = Date.now(),
): Promise<void> {
  await sql.update(db, 'fs', { usedAt }, { fileId })
}

export async function deleteFsFileMetadata(
  db: DatabaseAdapter,
  fileId: string,
): Promise<void> {
  await sql.del(db, 'fs', { fileId })
}

export async function deleteFsFileMetadataBatch(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<void> {
  if (fileIds.length === 0) return
  const placeholders = fileIds.map(() => '?').join(',')
  await db.runAsync(
    `DELETE FROM fs WHERE fileId IN (${placeholders})`,
    ...fileIds,
  )
}

export async function calcFsFilesMetadataTotalSize(
  db: DatabaseAdapter,
): Promise<number> {
  const result = await db.getFirstAsync<{ total: number }>(
    'SELECT COALESCE(SUM(size), 0) AS total FROM fs',
  )
  return result?.total ?? 0
}

import type { DatabaseAdapter } from '../../adapters/db'
import * as sql from '../sql'

export type FsMetaRow = {
  fileId: string
  size: number
  addedAt: number
  usedAt: number
}

export async function readFsMeta(db: DatabaseAdapter, fileId: string): Promise<FsMetaRow | null> {
  return db.getFirstAsync<FsMetaRow>(
    'SELECT fileId, size, addedAt, usedAt FROM fs WHERE fileId = ?',
    fileId,
  )
}

export async function upsertFsMeta(db: DatabaseAdapter, row: FsMetaRow): Promise<void> {
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

export async function updateFsMetaUsedAt(
  db: DatabaseAdapter,
  fileId: string,
  usedAt: number = Date.now(),
): Promise<void> {
  await sql.update(db, 'fs', { usedAt }, { fileId })
}

export async function deleteFsMeta(db: DatabaseAdapter, fileId: string): Promise<void> {
  await sql.del(db, 'fs', { fileId })
}

export async function deleteManyFsMeta(db: DatabaseAdapter, fileIds: string[]): Promise<void> {
  if (fileIds.length === 0) return
  const ph = fileIds.map(() => '?').join(',')
  await db.runAsync(`DELETE FROM fs WHERE fileId IN (${ph})`, ...fileIds)
}

// LRU pass: only current originals. Thumbnails are never evicted by LRU —
// regenerating a current thumb is wasted work and causes UI flicker. Non-
// current and trashed rows are handled by the dedicated pre-passes.
export async function queryEvictionCandidates(
  db: DatabaseAdapter,
  thresholdUsedAt: number,
  limit: number,
): Promise<{ fileId: string; size: number; type: string }[]> {
  return db.getAllAsync<{ fileId: string; size: number; type: string }>(
    `SELECT fs.fileId, fs.size, f.type FROM fs
     JOIN files f ON f.id = fs.fileId
     WHERE f.kind = 'file' AND f.current = 1
       AND f.trashedAt IS NULL AND f.deletedAt IS NULL
       AND fs.usedAt <= ?
       AND EXISTS (
         SELECT 1 FROM objects o WHERE o.fileId = fs.fileId
       )
     ORDER BY fs.usedAt ASC, fs.fileId ASC
     LIMIT ?`,
    thresholdUsedAt,
    limit,
  )
}

// Non-current pass: superseded files (current=0) and the thumbnails that
// belong to them (matched via thumbForId). Current files' thumbs are never
// included here — only thumbs whose parent is itself non-current.
export async function queryNonCurrentCachedFiles(
  db: DatabaseAdapter,
  thresholdUsedAt: number,
  limit: number,
): Promise<{ fileId: string; size: number; type: string }[]> {
  return db.getAllAsync<{ fileId: string; size: number; type: string }>(
    `SELECT fs.fileId, fs.size, f.type FROM fs
     JOIN files f ON f.id = fs.fileId
     WHERE f.trashedAt IS NULL AND f.deletedAt IS NULL
       AND (
         (f.kind = 'file' AND f.current = 0)
         OR (f.kind = 'thumb' AND EXISTS (
           SELECT 1 FROM files o
           WHERE o.id = f.thumbForId
             AND o.kind = 'file'
             AND o.current = 0
             AND o.trashedAt IS NULL
             AND o.deletedAt IS NULL
         ))
       )
       AND fs.usedAt <= ?
       AND EXISTS (SELECT 1 FROM objects o WHERE o.fileId = fs.fileId)
     ORDER BY fs.usedAt ASC, fs.fileId ASC
     LIMIT ?`,
    thresholdUsedAt,
    limit,
  )
}

export async function queryTrashedCachedFiles(
  db: DatabaseAdapter,
  limit: number,
): Promise<{ fileId: string; size: number; type: string }[]> {
  return db.getAllAsync<{ fileId: string; size: number; type: string }>(
    `SELECT fs.fileId, fs.size, f.type FROM fs
     JOIN files f ON f.id = fs.fileId
     WHERE f.trashedAt IS NOT NULL
       AND f.deletedAt IS NULL
       AND EXISTS (SELECT 1 FROM objects o WHERE o.fileId = fs.fileId)
     ORDER BY fs.fileId ASC
     LIMIT ?`,
    limit,
  )
}

export async function queryOrphanedFileIds(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<Set<string>> {
  if (fileIds.length === 0) return new Set()
  const rows = await db.getAllAsync<{ fileId: string }>(
    `SELECT value AS fileId FROM json_each(?)
     WHERE NOT EXISTS (
       SELECT 1 FROM fs WHERE fs.fileId = value
     ) OR NOT EXISTS (
       SELECT 1 FROM files WHERE files.id = value AND files.deletedAt IS NULL
     )`,
    JSON.stringify(fileIds),
  )
  return new Set(rows.map((r) => r.fileId))
}

export async function queryFsMetaTotalSize(db: DatabaseAdapter): Promise<number> {
  const result = await db.getFirstAsync<{ total: number }>(
    'SELECT COALESCE(SUM(size), 0) AS total FROM fs',
  )
  return result?.total ?? 0
}

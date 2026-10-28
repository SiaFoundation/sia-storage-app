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

/**
 * Stored type of each live (non-tombstoned) file among `fileIds`. Lets the
 * orphan sweep tell bytes at a stale extension, which it must move, from
 * bytes nothing references, which it deletes.
 */
export async function queryLiveFileTypes(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<Map<string, string>> {
  if (fileIds.length === 0) return new Map()
  const rows = await db.getAllAsync<{ id: string; type: string }>(
    `SELECT files.id AS id, files.type AS type FROM json_each(?)
     JOIN files ON files.id = value
     WHERE files.deletedAt IS NULL`,
    JSON.stringify(fileIds),
  )
  return new Map(rows.map((r) => [r.id, r.type]))
}

/** One cached copy an eviction pass may remove. */
export type EvictionRow = { fileId: string; size: number; type: string; usedAt: number }

/**
 * Where a pass stopped reading. A pass advances it past every row it tried,
 * whether the removal succeeded or not, so a row whose removal keeps failing
 * is read once per pass instead of on every batch.
 */
export type EvictionCursor = { usedAt: number; fileId: string }

/** Keyset condition for rows ordered by (usedAt, fileId), with its parameters. */
function afterCursor(after: EvictionCursor | null): {
  clause: string
  params: (string | number)[]
} {
  if (!after) return { clause: '', params: [] }
  return {
    clause: 'AND (fs.usedAt, fs.fileId) > (?, ?)',
    params: [after.usedAt, after.fileId],
  }
}

// LRU pass: only current originals. Thumbnails are never evicted by LRU —
// regenerating a current thumb is wasted work and causes UI flicker. Non-
// current and trashed rows are handled by the dedicated pre-passes.
//
// This query and the trashed pre-pass query below require an object on
// `indexerURL`, the indexer the uploader targets. The uploader reads only local
// copies, so a file whose objects are all on another indexer would never reach
// the current one if its copy were evicted. A trashed file counts because a
// restore makes it current again.
export async function queryEvictionCandidates(
  db: DatabaseAdapter,
  indexerURL: string,
  thresholdUsedAt: number,
  after: EvictionCursor | null,
  limit: number,
): Promise<EvictionRow[]> {
  const cursor = afterCursor(after)
  return db.getAllAsync<EvictionRow>(
    `SELECT fs.fileId, fs.size, f.type, fs.usedAt FROM fs
     JOIN files f ON f.id = fs.fileId
     WHERE f.kind = 'file' AND f.current = 1
       AND f.trashedAt IS NULL AND f.deletedAt IS NULL
       AND fs.usedAt <= ?
       AND EXISTS (
         SELECT 1 FROM objects o WHERE o.fileId = fs.fileId AND o.indexerURL = ?
       )
       ${cursor.clause}
     ORDER BY fs.usedAt ASC, fs.fileId ASC
     LIMIT ?`,
    thresholdUsedAt,
    indexerURL,
    ...cursor.params,
    limit,
  )
}

// Non-current pass: superseded files (current=0) and the thumbnails that
// belong to them (matched via thumbForId). Current files' thumbs are never
// included here — only thumbs whose parent is itself non-current.
//
// An object on any indexer is enough. The uploader sends current versions
// only, so a superseded version's copy never reaches a newer indexer, and
// keeping it after an indexer switch would hold the space for good.
export async function queryNonCurrentCachedFiles(
  db: DatabaseAdapter,
  thresholdUsedAt: number,
  after: EvictionCursor | null,
  limit: number,
): Promise<EvictionRow[]> {
  const cursor = afterCursor(after)
  return db.getAllAsync<EvictionRow>(
    `SELECT fs.fileId, fs.size, f.type, fs.usedAt FROM fs
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
       ${cursor.clause}
     ORDER BY fs.usedAt ASC, fs.fileId ASC
     LIMIT ?`,
    thresholdUsedAt,
    ...cursor.params,
    limit,
  )
}

/** Trashed pass. It has no age gate, and pages by (usedAt, fileId) like the other passes. */
export async function queryTrashedCachedFiles(
  db: DatabaseAdapter,
  indexerURL: string,
  after: EvictionCursor | null,
  limit: number,
): Promise<EvictionRow[]> {
  const cursor = afterCursor(after)
  return db.getAllAsync<EvictionRow>(
    `SELECT fs.fileId, fs.size, f.type, fs.usedAt FROM fs
     JOIN files f ON f.id = fs.fileId
     WHERE f.trashedAt IS NOT NULL
       AND f.deletedAt IS NULL
       AND EXISTS (SELECT 1 FROM objects o WHERE o.fileId = fs.fileId AND o.indexerURL = ?)
       ${cursor.clause}
     ORDER BY fs.usedAt ASC, fs.fileId ASC
     LIMIT ?`,
    indexerURL,
    ...cursor.params,
    limit,
  )
}

/** Which of `ids` still have an in-flight (pending/active) import_files row. */
export async function queryInFlightImportFileIds(
  db: DatabaseAdapter,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const ph = ids.map(() => '?').join(',')
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM import_files WHERE id IN (${ph}) AND state IN ('pending','active')`,
    ...ids,
  )
  return new Set(rows.map((r) => r.id))
}

export async function queryOrphanedFileIds(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<Set<string>> {
  if (fileIds.length === 0) return new Set()
  // Bytes for a pending or active import sit on disk with no files row, including
  // the brief window between the claim-temp rename and the fs-meta upsert, so an id
  // backed by a non-terminal import_files row is never orphaned. A terminal row that
  // never became a file leaves no live files row either, so the second clause makes
  // those bytes reclaimable after a crash.
  const rows = await db.getAllAsync<{ fileId: string }>(
    `SELECT value AS fileId FROM json_each(?)
     WHERE NOT EXISTS (
       SELECT 1 FROM import_files
       WHERE import_files.id = value AND import_files.state IN ('pending','active')
     ) AND (
       NOT EXISTS (
         SELECT 1 FROM fs WHERE fs.fileId = value
       ) OR NOT EXISTS (
         SELECT 1 FROM files WHERE files.id = value AND files.deletedAt IS NULL
       )
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

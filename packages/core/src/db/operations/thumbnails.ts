import type { DatabaseAdapter } from '../../adapters/db'
import type { FileRecord, FileRecordRow, ThumbSize } from '../../types/files'
import { ThumbSizes } from '../../types/files'
import { transformRow } from './files'
import { buildLatestVersionFilter } from './library'
import { queryLocalObjectsForFile } from './localObjects'

export type ThumbnailCandidateRow = {
  id: string
  hash: string
  type: string
  localId: string | null
  createdAt: number
}

export async function queryThumbnailsByFileId(
  db: DatabaseAdapter,
  fileId: string,
): Promise<FileRecord[]> {
  const rows = await db.getAllAsync<FileRecordRow>(
    `SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt, thumbForId, thumbSize
     FROM files
     WHERE thumbForId = ?
     ORDER BY COALESCE(thumbSize, 0) ASC, id ASC`,
    fileId,
  )
  return rows.map((row) => transformRow(row))
}

export async function queryThumbnailSizesForFileId(
  db: DatabaseAdapter,
  fileId: string,
): Promise<ThumbSize[]> {
  const rows = await db.getAllAsync<{ thumbSize: number | null }>(
    `SELECT thumbSize FROM files WHERE thumbForId = ?`,
    fileId,
  )
  return rows
    .map((r) => (typeof r.thumbSize === 'number' ? r.thumbSize : null))
    .filter(
      (n): n is ThumbSize => n !== null && ThumbSizes.includes(n as ThumbSize),
    )
    .sort((a, b) => a - b)
}

export async function queryThumbnailExistsForFileIdAndSize(
  db: DatabaseAdapter,
  fileId: string,
  size: ThumbSize,
): Promise<boolean> {
  const row = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM files WHERE thumbForId = ? AND thumbSize = ? LIMIT 1`,
    fileId,
    size,
  )
  return !!row
}

export async function queryBestThumbnailByFileId(
  db: DatabaseAdapter,
  fileId: string,
  requiredSize: ThumbSize,
): Promise<FileRecord | null> {
  const row = await db.getFirstAsync<FileRecordRow>(
    `SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt, thumbForId, thumbSize
     FROM files
     WHERE thumbForId = ? AND COALESCE(thumbSize, 0) <= ?
     ORDER BY
       COALESCE(thumbSize, 0) DESC,
       id ASC
     LIMIT 1`,
    fileId,
    requiredSize,
  )
  if (!row) return null
  const objects = await queryLocalObjectsForFile(db, row.id)
  return transformRow(row, objects)
}

export async function queryThumbnailFileInfoByFileIds(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<{ id: string; type: string; localId: string | null }[]> {
  if (fileIds.length === 0) return []
  const placeholders = fileIds.map(() => '?').join(',')
  return db.getAllAsync<{ id: string; type: string; localId: string | null }>(
    `SELECT id, type, localId FROM files WHERE thumbForId IN (${placeholders})`,
    ...fileIds,
  )
}

export async function queryThumbnailRecordByFileIdAndSize(
  db: DatabaseAdapter,
  fileId: string,
  size: ThumbSize,
): Promise<FileRecord | null> {
  const row = await db.getFirstAsync<FileRecordRow>(
    `SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt, thumbForId, thumbSize
     FROM files WHERE thumbForId = ? AND thumbSize = ?`,
    fileId,
    size,
  )
  if (!row) return null
  const objects = await queryLocalObjectsForFile(db, row.id)
  return transformRow(row, objects)
}

export async function queryThumbnailCandidatePage(
  db: DatabaseAdapter,
  pageSize: number,
  cursor?: { createdAt: number; id: string },
): Promise<ThumbnailCandidateRow[]> {
  const params: (string | number)[] = []
  const cursorClause = cursor
    ? 'AND (f.createdAt < ? OR (f.createdAt = ? AND f.id < ?))'
    : ''
  if (cursor) {
    params.push(cursor.createdAt, cursor.createdAt, cursor.id)
  }
  params.push(pageSize)

  return db.getAllAsync<ThumbnailCandidateRow>(
    `SELECT f.id, f.hash, f.type, f.localId, f.createdAt
     FROM files f
     LEFT JOIN files t
       ON t.thumbForId = f.id
      AND t.thumbSize IN (${ThumbSizes.join(',')})
     WHERE (f.type LIKE 'image/%' OR f.type LIKE 'video/%')
       AND f.type != 'image/tiff'
       AND f.kind = 'file'
       AND f.hash != ''
       AND f.trashedAt IS NULL AND f.deletedAt IS NULL
       AND ${buildLatestVersionFilter('f')}
       ${cursorClause}
     GROUP BY f.id
     HAVING COUNT(DISTINCT t.thumbSize) < ${ThumbSizes.length}
     ORDER BY f.createdAt DESC, f.id DESC
     LIMIT ?`,
    ...params,
  )
}

export async function queryThumbnailScanProgress(
  db: DatabaseAdapter,
): Promise<{ originals: number; thumbs: number }> {
  const originalsRow = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM files f WHERE (f.type LIKE 'image/%' OR f.type LIKE 'video/%') AND f.kind = 'file' AND f.trashedAt IS NULL AND f.deletedAt IS NULL AND ${buildLatestVersionFilter('f')}`,
  )
  const thumbsRow = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM files WHERE kind = 'thumb' AND deletedAt IS NULL AND thumbSize IN (${ThumbSizes.join(',')})`,
  )
  return {
    originals: originalsRow?.count ?? 0,
    thumbs: thumbsRow?.count ?? 0,
  }
}

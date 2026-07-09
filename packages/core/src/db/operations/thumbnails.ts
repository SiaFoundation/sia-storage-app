import type { DatabaseAdapter } from '../../adapters/db'
import type { FileRecord, FileRecordRow, ThumbSize } from '../../types/files'
import { ThumbSizes } from '../../types/files'
import { transformRow } from './files'
import { buildRecordFilter } from './library'
import { queryObjectRefsForFile } from './localObjects'

export type ThumbnailCandidateRow = {
  id: string
  hash: string
  type: string
  mediaAssetId: string | null
  createdAt: number
}

export async function queryThumbnailsByFileId(
  db: DatabaseAdapter,
  fileId: string,
): Promise<FileRecord[]> {
  const rows = await db.getAllAsync<FileRecordRow>(
    `SELECT id, name, size, createdAt, updatedAt, type, kind, mediaAssetId, hash, addedAt, thumbForId, thumbSize
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
    .filter((n): n is ThumbSize => n !== null && ThumbSizes.includes(n as ThumbSize))
    .sort((a, b) => a - b)
}

export async function queryThumbnailSizesForFileIds(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<Map<string, ThumbSize[]>> {
  const result = new Map<string, ThumbSize[]>()
  if (fileIds.length === 0) return result
  const ph = fileIds.map(() => '?').join(',')
  const rows = await db.getAllAsync<{ thumbForId: string; thumbSize: number | null }>(
    `SELECT thumbForId, thumbSize FROM files WHERE thumbForId IN (${ph})`,
    ...fileIds,
  )
  for (const id of fileIds) result.set(id, [])
  for (const r of rows) {
    if (typeof r.thumbSize !== 'number') continue
    if (!ThumbSizes.includes(r.thumbSize as ThumbSize)) continue
    const list = result.get(r.thumbForId)
    if (list) list.push(r.thumbSize as ThumbSize)
  }
  for (const list of result.values()) list.sort((a, b) => a - b)
  return result
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
    `SELECT id, name, size, createdAt, updatedAt, type, kind, mediaAssetId, hash, addedAt, thumbForId, thumbSize
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
  const objects = await queryObjectRefsForFile(db, row.id)
  return transformRow(row, objects)
}

export async function queryThumbnailFileInfoByFileIds(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<{ id: string; type: string }[]> {
  if (fileIds.length === 0) return []
  const ph = fileIds.map(() => '?').join(',')
  return db.getAllAsync<{ id: string; type: string }>(
    `SELECT id, type FROM files WHERE thumbForId IN (${ph})`,
    ...fileIds,
  )
}

export async function queryThumbnailByFileIdAndSize(
  db: DatabaseAdapter,
  fileId: string,
  size: ThumbSize,
): Promise<FileRecord | null> {
  const row = await db.getFirstAsync<FileRecordRow>(
    `SELECT id, name, size, createdAt, updatedAt, type, kind, mediaAssetId, hash, addedAt, thumbForId, thumbSize
     FROM files WHERE thumbForId = ? AND thumbSize = ?`,
    fileId,
    size,
  )
  if (!row) return null
  const objects = await queryObjectRefsForFile(db, row.id)
  return transformRow(row, objects)
}

export async function queryThumbnailCandidatePage(
  db: DatabaseAdapter,
  pageSize: number,
  cursor: { createdAt: number; id: string } | undefined,
  allowedTypes: readonly string[],
): Promise<ThumbnailCandidateRow[]> {
  if (allowedTypes.length === 0) return []
  const params: (string | number)[] = [...allowedTypes]
  const cursorClause = cursor ? 'AND (f.createdAt < ? OR (f.createdAt = ? AND f.id < ?))' : ''
  if (cursor) {
    params.push(cursor.createdAt, cursor.createdAt, cursor.id)
  }
  params.push(pageSize)
  const typePlaceholders = allowedTypes.map(() => '?').join(',')

  return db.getAllAsync<ThumbnailCandidateRow>(
    `SELECT f.id, f.hash, f.type, f.mediaAssetId, f.createdAt
     FROM files f
     INNER JOIN fs fsm ON fsm.fileId = f.id
     LEFT JOIN files t
       ON t.thumbForId = f.id
      AND t.thumbSize IN (${ThumbSizes.join(',')})
     WHERE f.type IN (${typePlaceholders})
       AND ${buildRecordFilter('f')}
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
  allowedTypes: readonly string[],
): Promise<{ originals: number; thumbs: number }> {
  if (allowedTypes.length === 0) {
    const thumbsRow = await db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM files f WHERE f.kind = 'thumb' AND ${buildRecordFilter('f', { includeThumbnails: true, includeOldVersions: true })} AND f.thumbSize IN (${ThumbSizes.join(',')})`,
    )
    return { originals: 0, thumbs: thumbsRow?.count ?? 0 }
  }
  const typePlaceholders = allowedTypes.map(() => '?').join(',')
  const originalsRow = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM files f WHERE f.type IN (${typePlaceholders}) AND ${buildRecordFilter('f')}`,
    ...allowedTypes,
  )
  const thumbsRow = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM files f WHERE f.kind = 'thumb' AND ${buildRecordFilter('f', { includeThumbnails: true, includeOldVersions: true })} AND f.thumbSize IN (${ThumbSizes.join(',')})`,
  )
  return {
    originals: originalsRow?.count ?? 0,
    thumbs: thumbsRow?.count ?? 0,
  }
}

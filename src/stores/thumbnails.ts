import { db } from '../db'
import { swrCacheBy } from '../lib/swr'
import {
  type FileRecord,
  type FileRecordRow,
  type ThumbSize,
  ThumbSizes,
  transformRow,
} from './files'
import { readLocalObjectsForFile } from './localObjects'

/** Single best thumbnail for a given (fileId, thumbSize) pair. */
export const bestThumbnailCache = swrCacheBy()

/** All thumbnails associated with an original file ID. */
export const thumbnailsByFileIdCache = swrCacheBy()

export async function invalidateThumbnailsForFileId(fileId: string) {
  await Promise.all([
    ...ThumbSizes.map((size) =>
      bestThumbnailCache.invalidate(fileId, String(size)),
    ),
    thumbnailsByFileIdCache.invalidate(fileId),
  ])
}

/** Read all thumbnails associated with an original file ID. */
export async function readThumbnailsByFileId(
  fileId: string,
): Promise<FileRecord[]> {
  const rows = await db().getAllAsync<FileRecordRow>(
    `SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt, thumbForId, thumbSize
     FROM files
     WHERE thumbForId = ?
     ORDER BY COALESCE(thumbSize, 0) ASC, id ASC`,
    fileId,
  )
  return rows.map((row) => transformRow(row))
}

export async function readThumbnailRecordByFileIdAndSize(
  fileId: string,
  size: ThumbSize,
): Promise<FileRecord | null> {
  const row = await db().getFirstAsync<FileRecordRow>(
    `SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt, thumbForId, thumbSize
     FROM files WHERE thumbForId = ? AND thumbSize = ?`,
    fileId,
    size,
  )
  if (!row) return null
  const objects = await readLocalObjectsForFile(row.id)
  return transformRow(row, objects)
}

/** Read all existing thumbnail sizes for a given original file ID. */
export async function readThumbnailSizesForFileId(
  fileId: string,
): Promise<ThumbSize[]> {
  const rows = await db().getAllAsync<{ thumbSize: number | null }>(
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

/**
 * Read the best thumbnail for a given original file ID and required thumb size.
 *
 * Selection rule:
 * - Only consider thumbnails whose thumbSize is less than or equal to the required size.
 * - Prefer the largest available thumbSize that does not exceed the required size.
 * - Return null if no thumbnails are at or below the required size.
 */
export async function readBestThumbnailByFileId(
  fileId: string,
  requiredSize: ThumbSize,
): Promise<FileRecord | null> {
  const row = await db().getFirstAsync<FileRecordRow>(
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
  const objects = await readLocalObjectsForFile(row.id)
  return transformRow(row, objects)
}

/** Check if a thumbnail exists for an original file ID and exact size. */
export async function thumbnailExistsForFileIdAndSize(
  fileId: string,
  size: ThumbSize,
): Promise<boolean> {
  const row = await db().getFirstAsync<{ id: string }>(
    `SELECT id FROM files WHERE thumbForId = ? AND thumbSize = ? LIMIT 1`,
    fileId,
    size,
  )
  return !!row
}

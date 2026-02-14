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

/** Single best thumbnail for a given (hash, thumbSize) pair. */
export const bestThumbnailCache = swrCacheBy()

/** All thumbnails associated with an original file hash. */
export const thumbnailsByHashCache = swrCacheBy()

export async function invalidateThumbnailsForHash(hash: string) {
  await Promise.all([
    ...ThumbSizes.map((size) =>
      bestThumbnailCache.invalidate(hash, String(size)),
    ),
    thumbnailsByHashCache.invalidate(hash),
  ])
}

/** Read all thumbnails associated with an original file content hash. */
export async function readThumbnailsByHash(
  hash: string,
): Promise<FileRecord[]> {
  const rows = await db().getAllAsync<FileRecordRow>(
    `SELECT id, name, size, createdAt, updatedAt, type, localId, hash, addedAt, thumbForHash, thumbSize
     FROM files
     WHERE thumbForHash = ?
     ORDER BY COALESCE(thumbSize, 0) ASC, id ASC`,
    hash,
  )
  return rows.map((row) => transformRow(row))
}

export async function readThumbnailRecordByThumbForHashAndSize(
  thumbForHash: string,
  size: ThumbSize,
): Promise<FileRecord | null> {
  const row = await db().getFirstAsync<FileRecordRow>(
    `SELECT id, name, size, createdAt, updatedAt, type, localId, hash, addedAt, thumbForHash, thumbSize
     FROM files WHERE thumbForHash = ? AND thumbSize = ?`,
    thumbForHash,
    size,
  )
  if (!row) return null
  const objects = await readLocalObjectsForFile(row.id)
  return transformRow(row, objects)
}

/** Read all existing thumbnail sizes for a given original hash. */
export async function readThumbnailSizesForHash(
  hash: string,
): Promise<ThumbSize[]> {
  const rows = await db().getAllAsync<{ thumbSize: number | null }>(
    `SELECT thumbSize FROM files WHERE thumbForHash = ?`,
    hash,
  )
  return rows
    .map((r) => (typeof r.thumbSize === 'number' ? r.thumbSize : null))
    .filter(
      (n): n is ThumbSize => n !== null && ThumbSizes.includes(n as ThumbSize),
    )
    .sort((a, b) => a - b)
}

/**
 * Read the best thumbnail for a given original file hash and required thumb size.
 *
 * Selection rule:
 * - Only consider thumbnails whose thumbSize is less than or equal to the required size.
 * - Prefer the largest available thumbSize that does not exceed the required size.
 * - Return null if no thumbnails are at or below the required size.
 */
export async function readBestThumbnailByHash(
  hash: string,
  requiredSize: ThumbSize,
): Promise<FileRecord | null> {
  const row = await db().getFirstAsync<FileRecordRow>(
    `SELECT id, name, size, createdAt, updatedAt, type, localId, hash, addedAt, thumbForHash, thumbSize
     FROM files
     WHERE thumbForHash = ? AND COALESCE(thumbSize, 0) <= ?
     ORDER BY
       COALESCE(thumbSize, 0) DESC,
       id ASC
     LIMIT 1`,
    hash,
    requiredSize,
  )
  if (!row) return null
  const objects = await readLocalObjectsForFile(row.id)
  return transformRow(row, objects)
}

/** Check if a thumbnail exists for an original hash and exact size. */
export async function thumbnailExistsForHashAndSize(
  hash: string,
  size: ThumbSize,
): Promise<boolean> {
  const row = await db().getFirstAsync<{ id: string }>(
    `SELECT id FROM files WHERE thumbForHash = ? AND thumbSize = ? LIMIT 1`,
    hash,
    size,
  )
  return !!row
}

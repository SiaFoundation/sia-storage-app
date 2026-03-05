import * as ops from '@siastorage/core/db/operations'
import { db } from '../db'
import { swrCacheBy } from '../lib/swr'
import { type FileRecord, type ThumbSize, ThumbSizes } from './files'

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

export async function readThumbnailsByFileId(
  fileId: string,
): Promise<FileRecord[]> {
  return ops.queryThumbnailsByFileId(db(), fileId)
}

export async function readThumbnailRecordByFileIdAndSize(
  fileId: string,
  size: ThumbSize,
): Promise<FileRecord | null> {
  return ops.queryThumbnailRecordByFileIdAndSize(db(), fileId, size)
}

export async function readThumbnailSizesForFileId(
  fileId: string,
): Promise<ThumbSize[]> {
  return ops.queryThumbnailSizesForFileId(db(), fileId)
}

export async function readBestThumbnailByFileId(
  fileId: string,
  requiredSize: ThumbSize,
): Promise<FileRecord | null> {
  return ops.queryBestThumbnailByFileId(db(), fileId, requiredSize)
}

export async function thumbnailExistsForFileIdAndSize(
  fileId: string,
  size: ThumbSize,
): Promise<boolean> {
  return ops.queryThumbnailExistsForFileIdAndSize(db(), fileId, size)
}

import { logger } from '../lib/logger'
import { File } from 'expo-file-system'
import * as VideoThumbnails from 'expo-video-thumbnails'
import { Image } from 'react-native'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import {
  readFileRecordByContentHash,
  createFileRecord,
  type ThumbSize,
  ThumbSizes,
  FileRecord,
} from '../stores/files'
import {
  readThumbnailSizesForHash,
  thumbnailExistsForHashAndSize,
  thumbnailSwr,
} from '../stores/thumbnails'
import { getFileUri, copyFileToCache } from '../stores/fileCache'
import { calculateContentHash } from '../lib/contentHash'
import { getMimeType } from '../lib/fileTypes'
import { uniqueId } from '../lib/uniqueId'

/**
 * Generate thumbnails for a file record.
 * This will generate all missing thumbnail sizes for the given file.
 * @param fileRecord - The file record to generate thumbnails for.
 * @returns Promise that resolves when thumbnails are generated.
 */
export async function generateThumbnailsForFile(
  fileRecord: FileRecord
): Promise<void> {
  // Only generate thumbnails for image and video files.
  if (
    !fileRecord.type?.startsWith('image/') &&
    !fileRecord.type?.startsWith('video/')
  ) {
    return
  }

  // Get the source URI for the file.
  const sourceUri = await getFileUri({
    id: fileRecord.id,
    type: fileRecord.type,
    localId: fileRecord.localId,
  })
  if (!sourceUri) {
    logger.log('[generateThumbnailsForFile] no source URI', {
      fileId: fileRecord.id,
    })
    return
  }

  // Check which sizes already exist.
  const existingSizes = await readThumbnailSizesForHash(fileRecord.hash)
  const missingSizes = ThumbSizes.filter((s) => !existingSizes.includes(s))

  if (missingSizes.length === 0) {
    logger.log('[generateThumbnailsForFile] all thumbnails already exist', {
      fileId: fileRecord.id,
    })
    return
  }

  // Generate missing thumbnails.
  logger.log('[generateThumbnailsForFile] generating thumbnails', {
    fileId: fileRecord.id,
    missingSizes,
  })

  for (const size of missingSizes) {
    await ensureThumbnailForSize({
      fileId: fileRecord.id,
      fileHash: fileRecord.hash,
      fileType: fileRecord.type,
      fileLocalId: fileRecord.localId,
      size,
      sourceUri,
    })
  }
}

export async function generateThumbnails(files: FileRecord[]) {
  for (const file of files) {
    try {
      await generateThumbnailsForFile(file)
    } catch (error) {
      logger.log('[generateThumbnails] thumbnail generation error', {
        fileId: file.id,
        error,
      })
    }
  }
}

type EnsureResult =
  | { status: 'exists' }
  | {
      status: 'produced'
      thumbId: string
      width: number | null
      height: number | null
    }
  | { status: 'duplicate'; existingThumbId: string }
  | { status: 'error'; error: unknown }

export async function ensureThumbnailForSize(params: {
  fileId: string
  fileHash: string
  fileType: string
  fileLocalId: string | null
  size: ThumbSize
  sourceUri: string
}): Promise<EnsureResult> {
  const { fileId, fileHash, fileType, size, sourceUri } = params

  // Fast path: exact size exists.
  const exactExists = await thumbnailExistsForHashAndSize(fileHash, size)
  if (exactExists) {
    return { status: 'exists' }
  }

  logger.log('[thumbnailer] source uri', { fileId, uri: sourceUri })

  // Compute input and target aspect-preserving dimensions for thumb size = size.
  let info: ThumbnailInfo | null = null
  try {
    if (fileType?.startsWith('video/')) {
      info = await prepareVideoThumbnail(sourceUri, size)
      logger.log('[thumbnailer] video base frame prepared', {
        fileId,
        size,
        info,
      })
    } else {
      info = await prepareImageThumbnail(sourceUri, size)
      logger.log('[thumbnailer] image target size prepared', {
        fileId,
        size,
        info,
      })
    }
  } catch (e) {
    logger.log('[thumbnailer] error preparing source', e)
    return { status: 'error', error: e }
  }

  try {
    const ctx = ImageManipulator.manipulate(info.inputUri)
    ctx.resize({ width: info.targetWidth, height: info.targetHeight })
    const ref = await ctx.renderAsync()
    const result = await ref.saveAsync({
      compress: 0.8,
      format: SaveFormat.WEBP,
    })
    logger.log('[thumbnailer] manipulated', {
      fileId,
      hash: fileHash,
      size,
      outWidth: result.width,
      outHeight: result.height,
      uri: result.uri,
    })

    // Copy thumbnail file to cache and calculate hash.
    const thumbId = uniqueId()
    const thumbFileInfo = {
      id: thumbId,
      type: getMimeType({ type: 'image/webp', name: 'thumbnail.webp' }),
      localId: null,
    }
    const cacheUri = await copyFileToCache(thumbFileInfo, new File(result.uri))
    const thumbHash = await calculateContentHash(cacheUri)
    if (!thumbHash) {
      logger.log('[thumbnailer] failed to calculate hash', { fileId, size })
      return { status: 'error', error: new Error('Missing thumbnail hash') }
    }

    // Check if a thumbnail with this hash already exists (dedupe by content hash).
    const existingThumb = await readFileRecordByContentHash(thumbHash)
    if (existingThumb) {
      logger.log('[thumbnailer] thumbnail already exists by hash', {
        thumbId: existingThumb.id,
        hash: fileHash,
        size,
      })
      return { status: 'duplicate', existingThumbId: existingThumb.id }
    }

    // Create file record with thumbForHash set from the start to avoid flicker.
    const fileSize = new File(cacheUri).info().size ?? 0
    const now = Date.now()
    await createFileRecord(
      {
        id: thumbId,
        name: 'thumbnail.webp',
        type: thumbFileInfo.type,
        size: fileSize,
        hash: thumbHash,
        createdAt: now,
        updatedAt: now,
        addedAt: now,
        localId: null,
        thumbForHash: fileHash,
        thumbSize: size,
      },
      true
    )
    logger.log('[thumbnailer] created thumbnail record', {
      thumbId,
      hash: fileHash,
      size,
    })

    // Invalidate thumbnail cache for this original file so gallery items update.
    // This will revalidate all thumb sizes for this hash.
    await thumbnailSwr.triggerChange(fileHash)

    return {
      status: 'produced',
      thumbId,
      width: result.width ?? null,
      height: result.height ?? null,
    }
  } catch (e) {
    logger.log('[thumbnailer] error generating thumbnail', e)
    return { status: 'error', error: e }
  }
}

type TargetDimensions = {
  targetWidth?: number
  targetHeight?: number
}

/** Compute aspect-preserving target dimensions with long edge = size. */
function computeTargetDimensions(
  sourceWidth: number | null | undefined,
  sourceHeight: number | null | undefined,
  size: ThumbSize
): TargetDimensions {
  if (
    typeof sourceWidth === 'number' &&
    typeof sourceHeight === 'number' &&
    sourceWidth > 0 &&
    sourceHeight > 0
  ) {
    const landscape = sourceWidth >= sourceHeight
    if (landscape) {
      return {
        targetWidth: size,
        targetHeight: Math.max(
          1,
          Math.round((sourceHeight * size) / sourceWidth)
        ),
      }
    }
    return {
      targetHeight: size,
      targetWidth: Math.max(1, Math.round((sourceWidth * size) / sourceHeight)),
    }
  }
  // Fallback: set width = size and let height scale.
  return { targetWidth: size, targetHeight: undefined }
}

type ThumbnailInfo = {
  inputUri: string
  targetWidth?: number
  targetHeight?: number
}

async function getImageSize(
  uri: string
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    Image.getSize(
      uri,
      (w, h) => resolve({ width: w, height: h }),
      () => resolve(null)
    )
  })
}

/** Prepare image input frame and target dimensions for resizing. */
async function prepareImageThumbnail(
  sourceUri: string,
  size: ThumbSize
): Promise<ThumbnailInfo> {
  const imgSize = await getImageSize(sourceUri)
  const { targetWidth, targetHeight } = computeTargetDimensions(
    imgSize?.width,
    imgSize?.height,
    size
  )

  return {
    inputUri: sourceUri,
    targetWidth,
    targetHeight,
  }
}

/** Prepare video frame and target dimensions for resizing. */
async function prepareVideoThumbnail(
  sourceUri: string,
  size: ThumbSize
): Promise<ThumbnailInfo> {
  const thumb = await VideoThumbnails.getThumbnailAsync(sourceUri, {
    time: 1000,
    quality: 0.8,
  })
  const baseWidth = thumb.width ?? 0
  const baseHeight = thumb.height ?? 0

  const { targetWidth, targetHeight } = computeTargetDimensions(
    baseWidth,
    baseHeight,
    size
  )

  return {
    inputUri: thumb.uri,
    targetWidth,
    targetHeight,
  }
}

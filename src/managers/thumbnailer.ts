import { File } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import * as VideoThumbnails from 'expo-video-thumbnails'
import { Image } from 'react-native'
import { calculateContentHash } from '../lib/contentHash'
import { detectMimeType } from '../lib/detectMimeType'
import { getMimeType } from '../lib/fileTypes'
import { logger } from '../lib/logger'
import { uniqueId } from '../lib/uniqueId'
import {
  createFileRecord,
  type FileRecord,
  type ThumbSize,
  ThumbSizes,
} from '../stores/files'
import { copyFileToFs, getFsFileUri } from '../stores/fs'
import {
  invalidateThumbnailsForFileId,
  readThumbnailSizesForFileId,
  thumbnailExistsForFileIdAndSize,
} from '../stores/thumbnails'

// Track files currently being processed to prevent race conditions
// between generateThumbnailsForFile and thumbnailScanner.
const processingFiles = new Set<string>()

// Maps fileId to last error timestamp. Files are skipped for ERROR_COOLDOWN_MS.
const erroredFiles = new Map<string, number>()
const ERROR_COOLDOWN_MS = 60 * 60 * 1000 // 1 hour

export function isFileBeingProcessed(fileId: string): boolean {
  return processingFiles.has(fileId)
}

export function isFileInErrorCooldown(fileId: string): boolean {
  const lastError = erroredFiles.get(fileId)
  if (!lastError) return false
  const elapsed = Date.now() - lastError
  if (elapsed >= ERROR_COOLDOWN_MS) {
    erroredFiles.delete(fileId)
    return false
  }
  return true
}

function markFileErrored(fileId: string): void {
  erroredFiles.set(fileId, Date.now())
}

/**
 * Generate thumbnails for a file record.
 * This will generate all missing thumbnail sizes for the given file.
 * @param fileRecord - The file record to generate thumbnails for.
 * @returns Promise that resolves when thumbnails are generated.
 */
export async function generateThumbnailsForFile(
  fileRecord: FileRecord,
): Promise<void> {
  // Only generate thumbnails for image and video files.
  if (
    !fileRecord.type?.startsWith('image/') &&
    !fileRecord.type?.startsWith('video/')
  ) {
    return
  }

  // Mark file as being processed to prevent scanner from picking it up.
  processingFiles.add(fileRecord.id)
  try {
    // Get the source URI for the file.
    const sourceUri = await getFsFileUri({
      id: fileRecord.id,
      type: fileRecord.type,
    })
    if (!sourceUri) {
      logger.warn('generateThumbnailsForFile', 'no_source_uri', {
        fileId: fileRecord.id,
      })
      return
    }

    // Check which sizes already exist.
    const existingSizes = await readThumbnailSizesForFileId(fileRecord.id)
    const missingSizes = ThumbSizes.filter((s) => !existingSizes.includes(s))

    if (missingSizes.length === 0) {
      logger.debug('generateThumbnailsForFile', 'all_exist', {
        fileId: fileRecord.id,
      })
      return
    }

    // Generate missing thumbnails.
    logger.debug('generateThumbnailsForFile', 'generating', {
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
  } finally {
    processingFiles.delete(fileRecord.id)
  }
}

export async function generateThumbnails(files: FileRecord[]) {
  for (const file of files) {
    try {
      await generateThumbnailsForFile(file)
    } catch (error) {
      logger.error('generateThumbnails', 'generation_error', {
        fileId: file.id,
        error: error as Error,
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
  const exactExists = await thumbnailExistsForFileIdAndSize(fileId, size)
  if (exactExists) {
    return { status: 'exists' }
  }

  // Detect actual MIME type from file content using magic bytes.
  const detectedType = await detectMimeType(sourceUri)
  const actualType = detectedType ?? fileType

  // Log if there's a mismatch between stored and detected types.
  if (detectedType && detectedType !== fileType) {
    logger.warn('thumbnailer', 'type_mismatch', {
      fileId,
      storedType: fileType,
      detectedType,
      sourceUri,
    })
  }

  // Skip unsupported formats early.
  if (!actualType?.startsWith('image/') && !actualType?.startsWith('video/')) {
    logger.error('thumbnailer', 'unsupported_format', {
      fileId,
      fileHash,
      size,
      storedType: fileType,
      detectedType,
      sourceUri,
    })
    markFileErrored(fileId)
    return { status: 'error', error: new Error('Unsupported format') }
  }

  logger.debug('thumbnailer', 'source_uri', {
    fileId,
    uri: sourceUri,
    storedType: fileType,
    detectedType,
  })

  // Compute input and target aspect-preserving dimensions for thumb size = size.
  let info: ThumbnailInfo | null = null
  try {
    if (actualType?.startsWith('video/')) {
      info = await prepareVideoThumbnail(sourceUri, size)
      logger.debug('thumbnailer', 'video_frame_prepared', {
        fileId,
        size,
        info,
      })
    } else {
      info = await prepareImageThumbnail(sourceUri, size)
      logger.debug('thumbnailer', 'image_resized', {
        fileId,
        size,
        info,
      })
    }
  } catch (e) {
    logger.error('thumbnailer', 'source_prepare_error', {
      fileId,
      fileHash,
      size,
      storedType: fileType,
      detectedType,
      sourceUri,
      error: e as Error,
    })
    markFileErrored(fileId)
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
    logger.debug('thumbnailer', 'manipulated', {
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
      type: await getMimeType({ type: 'image/webp', name: 'thumbnail.webp' }),
      localId: null,
    }
    const fileUri = await copyFileToFs(thumbFileInfo, new File(result.uri))
    const thumbHash = await calculateContentHash(fileUri)
    if (!thumbHash) {
      logger.error('thumbnailer', 'hash_error', { fileId, size })
      markFileErrored(fileId)
      return { status: 'error', error: new Error('Missing thumbnail hash') }
    }

    const fileSize = new File(fileUri).info().size ?? 0
    const now = Date.now()
    await createFileRecord(
      {
        id: thumbId,
        name: 'thumbnail.webp',
        type: thumbFileInfo.type,
        kind: 'thumb',
        size: fileSize,
        hash: thumbHash,
        createdAt: now,
        updatedAt: now,
        addedAt: now,
        localId: null,
        thumbForId: fileId,
        thumbSize: size,
      },
      true,
    )
    logger.debug('thumbnailer', 'record_created', {
      thumbId,
      hash: fileHash,
      size,
    })

    // Invalidate thumbnail cache for this original file so gallery items update.
    // This will revalidate all thumb sizes for this hash.
    await invalidateThumbnailsForFileId(fileId)

    return {
      status: 'produced',
      thumbId,
      width: result.width ?? null,
      height: result.height ?? null,
    }
  } catch (e) {
    logger.error('thumbnailer', 'generation_error', {
      fileId,
      fileHash,
      size,
      storedType: fileType,
      detectedType,
      sourceUri,
      inputUri: info.inputUri,
      error: e as Error,
    })
    markFileErrored(fileId)
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
  size: ThumbSize,
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
          Math.round((sourceHeight * size) / sourceWidth),
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
  uri: string,
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    Image.getSize(
      uri,
      (w, h) => resolve({ width: w, height: h }),
      () => resolve(null),
    )
  })
}

/** Prepare image input frame and target dimensions for resizing. */
async function prepareImageThumbnail(
  sourceUri: string,
  size: ThumbSize,
): Promise<ThumbnailInfo> {
  const imgSize = await getImageSize(sourceUri)
  const { targetWidth, targetHeight } = computeTargetDimensions(
    imgSize?.width,
    imgSize?.height,
    size,
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
  size: ThumbSize,
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
    size,
  )

  return {
    inputUri: thumb.uri,
    targetWidth,
    targetHeight,
  }
}

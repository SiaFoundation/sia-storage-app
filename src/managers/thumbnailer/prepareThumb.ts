import * as VideoThumbnails from 'expo-video-thumbnails'
import { Image } from 'react-native'
import { type ThumbSize } from '../../stores/files'

export type TargetDimensions = {
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

export type ThumbnailInfo = {
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
export async function prepareImageThumbnail(
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
export async function prepareVideoThumbnail(
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

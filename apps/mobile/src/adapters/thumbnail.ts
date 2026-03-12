import type {
  ThumbnailAdapter,
  ThumbnailResult,
} from '@siastorage/core/adapters'
import type { ThumbSize } from '@siastorage/core/types'
import { File } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import * as VideoThumbnails from 'expo-video-thumbnails'
import { Image } from 'react-native'

function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject)
  })
}

/**
 * Resize an image to fit within maxSize while preserving aspect ratio,
 * applying EXIF orientation correction if needed.
 *
 * For the source image (first call), we detect EXIF rotation by comparing
 * Image.getSize (EXIF-corrected) against the raw pixel dimensions from a
 * single renderAsync. The rotation + resize are applied in the same
 * ImageManipulator chain, so only 1 native decode happens.
 *
 * For cascaded calls (resizing from a previously saved thumbnail), set
 * skipOrientationDetection=true to avoid the unnecessary EXIF check.
 */
async function resizeToWebP(
  inputUri: string,
  maxSize: number,
  skipOrientationDetection?: boolean,
): Promise<{ result: ThumbnailResult; savedUri: string }> {
  const ctx = ImageManipulator.manipulate(inputUri)

  let isPortrait: boolean
  if (skipOrientationDetection) {
    // Input is an already-oriented thumbnail — just check dimensions via
    // a lightweight getImageSize call (no pixel decode).
    try {
      const size = await getImageSize(inputUri)
      isPortrait = size.height > size.width
    } catch {
      isPortrait = false
    }
  } else {
    // First resize from the original source: detect EXIF orientation.
    // renderAsync decodes the full image — we use the same ctx for the
    // subsequent resize so this is the only decode.
    const rendered = await ctx.renderAsync()
    isPortrait = rendered.height > rendered.width

    try {
      const exifSize = await getImageSize(inputUri)
      const rawIsLandscape = rendered.width >= rendered.height
      const exifIsLandscape = exifSize.width >= exifSize.height
      if (rawIsLandscape !== exifIsLandscape) {
        ctx.rotate(90)
      }
      isPortrait = exifSize.height > exifSize.width
    } catch {
      // Fall back to raw dimensions if Image.getSize fails
    }
  }

  if (isPortrait) {
    ctx.resize({ height: maxSize })
  } else {
    ctx.resize({ width: maxSize })
  }
  const resized = await ctx.renderAsync()
  const saved = await resized.saveAsync({
    compress: 0.8,
    format: SaveFormat.WEBP,
  })
  const file = new File(saved.uri)
  const data = await file.bytes()
  return {
    result: {
      data: data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
      ),
      mimeType: 'image/webp',
    },
    savedUri: saved.uri,
  }
}

export function createMobileThumbnailAdapter(): ThumbnailAdapter {
  return {
    async generateImageThumbnail(
      sourcePath: string,
      targetSize: number,
    ): Promise<ThumbnailResult> {
      const { result } = await resizeToWebP(sourcePath, targetSize as ThumbSize)
      return result
    },

    async generateImageThumbnails(
      sourcePath: string,
      sizes: number[],
    ): Promise<Map<number, ThumbnailResult>> {
      const sorted = [...sizes].sort((a, b) => b - a)
      const results = new Map<number, ThumbnailResult>()

      let inputUri = sourcePath
      let skipDetection = false
      for (const size of sorted) {
        const { result, savedUri } = await resizeToWebP(
          inputUri,
          size,
          skipDetection,
        )
        results.set(size, result)
        // Subsequent smaller sizes resize from the larger result.
        // That file is already correctly oriented and much smaller,
        // so decoding it is essentially free.
        inputUri = savedUri
        skipDetection = true
      }

      return results
    },

    async generateVideoThumbnail(
      sourcePath: string,
      targetSize: number,
    ): Promise<ThumbnailResult> {
      const thumb = await VideoThumbnails.getThumbnailAsync(sourcePath, {
        time: 1000,
        quality: 0.8,
      })
      const { result } = await resizeToWebP(thumb.uri, targetSize as ThumbSize)
      return result
    },
  }
}

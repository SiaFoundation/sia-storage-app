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

async function resizeToWebP(
  inputUri: string,
  maxSize: number,
): Promise<ThumbnailResult> {
  const ctx = ImageManipulator.manipulate(inputUri)
  const rendered = await ctx.renderAsync()
  let isPortrait = rendered.height > rendered.width

  // RCTImageLoader on iOS does not apply EXIF orientation when loading
  // full-size images, so raw pixel dimensions may differ from the visual
  // orientation. Image.getSize returns EXIF-corrected dimensions — compare
  // to detect the mismatch and apply a corrective rotation.
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

  if (isPortrait) {
    ctx.resize({ height: maxSize })
  } else {
    ctx.resize({ width: maxSize })
  }
  const resized = await ctx.renderAsync()
  const result = await resized.saveAsync({
    compress: 0.8,
    format: SaveFormat.WEBP,
  })
  const file = new File(result.uri)
  const data = await file.bytes()
  return {
    data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    mimeType: 'image/webp',
  }
}

export function createMobileThumbnailAdapter(): ThumbnailAdapter {
  return {
    async generateImageThumbnail(
      sourcePath: string,
      targetSize: number,
    ): Promise<ThumbnailResult> {
      return resizeToWebP(sourcePath, targetSize as ThumbSize)
    },

    async generateVideoThumbnail(
      sourcePath: string,
      targetSize: number,
    ): Promise<ThumbnailResult> {
      const thumb = await VideoThumbnails.getThumbnailAsync(sourcePath, {
        time: 1000,
        quality: 0.8,
      })
      return resizeToWebP(thumb.uri, targetSize as ThumbSize)
    },
  }
}
